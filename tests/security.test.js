import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function importTranspiledTsModule(relativePath) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });

  const dataUrl = `data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`;
  return import(dataUrl);
}

async function importTranspiledTsModuleAsFile(relativePath) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });

  const tempModulePath = path.join(
    os.tmpdir(),
    `xoshiya-test-${path.basename(relativePath, '.ts')}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  fs.writeFileSync(tempModulePath, outputText, 'utf8');
  return import(pathToFileURL(tempModulePath).href);
}

async function importTranspiledTsModuleFromRoot(relativePath) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });

  const tempModulePath = path.join(
    root,
    `tmp-xoshiya-test-${path.basename(relativePath, '.ts')}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  fs.writeFileSync(tempModulePath, outputText, 'utf8');

  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    fs.rmSync(tempModulePath, { force: true });
  }
}

function createFakeRubaiModelRoot() {
  const modelRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-rubai-model-'));

  for (const fileName of ['model.bin', 'tokenizer.json', 'preprocessor_config.json']) {
    fs.writeFileSync(path.join(modelRoot, fileName), 'stub', 'utf8');
  }

  return modelRoot;
}

test('Windows-safe path containment accepts nested export paths and rejects traversal', async () => {
  const { assertPathInsideBaseFolder } = await importTranspiledTsModule('src/main/path-security.ts');

  const baseFolder = path.join('C:\\', 'Study Capture', 'exports');
  const nestedPath = path.join('c:\\', 'study capture', 'exports', 'session', 'note.md');
  const resolvedNestedPath = assertPathInsideBaseFolder(
    nestedPath,
    baseFolder,
    'Export file action is only allowed inside the configured save folder.',
  );

  assert.equal(resolvedNestedPath, path.resolve(nestedPath));

  assert.throws(() => {
    assertPathInsideBaseFolder(
      path.join('C:\\', 'Study Capture', 'other', 'note.md'),
      baseFolder,
      'Export file action is only allowed inside the configured save folder.',
    );
  }, /configured save folder/i);
});

test('Rubai runtime status uses environment paths when provided', async () => {
  const modelRoot = createFakeRubaiModelRoot();
  const previousPythonPath = process.env.RUBAI_PYTHON_PATH;
  const previousModelPath = process.env.RUBAI_CT2_MODEL_PATH;
  process.env.RUBAI_PYTHON_PATH = process.execPath;
  process.env.RUBAI_CT2_MODEL_PATH = modelRoot;

  try {
    const { getRubaiRuntimeStatus } = await importTranspiledTsModuleFromRoot('src/main/rubai-runner.ts');
    const status = await getRubaiRuntimeStatus();

    assert.equal(status.pythonPath, process.execPath);
    assert.equal(status.modelPath, modelRoot);
    assert.match(status.message, /Python dependencies are checked before recording/i);
  } finally {
    if (previousPythonPath === undefined) {
      delete process.env.RUBAI_PYTHON_PATH;
    } else {
      process.env.RUBAI_PYTHON_PATH = previousPythonPath;
    }

    if (previousModelPath === undefined) {
      delete process.env.RUBAI_CT2_MODEL_PATH;
    } else {
      process.env.RUBAI_CT2_MODEL_PATH = previousModelPath;
    }

    fs.rmSync(modelRoot, { force: true, recursive: true });
  }
});

test('Rubai runtime status reports macOS and Linux virtualenv fallback path', async () => {
  const previousPythonPath = process.env.RUBAI_PYTHON_PATH;
  const previousModelPath = process.env.RUBAI_CT2_MODEL_PATH;
  delete process.env.RUBAI_PYTHON_PATH;
  delete process.env.RUBAI_CT2_MODEL_PATH;

  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    value: 'darwin',
  });

  try {
    const { getRubaiRuntimeStatus } = await importTranspiledTsModuleFromRoot('src/main/rubai-runner.ts');
    const status = await getRubaiRuntimeStatus();

    assert.match(status.pythonPath, /[\\\/]\.venv-rubai[\\\/]bin[\\\/]python$/);
    assert.match(status.message, /README\.md/);
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }

    if (previousPythonPath === undefined) {
      delete process.env.RUBAI_PYTHON_PATH;
    } else {
      process.env.RUBAI_PYTHON_PATH = previousPythonPath;
    }

    if (previousModelPath === undefined) {
      delete process.env.RUBAI_CT2_MODEL_PATH;
    } else {
      process.env.RUBAI_CT2_MODEL_PATH = previousModelPath;
    }
  }
});

