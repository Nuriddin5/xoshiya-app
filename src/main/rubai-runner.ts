import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { accessSync, constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import type { RubaiRuntimeStatus, RubaiWorkerRuntimeStatus } from '../shared/types.js';
import type { TaskQueueStats } from '../shared/task-queue.js';

type RubaiRequest = {
  audioDurationMs: number | null;
  id: string;
  queuedAtMs: number;
  reject: (error: Error) => void;
  resolve: (value: string) => void;
};

type RubaiWorkerMessage =
  | { type: 'ready'; backend: string; model: string; modelLoadMs?: number }
  | { type: 'fatal'; error: string }
  | { type: 'result'; id: string; text: string; processingMs?: number }
  | { type: 'error'; id?: string | null; error: string; processingMs?: number };

const currentDir = dirname(fileURLToPath(import.meta.url));
const RUBAI_MODEL_ID = 'islomov/rubaistt_v2_medium';
const RUBAI_SETUP_DOC = 'README.md';
const DEFAULT_RUBAI_CT2_MODEL_PATH = join(
  homedir(),
  'Desktop',
  'whisper-tools',
  'models',
  'rubai-rubaistt-v2-medium-ct2-int8',
);
const RUBAI_STARTUP_TIMEOUT_MS = 10 * 60 * 1000;
const RUBAI_TRANSCRIPTION_TIMEOUT_MS = 10 * 60 * 1000;
const RUBAI_WORKER_CONCURRENCY = 2;

type TranscribeOptions = {
  audioDurationMs?: number | null;
  queuedAtMs?: number;
};

function formatPathForMessage(filePath: string): string {
  return `"${filePath}"`;
}

function formatSetupHint(): string {
  return `See ${RUBAI_SETUP_DOC} for the Rubai self-host setup checklist.`;
}

type ReadabilityOptions = {
  includeSetupHint?: boolean;
};

function maybeAppendSetupHint(message: string, options: ReadabilityOptions): string {
  return options.includeSetupHint ? `${message} ${formatSetupHint()}` : message;
}

async function assertReadableFile(filePath: string, label: string, options: ReadabilityOptions = {}): Promise<void> {
  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      throw new Error(`${label} must point to a file.`);
    }

    await access(filePath, fsConstants.R_OK);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unable to access ${label.toLowerCase()}.`;
    throw new Error(maybeAppendSetupHint(
      `${label} not found or unreadable at ${formatPathForMessage(filePath)}. ${message}`,
      options,
    ));
  }
}

async function assertReadableDirectory(filePath: string, label: string, options: ReadabilityOptions = {}): Promise<void> {
  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isDirectory()) {
      throw new Error(`${label} must point to a directory.`);
    }

    await access(filePath, fsConstants.R_OK);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unable to access ${label.toLowerCase()}.`;
    throw new Error(maybeAppendSetupHint(
      `${label} not found or unreadable at ${formatPathForMessage(filePath)}. ${message}`,
      options,
    ));
  }
}

type RubaiWorkerPaths = {
  modelPath: string;
  projectRoot: string;
  pythonPath: string;
  scriptPath: string;
};

let cachedRubaiPaths: RubaiWorkerPaths | null = null;

function normalizeEnvPath(value: string | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];

  if ((firstChar === '"' && lastChar === '"') || (firstChar === '\'' && lastChar === '\'')) {
    return trimmed.slice(1, -1).trim() || null;
  }

  return trimmed;
}

function getDefaultRubaiPythonPath(projectRoot: string): string {
  return process.platform === 'win32'
    ? join(projectRoot, '.venv-rubai', 'Scripts', 'python.exe')
    : join(projectRoot, '.venv-rubai', 'bin', 'python');
}

function resolveRubaiWorkerPaths(): RubaiWorkerPaths {
  if (cachedRubaiPaths) {
    return cachedRubaiPaths;
  }

  const projectRoot = resolveRubaiRuntimeRoot();
  cachedRubaiPaths = {
    modelPath: normalizeEnvPath(process.env.RUBAI_CT2_MODEL_PATH) ?? DEFAULT_RUBAI_CT2_MODEL_PATH,
    projectRoot,
    pythonPath: normalizeEnvPath(process.env.RUBAI_PYTHON_PATH) ?? getDefaultRubaiPythonPath(projectRoot),
    scriptPath: join(projectRoot, 'scripts', 'rubai_worker.py'),
  };
  return cachedRubaiPaths;
}