test('Rubai worker handles malformed input without crashing', () => {
  const workerPath = path.join(root, 'scripts', 'rubai_worker.py');
  const pythonPath = fs.existsSync(path.join(root, '.venv-rubai', 'Scripts', 'python.exe'))
    ? path.join(root, '.venv-rubai', 'Scripts', 'python.exe')
    : 'python';
  const script = `
import importlib.util
import io
import json
import sys

module_path = ${JSON.stringify(workerPath)}
spec = importlib.util.spec_from_file_location("rubai_worker_test", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.load_faster_whisper_backend = lambda: {
    "name": "stub",
    "model": "stub-model",
    "transcribe": lambda audio_path: "stub transcript",
}
captured = []
module.emit = lambda payload: captured.append(payload)
sys.stdin = io.StringIO("{bad json}\\n")
exit_code = module.main()
print(json.dumps({"exit_code": exit_code, "captured": captured}, ensure_ascii=False))
  `;

  const result = spawnSync(pythonPath, ['-c', script], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.exit_code, 0);
  assert.equal(payload.captured.length, 2);
  assert.equal(payload.captured[0].type, 'ready');
  assert.equal(payload.captured[1].type, 'error');
});

test('Rubai worker transcribes chunks with VAD enabled', () => {
  const workerPath = path.join(root, 'scripts', 'rubai_worker.py');
  const modelPath = path.join(
    os.homedir(),
    'Desktop',
    'whisper-tools',
    'models',
    'rubai-rubaistt-v2-medium-ct2-int8',
  );
  const pythonPath = fs.existsSync(path.join(root, '.venv-rubai', 'Scripts', 'python.exe'))
    ? path.join(root, '.venv-rubai', 'Scripts', 'python.exe')
    : 'python';
  const script = `
import importlib.util
import json
import os
import sys
import types

module_path = ${JSON.stringify(workerPath)}
model_path = ${JSON.stringify(modelPath)}

class FakeWhisperModel:
    init_args = None
    transcribe_kwargs = None

    def __init__(self, model_path, device, compute_type, cpu_threads, num_workers):
        FakeWhisperModel.init_args = {
            "model_path": model_path,
            "device": device,
            "compute_type": compute_type,
            "cpu_threads": cpu_threads,
            "num_workers": num_workers,
        }

    def transcribe(self, audio_path, **kwargs):
        FakeWhisperModel.transcribe_kwargs = {
            "audio_path": str(audio_path),
            **kwargs,
        }

        class Segment:
            def __init__(self, text):
                self.text = text

        return [Segment("stub transcript")], None

fake_module = types.ModuleType("faster_whisper")
fake_module.WhisperModel = FakeWhisperModel
sys.modules["faster_whisper"] = fake_module
os.environ["RUBAI_CT2_MODEL_PATH"] = model_path

spec = importlib.util.spec_from_file_location("rubai_worker_test", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
backend = module.load_faster_whisper_backend()
text = backend["transcribe"]("chunk.webm")
print(json.dumps({
    "init_args": FakeWhisperModel.init_args,
    "text": text,
    "transcribe_kwargs": FakeWhisperModel.transcribe_kwargs,
}, ensure_ascii=False))
  `;

  const result = spawnSync(pythonPath, ['-c', script], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.text, 'stub transcript');
  assert.equal(payload.init_args.compute_type, 'int8');
  assert.equal(payload.init_args.device, 'cpu');
  assert.equal(payload.init_args.num_workers, 2);
  assert.equal(payload.transcribe_kwargs.audio_path, 'chunk.webm');
  assert.equal(payload.transcribe_kwargs.beam_size, 1);
  assert.equal(payload.transcribe_kwargs.vad_filter, true);
  assert.equal(payload.transcribe_kwargs.condition_on_previous_text, false);
  assert.equal(payload.transcribe_kwargs.language, 'uz');
  assert.equal(payload.transcribe_kwargs.task, 'transcribe');
});

test('missing audio path error does not point users at Rubai setup docs', async () => {
  const { transcribeWithRubai } = await importTranspiledTsModuleAsFile('src/main/rubai-runner.ts');
  const missingAudioPath = path.join(root, 'tmp', 'missing-audio.webm');

  await assert.rejects(
    transcribeWithRubai(missingAudioPath),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.match(error.message, /Audio path not found or unreadable/i);
      assert.doesNotMatch(error.message, /WHISPER_WINDOWS_SETUP\.md/);
      return true;
    },
  );
});