function resolveRubaiRuntimeRoot(): string {
  const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
  const runtimeRootCandidates = [
    process.env.PORTABLE_EXECUTABLE_DIR,
    process.env.PORTABLE_EXECUTABLE_FILE ? dirname(process.env.PORTABLE_EXECUTABLE_FILE) : undefined,
    dirname(process.execPath),
    electronProcess.resourcesPath,
  ];

  for (const runtimeRoot of runtimeRootCandidates) {
    if (runtimeRoot && hasRubaiRuntimeFiles(runtimeRoot)) {
      return runtimeRoot;
    }
  }

  if (currentDir.includes('app.asar') && electronProcess.resourcesPath) {
    return electronProcess.resourcesPath;
  }

  return findProjectRoot(currentDir);
}

function hasRubaiRuntimeFiles(runtimeRoot: string): boolean {
  try {
    requireReadableFileSync(join(runtimeRoot, 'scripts', 'rubai_worker.py'));
    return true;
  } catch {
    return false;
  }
}

function findProjectRoot(startDir: string): string {
  let searchDir = startDir;

  while (true) {
    const candidate = join(searchDir, 'package.json');
    try {
      requireReadableFileSync(candidate);
      return searchDir;
    } catch {
      const parentDir = resolve(searchDir, '..');
      if (parentDir === searchDir) {
        throw new Error(`Could not locate project root from ${formatPathForMessage(startDir)}.`);
      }

      searchDir = parentDir;
    }
  }
}

function requireReadableFileSync(filePath: string): void {
  accessSync(filePath, fsConstants.R_OK);
}

function runRubaiProbe(pythonPath: string, projectRoot: string, modelPath: string): Promise<void> {
  return new Promise((resolveProbe, rejectProbe) => {
    const child = spawn(pythonPath, ['-c', 'import faster_whisper, ctranslate2'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        RUBAI_CT2_MODEL_PATH: modelPath,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      rejectProbe(new Error('Rubai Python dependency probe timed out after 120 seconds.'));
    }, 120_000);

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      callback();
    };

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => settle(() => rejectProbe(error)));
    child.once('close', (code) => {
      if (code === 0) {
        settle(resolveProbe);
        return;
      }

      settle(() => rejectProbe(
        new Error(`${stderr.trim() || `Rubai Python dependency probe failed with exit code ${code ?? 'unknown'}.`} ${formatSetupHint()}`),
      ));
    });
  });
}

async function buildRubaiRuntimeStatus(probeDependencies: boolean, queueStats?: TaskQueueStats): Promise<RubaiRuntimeStatus> {
  const { modelPath, projectRoot, pythonPath, scriptPath } = resolveRubaiWorkerPaths();
  const missingItems: string[] = [];
  let backend: string | null = null;
  let runtimePath = pythonPath;

  try {
    await assertReadableFile(pythonPath, 'Rubai Python runtime', { includeSetupHint: true });
  } catch (error) {
    missingItems.push(error instanceof Error ? error.message : `Rubai Python runtime is unavailable at ${formatPathForMessage(pythonPath)}. ${formatSetupHint()}`);
  }

  try {
    await assertReadableFile(scriptPath, 'Rubai worker script', { includeSetupHint: true });
  } catch (error) {
    missingItems.push(error instanceof Error ? error.message : `Rubai worker script is unavailable at ${formatPathForMessage(scriptPath)}. ${formatSetupHint()}`);
  }

  try {
    await assertReadableDirectory(modelPath, 'Rubai converted model folder', { includeSetupHint: true });
    await assertReadableFile(join(modelPath, 'model.bin'), 'Rubai converted model weights', { includeSetupHint: true });
    await assertReadableFile(join(modelPath, 'tokenizer.json'), 'Rubai tokenizer', { includeSetupHint: true });
    await assertReadableFile(join(modelPath, 'preprocessor_config.json'), 'Rubai preprocessor config', { includeSetupHint: true });
  } catch (error) {
    missingItems.push(error instanceof Error ? error.message : `Rubai converted model files are unavailable at ${formatPathForMessage(modelPath)}. ${formatSetupHint()}`);
  }

  if (probeDependencies && missingItems.length === 0) {
    try {
      await runRubaiProbe(pythonPath, projectRoot, modelPath);
    } catch (error) {
      missingItems.push(error instanceof Error ? error.message : 'Rubai Python dependencies are unavailable.');
    }
  }

  backend = missingItems.length === 0 ? 'faster-whisper-ct2-int8' : null;

  return {
    backend,
    isReady: missingItems.length === 0,
    message: missingItems.length === 0
      ? probeDependencies
        ? 'Local Rubai ASR runtime is ready.'
        : 'Local Rubai ASR files are ready. Python dependencies are checked before recording.'
      : `Local Rubai ASR runtime is not ready. ${missingItems.join(' ')}`,
    missingItems,
    modelPath,
    pythonPath: runtimePath,
    worker: rubaiWorkerClient.getStatus(queueStats),
  };
}

export function getRubaiRuntimeStatus(queueStats?: TaskQueueStats): Promise<RubaiRuntimeStatus> {
  return buildRubaiRuntimeStatus(false, queueStats);
}

export async function validateRubaiRuntime(): Promise<RubaiRuntimeStatus> {
  const status = await buildRubaiRuntimeStatus(true);
  if (!status.isReady) {
    throw new Error(status.message);
  }

  return status;
}

class RubaiWorkerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private completedCount = 0;
  private failedCount = 0;
  private lastCompletedAt: number | null = null;
  private lastProcessingMs: number | null = null;
  private lastQueueDelayMs: number | null = null;
  private lastRealTimeFactor: number | null = null;
  private modelLoadMs: number | null = null;
  private nextRequestId = 1;
  private pending = new Map<string, RubaiRequest>();
  private readyPromise: Promise<void> | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;
  private startupMs: number | null = null;
  private state: RubaiWorkerRuntimeStatus['state'] = 'stopped';

  async transcribe(audioPath: string, options: TranscribeOptions = {}): Promise<string> {
    await assertReadableFile(audioPath, 'Audio path');
    await this.ensureReady();
    const child = this.child;

    if (!child || child.exitCode !== null || child.killed || child.stdin.destroyed) {
      throw new Error('Rubai worker is not running.');
    }

    return new Promise<string>((resolveRequest, rejectRequest) => {
      const id = String(this.nextRequestId++);
      const queuedAtMs = options.queuedAtMs ?? Date.now();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.failedCount++;
        this.refreshState();
        rejectRequest(new Error(`Rubai transcription timed out after ${RUBAI_TRANSCRIPTION_TIMEOUT_MS / 1000} seconds.`));
      }, RUBAI_TRANSCRIPTION_TIMEOUT_MS);

      this.pending.set(id, {
        audioDurationMs: options.audioDurationMs ?? null,
        id,
        queuedAtMs,
        resolve: (value) => {
          clearTimeout(timeout);
          resolveRequest(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectRequest(error);
        },
      });
      this.refreshState();

      try {
        child.stdin.write(`${JSON.stringify({ id, audioPath })}\n`);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timeout);
        this.failedCount++;
        this.refreshState();
        rejectRequest(error instanceof Error ? error : new Error('Failed to send audio chunk to Rubai worker.'));
      }
    });
  }

  getStatus(queueStats?: TaskQueueStats): RubaiWorkerRuntimeStatus {
    return {
      activeCount: queueStats?.activeCount ?? this.pending.size,
      backlogCount: (queueStats?.activeCount ?? this.pending.size) + (queueStats?.queuedCount ?? 0),
      completedCount: this.completedCount,
      concurrency: queueStats?.concurrency ?? RUBAI_WORKER_CONCURRENCY,
      failedCount: this.failedCount,
      lastCompletedAt: this.lastCompletedAt,
      lastProcessingMs: this.lastProcessingMs,
      lastQueueDelayMs: this.lastQueueDelayMs,
      lastRealTimeFactor: this.lastRealTimeFactor,
      modelLoadMs: this.modelLoadMs,
      startupMs: this.startupMs,
      state: this.state,
    };
  }

  private async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.start();
    }

    return this.readyPromise;
  }

  private async start(): Promise<void> {
    const { modelPath, projectRoot, pythonPath, scriptPath } = resolveRubaiWorkerPaths();
    await validateRubaiRuntime();
    const startupStartedAt = Date.now();
    this.state = 'loading';

    await new Promise<void>((resolveReady, rejectReady) => {
      const child = spawn(pythonPath, [scriptPath], {
        cwd: projectRoot,
        env: {
          ...process.env,
          RUBAI_COMPUTE_TYPE: process.env.RUBAI_COMPUTE_TYPE ?? 'int8',
          RUBAI_CPU_THREADS: process.env.RUBAI_CPU_THREADS ?? '4',
          RUBAI_MODEL_NUM_WORKERS: process.env.RUBAI_MODEL_NUM_WORKERS ?? '2',
          RUBAI_CT2_MODEL_PATH: modelPath,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;

      const stdout = createInterface({ input: child.stdout });
      const stderrLines: string[] = [];
      const cleanupStartup = () => {
        if (this.startupTimeout) {
          clearTimeout(this.startupTimeout);
          this.startupTimeout = null;
        }
      };
      const failStartup = (error: Error) => {
        cleanupStartup();
        this.readyPromise = null;
        this.state = 'failed';
        rejectReady(error);
      };

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderrLines.push(chunk);
      });

      child.once('error', (error) => {
        failStartup(new Error(`Failed to launch Rubai worker for ${RUBAI_MODEL_ID}: ${error.message}`));
      });

      child.once('exit', (code, signal) => {
        cleanupStartup();
        const message = `Rubai worker exited with ${signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`}.`;
        const error = new Error(`${message} ${stderrLines.join(' ').trim()}`.trim());
        this.rejectAll(error);
        this.child = null;
        this.readyPromise = null;
        this.state = 'failed';
      });

      stdout.on('line', (line) => {
        let payload: RubaiWorkerMessage;
        try {
          payload = JSON.parse(line) as RubaiWorkerMessage;
        } catch {
          return;
        }

        if (payload.type === 'ready') {
          cleanupStartup();
          this.modelLoadMs = typeof payload.modelLoadMs === 'number' ? payload.modelLoadMs : null;
          this.startupMs = Date.now() - startupStartedAt;
          this.refreshState();
          resolveReady();
          return;
        }

        if (payload.type === 'fatal') {
          failStartup(new Error(`Rubai worker failed to initialize: ${payload.error}`));
          child.kill();
          return;
        }

        if (payload.type === 'result') {
          const pending = this.pending.get(payload.id);
          if (!pending) {
            return;
          }

          this.pending.delete(payload.id);
          this.completedCount++;
          this.lastCompletedAt = Date.now();
          this.lastProcessingMs = typeof payload.processingMs === 'number' ? payload.processingMs : null;
          this.lastQueueDelayMs = Math.max(0, Date.now() - pending.queuedAtMs - (this.lastProcessingMs ?? 0));
          this.lastRealTimeFactor = this.calculateRealTimeFactor(this.lastProcessingMs, pending.audioDurationMs);
          this.refreshState();
          pending.resolve(payload.text);
          return;
        }

        if (payload.type === 'error') {
          const pending = payload.id ? this.pending.get(payload.id) : null;
          if (!pending) {
            return;
          }

          this.pending.delete(payload.id!);
          this.failedCount++;
          this.lastProcessingMs = typeof payload.processingMs === 'number' ? payload.processingMs : null;
          this.lastQueueDelayMs = Math.max(0, Date.now() - pending.queuedAtMs - (this.lastProcessingMs ?? 0));
          this.lastRealTimeFactor = this.calculateRealTimeFactor(this.lastProcessingMs, pending.audioDurationMs);
          this.refreshState();
          pending.reject(new Error(payload.error));
        }
      });

      this.startupTimeout = setTimeout(() => {
        failStartup(new Error(`Rubai worker startup timed out after ${RUBAI_STARTUP_TIMEOUT_MS / 1000} seconds.`));
        child.kill();
      }, RUBAI_STARTUP_TIMEOUT_MS);
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }

    this.pending.clear();
    this.refreshState();
  }

  private calculateRealTimeFactor(processingMs: number | null, audioDurationMs: number | null): number | null {
    if (!processingMs || !audioDurationMs || audioDurationMs <= 0) {
      return null;
    }

    return Number((processingMs / audioDurationMs).toFixed(2));
  }

  private refreshState(): void {
    if (this.pending.size > 0) {
      this.state = 'transcribing';
      return;
    }

    if (this.child && this.child.exitCode === null && !this.child.killed) {
      this.state = 'ready';
      return;
    }

    if (this.state !== 'loading' && this.state !== 'failed') {
      this.state = 'stopped';
    }
  }
}

const rubaiWorkerClient = new RubaiWorkerClient();

export async function transcribeWithRubai(audioPath: string, options: TranscribeOptions = {}): Promise<string> {
  return rubaiWorkerClient.transcribe(audioPath, options);
}
