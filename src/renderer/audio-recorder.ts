import {
  ADAPTIVE_CHUNK_ANALYSIS_INTERVAL_MS,
  ADAPTIVE_CHUNK_DEFAULT_SECONDS,
  AdaptiveChunkBoundaryPlanner,
  buildAdaptiveChunkBoundaryConfig,
  createAdaptiveChunkBoundaryDebug,
  normalizeAdaptiveChunkSeconds,
  type AdaptiveChunkBoundaryDebug,
} from '../shared/adaptive-chunking.js';
import type { DesktopSourceSummary } from '../shared/types.js';
import {
  buildRawTranscriptText,
  createRecordingTranscriptChunk,
  createStudySessionId,
  summarizeTranscriptChunks,
  type TranscriptChunkRecord,
  updateTranscriptChunkRecord,
} from '../shared/transcription-session.js';
import { createTaskQueue } from '../shared/task-queue.js';

export type RecorderStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'pausing'
  | 'paused'
  | 'stopping'
  | 'processing'
  | 'completed'
  | 'failed';

export type RecorderLifecycleEventType =
  | 'session-started'
  | 'chunk-started'
  | 'chunk-completed'
  | 'session-paused'
  | 'session-resumed'
  | 'session-stopped'
  | 'error';

export type RecorderLifecycleEvent = {
  id: string;
  type: RecorderLifecycleEventType;
  message: string;
  timestamp: number;
  chunkDurationMs: number | null;
  chunkIndex: number | null;
  chunkSizeBytes: number | null;
  mimeType: string | null;
};

export type RecorderSnapshot = {
  chunkSeconds: number;
  currentChunkIndex: number | null;
  currentChunkStartedAt: number | null;
  errorMessage: string | null;
  events: RecorderLifecycleEvent[];
  rawTranscriptText: string;
  sessionId: string | null;
  transcriptChunks: TranscriptChunkRecord[];
  sourceId: string | null;
  sourceName: string | null;
  startedAt: number | null;
  status: RecorderStatus;
  statusMessage: string;
  stoppedAt: number | null;
};

type StartRecordingInput = {
  chunkSeconds: number;
  source: DesktopSourceSummary;
};

type DesktopMediaStreams = {
  audioStream: MediaStream;
  sourceStream: MediaStream;
};

type ChunkBoundaryMonitor = {
  analyser: AnalyserNode;
  audioContext: AudioContext;
  planner: AdaptiveChunkBoundaryPlanner;
  sampleBuffer: Float32Array<ArrayBuffer>;
  sourceNode: MediaStreamAudioSourceNode;
};

type SnapshotListener = (snapshot: RecorderSnapshot) => void;

const DEFAULT_CHUNK_SECONDS = ADAPTIVE_CHUNK_DEFAULT_SECONDS;
const MAX_EVENTS = 30;

export function createIdleRecorderSnapshot(): RecorderSnapshot {
  return {
    chunkSeconds: DEFAULT_CHUNK_SECONDS,
    currentChunkIndex: null,
    currentChunkStartedAt: null,
    errorMessage: null,
    events: [],
    rawTranscriptText: '',
    sessionId: null,
    transcriptChunks: [],
    sourceId: null,
    sourceName: null,
    startedAt: null,
    status: 'idle',
    statusMessage: 'Idle',
    stoppedAt: null,
  };
}

function normalizeChunkSeconds(value: number): number {
  return normalizeAdaptiveChunkSeconds(value);
}

function createDesktopCaptureConstraints(sourceId: string): MediaStreamConstraints {
  return {
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
      },
    },
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: 1,
        maxHeight: 1,
        maxWidth: 1,
      },
    },
  } as unknown as MediaStreamConstraints;
}

function selectRecorderMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm'];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function computeRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) {
    return 0;
  }

  let total = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    total += sample * sample;
  }

  return Math.sqrt(total / samples.length);
}

async function getDesktopAudioStream(sourceId: string): Promise<DesktopMediaStreams> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Media capture is unavailable in this renderer.');
  }

  const sourceStream = await navigator.mediaDevices.getUserMedia(createDesktopCaptureConstraints(sourceId));
  const audioTracks = sourceStream.getAudioTracks();

  if (audioTracks.length === 0) {
    sourceStream.getTracks().forEach((track) => track.stop());
    throw new Error('The selected desktop source did not provide an audio track.');
  }

  return {
    audioStream: new MediaStream(audioTracks),
    sourceStream,
  };
}

export class AudioRecorder {
  private activeChunkBoundaryDebug: AdaptiveChunkBoundaryDebug | null = null;
  private activeChunkIndex: number | null = null;
  private activeChunkStartedAt: number | null = null;
  private activeChunkId: string | null = null;
  private audioStream: MediaStream | null = null;
  private chunkBoundaryMonitor: ChunkBoundaryMonitor | null = null;
  private chunkBoundaryMonitorTimer: number | null = null;
  private chunkRotationTimer: number | null = null;
  private disposed = false;
  private pendingStop = false;
  private recorder: MediaRecorder | null = null;
  private recorderGeneration = 0;
  private recorderMimeType: string | undefined;
  private recorderStopMode: 'chunk' | 'final' | 'pause' | null = null;
  private queueSettlementRunId = 0;
  private snapshot: RecorderSnapshot = createIdleRecorderSnapshot();
  private sourceStream: MediaStream | null = null;
  private stopBehavior: 'wait' | 'immediate' = 'wait';
  private stopResolver: (() => void) | null = null;
  private chunkBlobs = new Map<string, Blob>();
  private transcriptionQueue = createTaskQueue(2);
  private transcriptionGeneration = 0;

  constructor(private readonly onSnapshot: SnapshotListener, initialSnapshot?: RecorderSnapshot) {
    if (initialSnapshot) {
      this.snapshot = {
        ...initialSnapshot,
        status: initialSnapshot.status === 'recording'
          || initialSnapshot.status === 'starting'
          || initialSnapshot.status === 'pausing'
          || initialSnapshot.status === 'stopping'
          ? 'paused'
          : initialSnapshot.status,
        statusMessage: initialSnapshot.status === 'recording'
          || initialSnapshot.status === 'starting'
          || initialSnapshot.status === 'pausing'
          || initialSnapshot.status === 'stopping'
          ? 'Paused (after refresh)'
          : initialSnapshot.statusMessage,
      };
    }
    this.emit();
    this.recoverPersistedTranscriptWork();
  }

  async start(input: StartRecordingInput): Promise<void> {
    if (
      this.snapshot.status === 'recording'
      || this.snapshot.status === 'starting'
      || this.snapshot.status === 'pausing'
      || this.snapshot.status === 'paused'
      || this.snapshot.status === 'stopping'
      || this.snapshot.status === 'processing'
    ) {
      throw new Error('Recorder is already active.');
    }

    this.disposed = false;
    this.chunkBlobs.clear();

    if (typeof MediaRecorder === 'undefined') {
      this.fail(new Error('MediaRecorder is unavailable in this renderer.'));
      return;
    }

    try {
      const startRequestedAt = performance.now();
      const chunkSeconds = normalizeChunkSeconds(input.chunkSeconds);
      const startedAt = Date.now();
      console.info('[recorder] start requested', {
        chunkSeconds,
        sourceId: input.source.id,
        sourceName: input.source.name,
      });
      this.pendingStop = false;
      this.stopBehavior = 'wait';
      this.queueSettlementRunId += 1;
      this.patch({
        chunkSeconds,
        currentChunkIndex: null,
        currentChunkStartedAt: null,
        errorMessage: null,
        events: [],
        rawTranscriptText: '',
        sessionId: createStudySessionId(),
        transcriptChunks: [],
        sourceId: input.source.id,
        sourceName: input.source.name,
        startedAt,
        status: 'starting',
        statusMessage: `Checking local ASR for ${input.source.name}`,
        stoppedAt: null,
      });

      const studyCapture = window.studyCapture;

      if (!studyCapture?.getRubaiRuntimeStatus) {
        throw new Error('Rubai runtime status bridge is unavailable.');
      }

      const runtimeCheckStartedAt = performance.now();
      const runtimeStatus = await studyCapture.getRubaiRuntimeStatus();
      console.info('[recorder] ASR file readiness checked', {
        elapsedMs: elapsedMs(runtimeCheckStartedAt),
        isReady: runtimeStatus.isReady,
      });
      if (!runtimeStatus.isReady) {
        throw new Error(runtimeStatus.message);
      }

      this.patch({
        statusMessage: `Connecting to desktop audio from ${input.source.name}`,
      });

      const streamStartedAt = performance.now();
      const streams = await getDesktopAudioStream(input.source.id);
      console.info('[recorder] desktop audio stream acquired', {
        elapsedMs: elapsedMs(streamStartedAt),
      });
      if (this.disposed) {
        this.stopStreams(streams.audioStream, streams.sourceStream);
        return;
      }

      this.sourceStream = streams.sourceStream;
      this.audioStream = streams.audioStream;

      this.recorderMimeType = selectRecorderMimeType();
      this.patch({
        statusMessage: `Starting local recorder for ${input.source.name}`,
      });
      this.addEvent('session-started', `Started local recording from ${input.source.name}.`, null);
      this.startChunkRecorder(1);
      console.info('[recorder] media recorder started', {
        elapsedMs: elapsedMs(startRequestedAt),
      });

      if (this.pendingStop) {
        void this.stop();
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('Failed to start audio recording.'));
    }
  }

  stop(): Promise<void> {
    if (this.snapshot.status === 'starting' || this.snapshot.status === 'pausing') {
      this.pendingStop = true;
      this.stopBehavior = 'wait';
      this.patch({
        status: 'stopping',
        statusMessage: 'Stopping after the current chunk closes',
      });
      if (this.recorder && this.recorder.state === 'inactive' && this.recorderStopMode !== null) {
        this.recorderStopMode = 'final';
        return new Promise((resolve) => {
          this.stopResolver = resolve;
        });
      }
      return Promise.resolve();
    }

    if (!this.recorder || this.recorder.state === 'inactive') {
      if (this.recorder && this.recorderStopMode !== null) {
        this.pendingStop = true;
        this.stopBehavior = 'wait';
        this.recorderStopMode = 'final';
        this.patch({
          status: 'stopping',
          statusMessage: 'Stopping after the current chunk closes',
        });
        return new Promise((resolve) => {
          this.stopResolver = resolve;
        });
      }

      const wasSessionActive = this.snapshot.status !== 'idle' && this.snapshot.status !== 'completed';
      this.stopBoundaryTracking();
      this.clearChunkRotationTimer();
      this.cleanupStreams();
      this.patch({
        currentChunkIndex: null,
        currentChunkStartedAt: null,
        stoppedAt: Date.now(),
      });
      if (wasSessionActive) {
        this.addEvent('session-stopped', 'Stopped local recording.', null);
      }
      this.finalizeSession();
      return Promise.resolve();
    }

    this.pendingStop = true;
    this.stopBehavior = 'wait';
    this.activeChunkBoundaryDebug = this.buildChunkBoundaryDebug('stop-request');
    this.stopBoundaryTracking();
    this.clearChunkRotationTimer();
    this.recorderStopMode = 'final';
    this.patch({
      status: 'stopping',
      statusMessage: 'Stopping after the current chunk closes',
    });

    return new Promise((resolve) => {
      this.stopResolver = resolve;
      this.recorder?.stop();
    });
  }

  finishNow(): void {
    if (this.snapshot.status !== 'stopping' && this.snapshot.status !== 'processing') {
      return;
    }

    this.stopBehavior = 'immediate';
    const summary = summarizeTranscriptChunks(this.snapshot.transcriptChunks);

    if (this.snapshot.status === 'processing' || summary.backlogCount > 0) {
      this.patch({
        status: 'processing',
        statusMessage: this.buildProcessingStatusMessage(summary, true),
      });
    } else {
      this.patch({
        statusMessage: 'Finishing after the current chunk closes. Remaining work will continue in the background.',
      });
    }

    this.stopResolver?.();
    this.stopResolver = null;
  }

  forceFinishSession(): void {
    if (!this.snapshot.sessionId) {
      return;
    }

    this.abortQueuedTranscriptionWork();
    this.stopActiveCaptureForManualOverride();

    const stoppedAt = Date.now();
    const transcriptChunks = this.snapshot.transcriptChunks.map((chunk) => {
      if (chunk.status !== 'recording' && chunk.status !== 'pending' && chunk.status !== 'transcribing') {
        return chunk;
      }

      return {
        ...chunk,
        errorMessage: `Chunk ${chunk.chunkIndex} was manually force-finished because local transcription was stuck.`,
        status: 'failed' as const,
      };
    });
    const summary = summarizeTranscriptChunks(transcriptChunks);

    this.patch({
      currentChunkIndex: null,
      currentChunkStartedAt: null,
      rawTranscriptText: buildRawTranscriptText(transcriptChunks),
      status: summary.failedCount > 0 ? 'failed' : 'completed',
      statusMessage: summary.failedCount > 0
        ? this.buildFailedStatusMessageForChunks(transcriptChunks)
        : this.buildCompletedStatusMessageForChunks(transcriptChunks),
      stoppedAt,
      transcriptChunks,
    });
    this.addEvent('session-stopped', 'Force-finished the session and released stuck chunk work.', null);
    this.stopResolver?.();
    this.stopResolver = null;
  }

  resetSession(): void {
    const sessionId = this.snapshot.sessionId;
    this.abortQueuedTranscriptionWork();
    this.stopActiveCaptureForManualOverride();
    this.chunkBlobs.clear();
    this.clearPersistedSnapshot(sessionId);
    this.stopBehavior = 'wait';
    this.pendingStop = false;
    this.patch(createIdleRecorderSnapshot());
  }

  pause(): void {
    if (this.snapshot.status !== 'recording' || !this.recorder || this.recorder.state === 'inactive') {
      return;
    }

    this.activeChunkBoundaryDebug = this.buildChunkBoundaryDebug('pause-request');
    this.stopBoundaryTracking();
    this.clearChunkRotationTimer();
    this.recorderStopMode = 'pause';
    this.patch({
      status: 'pausing',
      statusMessage: 'Pausing capture after the current chunk closes',
    });
    this.recorder.stop();
  }

  async resume(): Promise<void> {
    if (this.snapshot.status !== 'paused') {
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      this.fail(new Error('MediaRecorder is unavailable in this renderer.'));
      return;
    }

    if (!this.snapshot.sourceId || !this.snapshot.sourceName) {
      this.fail(new Error('Cannot resume because the previous desktop source is unavailable.'));
      return;
    }

    try {
      this.pendingStop = false;
      this.patch({
        errorMessage: null,
        status: 'starting',
        statusMessage: `Reconnecting to desktop audio from ${this.snapshot.sourceName}`,
      });

      const studyCapture = window.studyCapture;

      if (!studyCapture?.getRubaiRuntimeStatus) {
        throw new Error('Rubai runtime status bridge is unavailable.');
      }

      const runtimeStatus = await studyCapture.getRubaiRuntimeStatus();
      if (!runtimeStatus.isReady) {
        throw new Error(runtimeStatus.message);
      }

      if (!this.audioStream || !this.sourceStream) {
        const streams = await getDesktopAudioStream(this.snapshot.sourceId);
        if (this.disposed) {
          this.stopStreams(streams.audioStream, streams.sourceStream);
          return;
        }

        this.sourceStream = streams.sourceStream;
        this.audioStream = streams.audioStream;
      }

      this.recorderMimeType = selectRecorderMimeType();
      const nextIndex = this.snapshot.transcriptChunks.reduce(
        (maxIndex, chunk) => Math.max(maxIndex, chunk.chunkIndex),
        0,
      ) + 1;
      this.addEvent('session-resumed', 'Resumed local recording.', null);
      this.startChunkRecorder(nextIndex);

      if (this.pendingStop) {
        void this.stop();
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('Failed to resume audio recording.'));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pendingStop = true;
    this.stopBoundaryTracking();
    this.clearChunkRotationTimer();
    this.recorderStopMode = 'final';
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    } else {
      this.cleanupStreams();
    }
  }

  private handleDataAvailable(event: BlobEvent): void {
    const chunkIndex = this.activeChunkIndex;
    const chunkStartedAt = this.activeChunkStartedAt;
    const chunkId = this.activeChunkId;
    const now = Date.now();
    const mimeType = event.data.type || this.recorder?.mimeType || null;

    if (chunkIndex !== null && chunkStartedAt !== null && chunkId !== null) {
      const chunkDurationMs = now - chunkStartedAt;
      const boundaryDebug = this.resolveActiveChunkBoundaryDebug(chunkDurationMs);
      if (event.data.size === 0) {
        this.patch({
          transcriptChunks: updateTranscriptChunkRecord(this.snapshot.transcriptChunks, chunkId, {
            boundaryDebug,
            chunkDurationMs,
            chunkSizeBytes: 0,
            errorMessage: 'Chunk contained no audio data and was not saved.',
            mimeType,
            status: 'failed',
          }),
        });
        this.addEvent(
          'error',
          `Chunk ${chunkIndex} contained no audio data. ${boundaryDebug?.summary ?? ''}`.trim(),
          null,
        );
      } else {
        this.patch({
          transcriptChunks: updateTranscriptChunkRecord(this.snapshot.transcriptChunks, chunkId, {
            boundaryDebug,
            chunkDurationMs,
            chunkSizeBytes: event.data.size,
            errorMessage: null,
            mimeType,
            status: 'pending',
          }),
        });

        this.addEvent('chunk-completed', `Chunk ${chunkIndex} completed. ${boundaryDebug?.summary ?? ''}`.trim(), {
          chunkDurationMs,
          chunkIndex,
          chunkSizeBytes: event.data.size,
          mimeType,
        });

        this.chunkBlobs.set(chunkId, event.data);
        void this.enqueueTranscriptChunk(chunkId);
      }
    }
  }

  async retryTranscriptChunk(chunkId: string): Promise<void> {
    const chunk = this.snapshot.transcriptChunks.find((record) => record.id === chunkId);
    if (!chunk) {
      throw new Error('Chunk not found.');
    }

    if (chunk.status !== 'failed') {
      return;
    }

    const blob = this.chunkBlobs.get(chunkId);
    if (!blob && !chunk.audioPath) {
      const message = 'This failed chunk cannot be retried because the audio data is no longer available.';
      this.updateTranscriptChunk(chunkId, {
        errorMessage: message,
      });
      this.addEvent('error', message, null);
      return;
    }

    this.updateTranscriptChunk(chunkId, {
      errorMessage: null,
      status: 'pending',
    });
    const retryPromise = this.enqueueTranscriptChunk(chunkId, blob ?? null);
    this.beginQueueSettlement();
    await retryPromise;
  }

  async retryFailedTranscriptChunks(): Promise<void> {
    const failedChunks = this.snapshot.transcriptChunks
      .filter((chunk) => chunk.status === 'failed')
      .sort((left, right) => left.chunkIndex - right.chunkIndex);

    if (failedChunks.length === 0) {
      return;
    }

    await Promise.all(failedChunks.map((chunk) => this.retryTranscriptChunk(chunk.id)));
  }

  private enqueueTranscriptChunk(chunkId: string, blob: Blob | null = null): Promise<void> {
    const generation = this.transcriptionGeneration;
    return this.transcriptionQueue.enqueue(() => this.processTranscriptChunk(chunkId, blob, generation));
  }

  private async processTranscriptChunk(chunkId: string, blob: Blob | null = null, generation = this.transcriptionGeneration): Promise<void> {
    let chunkIndex: number | null = null;

    try {
      if (generation !== this.transcriptionGeneration) {
        return;
      }

      const studyCapture = window.studyCapture;

      if (!studyCapture?.saveAudioChunk) {
        throw new Error('Audio chunk saving bridge is unavailable. Restart the app to reload the preload bridge.');
      }

      const chunk = this.snapshot.transcriptChunks.find((record) => record.id === chunkId);
      if (!chunk) {
        throw new Error('Chunk not found.');
      }
      chunkIndex = chunk.chunkIndex;

      let audioPath = chunk.audioPath;
      let savedAt = chunk.savedAt ?? Date.now();
      if (!audioPath) {
        const availableBlob = blob ?? this.chunkBlobs.get(chunkId) ?? null;
        if (!availableBlob) {
          throw new Error('Audio data is unavailable for this chunk.');
        }

        audioPath = await studyCapture.saveAudioChunk(await availableBlob.arrayBuffer());
        savedAt = Date.now();
      }

      if (this.disposed || generation !== this.transcriptionGeneration) {
        return;
      }

      this.updateTranscriptChunk(chunkId, {
        audioPath,
        savedAt,
        status: 'transcribing',
        errorMessage: null,
      });

      if (!studyCapture.transcribeAudio) {
        throw new Error('Audio transcription bridge is unavailable.');
      }

      const transcriptText = await studyCapture.transcribeAudio(audioPath, {
        audioDurationMs: chunk.chunkDurationMs,
      });

      if (this.disposed || generation !== this.transcriptionGeneration) {
        return;
      }

      this.updateTranscriptChunk(chunkId, {
        status: 'done',
        transcriptText,
        errorMessage: null,
      });
      this.patch({
        rawTranscriptText: buildRawTranscriptText(this.snapshot.transcriptChunks),
      });
      this.chunkBlobs.delete(chunkId);
      this.refreshPostCaptureStatus();
    } catch (error) {
      if (this.disposed || generation !== this.transcriptionGeneration) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to save or transcribe audio chunk.';
      this.updateTranscriptChunk(chunkId, {
        errorMessage: chunkIndex !== null
          ? `Chunk ${chunkIndex} could not be saved or transcribed. ${message}`
          : `Chunk could not be saved or transcribed. ${message}`,
        status: 'failed',
      });
      this.addEvent('error', chunkIndex !== null ? `Chunk ${chunkIndex} failed. ${message}` : message, null);
      this.refreshPostCaptureStatus();
    }
  }

  private handleRecorderStop(recorderGeneration: number): void {
    if (recorderGeneration !== this.recorderGeneration) {
      return;
    }

    const completedChunkIndex = this.activeChunkIndex;
    const stopMode = this.recorderStopMode;
    this.recorder = null;
    this.recorderStopMode = null;
    this.stopBoundaryTracking();

    if (stopMode === 'chunk' && !this.pendingStop && !this.disposed) {
      this.activeChunkBoundaryDebug = null;
      this.activeChunkIndex = null;
      this.activeChunkStartedAt = null;
      this.activeChunkId = null;
      this.patch({
        currentChunkIndex: null,
        currentChunkStartedAt: null,
      });
      this.startChunkRecorder((completedChunkIndex ?? 0) + 1);
      return;
    }

    if (stopMode === 'pause' && !this.pendingStop && !this.disposed) {
      this.activeChunkBoundaryDebug = null;
      this.activeChunkIndex = null;
      this.activeChunkStartedAt = null;
      this.activeChunkId = null;
      this.patch({
        status: 'paused',
        statusMessage: 'Paused',
        currentChunkIndex: null,
        currentChunkStartedAt: null,
      });
      this.addEvent('session-paused', 'Paused recording.', null);
      return;
    }

    this.cleanupStreams();
    this.pendingStop = false;
    this.activeChunkBoundaryDebug = null;
    this.activeChunkIndex = null;
    this.activeChunkStartedAt = null;
    this.activeChunkId = null;
    const stoppedAt = Date.now();
    this.patch({
      currentChunkIndex: null,
      currentChunkStartedAt: null,
      stoppedAt,
    });
    this.addEvent('session-stopped', 'Stopped local recording.', null);
    const summary = summarizeTranscriptChunks(this.snapshot.transcriptChunks);

    if (summary.backlogCount > 0) {
      this.patch({
        status: 'processing',
        statusMessage: this.buildProcessingStatusMessage(summary, this.stopBehavior === 'immediate'),
      });
      this.beginQueueSettlement();
      if (this.stopBehavior === 'immediate') {
        this.stopResolver?.();
        this.stopResolver = null;
      }
      return;
    }

    this.finalizeSession();
  }

  private fail(error: Error): void {
    this.cleanupStreams();
    this.recorder = null;
    this.recorderStopMode = null;
    this.pendingStop = false;
    this.stopBoundaryTracking();
    this.clearChunkRotationTimer();
    this.activeChunkBoundaryDebug = null;
    this.activeChunkIndex = null;
    this.activeChunkStartedAt = null;
    this.activeChunkId = null;
    this.patch({
      currentChunkIndex: null,
      currentChunkStartedAt: null,
      errorMessage: error.message,
      status: 'failed',
      statusMessage: 'Recording failed',
      stoppedAt: Date.now(),
    });
    this.addEvent('error', error.message, null);
    this.stopResolver?.();
    this.stopResolver = null;
  }

  private recoverPersistedTranscriptWork(): void {
    if (!this.snapshot.sessionId) {
      return;
    }

    const recoverableChunkIds: string[] = [];
    let changed = false;
    const transcriptChunks = this.snapshot.transcriptChunks.map((chunk) => {
      if (chunk.status === 'recording') {
        changed = true;
        return {
          ...chunk,
          errorMessage: 'This chunk was interrupted by a renderer refresh before its audio data could be saved.',
          status: 'failed' as const,
        };
      }

      if (chunk.status !== 'pending' && chunk.status !== 'transcribing') {
        return chunk;
      }

      if (!chunk.audioPath) {
        changed = true;
        return {
          ...chunk,
          errorMessage: 'This queued chunk could not be recovered because its audio data was not saved before refresh.',
          status: 'failed' as const,
        };
      }

      recoverableChunkIds.push(chunk.id);
      if (chunk.status === 'transcribing') {
        changed = true;
        return {
          ...chunk,
          errorMessage: null,
          status: 'pending' as const,
        };
      }

      return chunk;
    });

    if (changed) {
      this.patch({
        rawTranscriptText: buildRawTranscriptText(transcriptChunks),
        transcriptChunks,
      });
    }

    if (recoverableChunkIds.length > 0) {
      this.patch({
        status: this.snapshot.status === 'paused' ? 'paused' : 'processing',
        statusMessage: this.snapshot.status === 'paused'
          ? `Paused while ${recoverableChunkIds.length} queued chunk${recoverableChunkIds.length === 1 ? '' : 's'} recover after refresh`
          : this.buildProcessingStatusMessage(summarizeTranscriptChunks(transcriptChunks)),
      });
    }

    recoverableChunkIds
      .sort((leftId, rightId) => {
        const left = transcriptChunks.find((chunk) => chunk.id === leftId);
        const right = transcriptChunks.find((chunk) => chunk.id === rightId);
        return (left?.chunkIndex ?? 0) - (right?.chunkIndex ?? 0);
      })
      .forEach((chunkId) => {
        void this.enqueueTranscriptChunk(chunkId);
      });

    if (recoverableChunkIds.length > 0) {
      this.beginQueueSettlement();
    }
  }

  private cleanupStreams(): void {
    this.stopBoundaryTracking();
    this.clearChunkRotationTimer();
    this.stopStreams(this.audioStream, this.sourceStream);
    this.audioStream = null;
    this.sourceStream = null;
  }

  private stopStreams(...streams: Array<MediaStream | null>): void {
    const tracks = new Set<MediaStreamTrack>();

    for (const stream of streams) {
      stream?.getTracks().forEach((track) => tracks.add(track));
    }

    tracks.forEach((track) => track.stop());
  }

  private startChunkRecorder(chunkIndex: number): void {
    if (!this.audioStream) {
      this.fail(new Error('Audio stream is unavailable for the next chunk.'));
      return;
    }

    const boundaryConfig = buildAdaptiveChunkBoundaryConfig(this.snapshot.chunkSeconds);

    const recorder = new MediaRecorder(
      this.audioStream,
      this.recorderMimeType ? { mimeType: this.recorderMimeType } : undefined,
    );
    recorder.addEventListener('dataavailable', (event) => this.handleDataAvailable(event));
    recorder.addEventListener('error', (event) => {
      this.fail(new Error(event.error.message || 'MediaRecorder failed.'));
    });
    const recorderGeneration = this.recorderGeneration;
    recorder.addEventListener('stop', () => this.handleRecorderStop(recorderGeneration));

    const chunkStartedAt = Date.now();
    const chunkRecord = createRecordingTranscriptChunk({
      chunkIndex,
      chunkSizeBytes: 0,
      createdAt: chunkStartedAt,
      mimeType: recorder.mimeType || this.recorderMimeType || null,
      startedAt: chunkStartedAt,
    });

    this.recorder = recorder;
    this.activeChunkBoundaryDebug = null;
    this.activeChunkIndex = chunkIndex;
    this.activeChunkStartedAt = chunkStartedAt;
    this.activeChunkId = chunkRecord.id;
    recorder.start();
    this.patch({
      currentChunkIndex: chunkIndex,
      currentChunkStartedAt: chunkStartedAt,
      status: 'recording',
      statusMessage: `Recording audio locally. Scanning for a pause from ${(boundaryConfig.scanStartMs / 1000).toFixed(0)}s to ${(boundaryConfig.maxChunkMs / 1000).toFixed(0)}s.`,
      transcriptChunks: [chunkRecord, ...this.snapshot.transcriptChunks],
    });
    this.addEvent(
      'chunk-started',
      `Chunk ${chunkIndex} started. Preferred boundary ${(boundaryConfig.preferredChunkMs / 1000).toFixed(0)}s, scan opens ${(boundaryConfig.scanStartMs / 1000).toFixed(0)}s, hard limit ${(boundaryConfig.maxChunkMs / 1000).toFixed(0)}s.`,
      null,
    );
    this.startBoundaryTracking();
    this.scheduleChunkRotation();
  }

  private scheduleChunkRotation(): void {
    this.clearChunkRotationTimer();
    this.chunkRotationTimer = window.setTimeout(
      () => this.rotateChunk(),
      buildAdaptiveChunkBoundaryConfig(this.snapshot.chunkSeconds).maxChunkMs,
    );
  }

  private rotateChunk(boundaryDebug: AdaptiveChunkBoundaryDebug | null = null): void {
    const rotationTimer = this.chunkRotationTimer;
    this.chunkRotationTimer = null;
    if (rotationTimer !== null) {
      window.clearTimeout(rotationTimer);
    }

    if (this.pendingStop || !this.recorder || this.recorder.state === 'inactive' || this.recorderStopMode !== null) {
      return;
    }

    this.activeChunkBoundaryDebug = boundaryDebug ?? this.buildChunkBoundaryDebug('hard-limit');
    this.stopBoundaryTracking();
    this.recorderStopMode = 'chunk';
    this.recorder.stop();
  }

  private clearChunkRotationTimer(): void {
    if (this.chunkRotationTimer === null) {
      return;
    }

    window.clearTimeout(this.chunkRotationTimer);
    this.chunkRotationTimer = null;
  }

  private startBoundaryTracking(): void {
    this.stopBoundaryTracking();

    if (!this.audioStream || typeof AudioContext === 'undefined') {
      return;
    }

    try {
      const audioContext = new AudioContext();
      const sourceNode = audioContext.createMediaStreamSource(this.audioStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.25;
      sourceNode.connect(analyser);
      this.chunkBoundaryMonitor = {
        analyser,
        audioContext,
        planner: new AdaptiveChunkBoundaryPlanner(this.snapshot.chunkSeconds),
        sampleBuffer: new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>,
        sourceNode,
      };
      void audioContext.resume().catch((error) => {
        console.warn('[recorder] failed to resume AudioContext for adaptive chunking', error);
      });
      this.chunkBoundaryMonitorTimer = window.setInterval(
        () => this.sampleChunkBoundary(),
        ADAPTIVE_CHUNK_ANALYSIS_INTERVAL_MS,
      );
    } catch (error) {
      console.warn('[recorder] adaptive chunk analysis is unavailable; using hard-limit fallback only', error);
      this.stopBoundaryTracking();
    }
  }

  private stopBoundaryTracking(): void {
    if (this.chunkBoundaryMonitorTimer !== null) {
      window.clearInterval(this.chunkBoundaryMonitorTimer);
      this.chunkBoundaryMonitorTimer = null;
    }

    const monitor = this.chunkBoundaryMonitor;
    this.chunkBoundaryMonitor = null;
    if (!monitor) {
      return;
    }

    monitor.sourceNode.disconnect();
    monitor.analyser.disconnect();
    void monitor.audioContext.close().catch((error) => {
      console.warn('[recorder] failed to close adaptive chunk AudioContext', error);
    });
  }

  private sampleChunkBoundary(): void {
    const monitor = this.chunkBoundaryMonitor;
    const chunkStartedAt = this.activeChunkStartedAt;

    if (!monitor || chunkStartedAt === null || !this.recorder || this.recorder.state === 'inactive' || this.recorderStopMode !== null) {
      return;
    }

    monitor.analyser.getFloatTimeDomainData(monitor.sampleBuffer);
    const chunkDurationMs = Date.now() - chunkStartedAt;
    const boundaryDebug = monitor.planner.observe({
      elapsedMs: chunkDurationMs,
      rms: computeRms(monitor.sampleBuffer),
    });

    if (!boundaryDebug) {
      return;
    }

    console.info('[recorder] adaptive chunk boundary selected', {
      boundary: boundaryDebug,
      chunkIndex: this.activeChunkIndex,
    });
    this.rotateChunk(boundaryDebug);
  }

  private resolveActiveChunkBoundaryDebug(chunkDurationMs: number): AdaptiveChunkBoundaryDebug | null {
    if (!this.activeChunkBoundaryDebug) {
      return null;
    }

    const { summary: _summary, ...boundaryDebug } = this.activeChunkBoundaryDebug;
    return createAdaptiveChunkBoundaryDebug({
      ...boundaryDebug,
      chunkDurationMs,
    });
  }

  private buildChunkBoundaryDebug(reason: 'hard-limit' | 'pause-request' | 'stop-request'): AdaptiveChunkBoundaryDebug | null {
    const chunkDurationMs = this.activeChunkStartedAt === null ? null : Date.now() - this.activeChunkStartedAt;
    if (chunkDurationMs === null) {
      return null;
    }

    const config = this.chunkBoundaryMonitor?.planner.getConfig() ?? buildAdaptiveChunkBoundaryConfig(this.snapshot.chunkSeconds);
    return createAdaptiveChunkBoundaryDebug({
      ...config,
      chunkDurationMs,
      fallbackUsed: reason === 'hard-limit',
      noiseFloorRms: null,
      reason,
      rms: null,
      scanWindowOpened: chunkDurationMs >= config.scanStartMs,
      silenceDurationMs: null,
      thresholdRms: null,
    });
  }

  private updateTranscriptChunk(chunkId: string, patch: Partial<TranscriptChunkRecord>): void {
    this.patch({
      transcriptChunks: updateTranscriptChunkRecord(this.snapshot.transcriptChunks, chunkId, patch),
    });
    this.refreshPostCaptureStatus();
  }

  private beginQueueSettlement(): void {
    const runId = ++this.queueSettlementRunId;
    void this.transcriptionQueue.waitForIdle().then(() => {
      if (this.disposed || runId !== this.queueSettlementRunId) {
        return;
      }

      this.finalizeSession();
    });
  }

  private buildCompletedStatusMessage(): string {
    return this.buildCompletedStatusMessageForChunks(this.snapshot.transcriptChunks);
  }

  private buildCompletedStatusMessageForChunks(transcriptChunks: TranscriptChunkRecord[]): string {
    const summary = summarizeTranscriptChunks(transcriptChunks);
    return summary.completedCount > 0
      ? `Completed ${summary.completedCount} chunk${summary.completedCount === 1 ? '' : 's'}.`
      : 'Completed with no saved chunks.';
  }

  private buildFailedStatusMessage(): string {
    return this.buildFailedStatusMessageForChunks(this.snapshot.transcriptChunks);
  }

  private buildFailedStatusMessageForChunks(transcriptChunks: TranscriptChunkRecord[]): string {
    const summary = summarizeTranscriptChunks(transcriptChunks);

    if (summary.completedCount > 0 && summary.failedCount > 0) {
      return `${summary.completedCount} chunk${summary.completedCount === 1 ? '' : 's'} preserved. ${summary.failedCount} chunk${summary.failedCount === 1 ? ' needs' : 's need'} retry.`;
    }

    if (summary.failedCount > 0) {
      return `${summary.failedCount} chunk${summary.failedCount === 1 ? ' failed' : 's failed'}. Retry the failed work to continue this lesson.`;
    }

    return this.snapshot.errorMessage ?? 'Capture failed.';
  }

  private abortQueuedTranscriptionWork(): void {
    this.transcriptionGeneration += 1;
    this.transcriptionQueue = createTaskQueue(2);
    this.queueSettlementRunId += 1;
  }

  private stopActiveCaptureForManualOverride(): void {
    this.recorderGeneration += 1;
    this.stopBoundaryTracking();
    this.clearChunkRotationTimer();
    this.cleanupStreams();
    this.pendingStop = false;
    this.recorderStopMode = null;
    this.activeChunkBoundaryDebug = null;
    this.activeChunkIndex = null;
    this.activeChunkStartedAt = null;
    this.activeChunkId = null;

    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch (error) {
        console.warn('[recorder] failed to stop recorder during manual override', error);
      }
    }
    this.recorder = null;
  }

  private clearPersistedSnapshot(sessionId: string | null): void {
    if (!sessionId) {
      return;
    }

    try {
      window.localStorage.removeItem(`recorder-snapshot-${sessionId}`);
      if (window.localStorage.getItem('last-recorder-session-id') === sessionId) {
        window.localStorage.removeItem('last-recorder-session-id');
      }
    } catch (error) {
      console.warn('[recorder] failed to clear persisted snapshot from localStorage', error);
    }
  }

  private buildProcessingStatusMessage(
    summary = summarizeTranscriptChunks(this.snapshot.transcriptChunks),
    background = false,
  ): string {
    const chunkLabel = `${summary.backlogCount} queued chunk${summary.backlogCount === 1 ? '' : 's'}`;
    return background
      ? `Capture finished. ${chunkLabel} continue processing in the background.`
      : `Processing ${chunkLabel} before finishing this lesson.`;
  }

  private finalizeSession(): void {
    const summary = summarizeTranscriptChunks(this.snapshot.transcriptChunks);
    if (summary.backlogCount > 0) {
      if (this.snapshot.status !== 'processing') {
        this.patch({
          status: 'processing',
          statusMessage: this.buildProcessingStatusMessage(summary, this.stopBehavior === 'immediate'),
        });
      }
      return;
    }

    this.stopBehavior = 'wait';
    this.patch({
      status: summary.failedCount > 0 || this.snapshot.status === 'failed' ? 'failed' : 'completed',
      statusMessage: summary.failedCount > 0 || this.snapshot.status === 'failed'
        ? this.buildFailedStatusMessage()
        : this.buildCompletedStatusMessage(),
      stoppedAt: this.snapshot.stoppedAt ?? Date.now(),
    });
    this.stopResolver?.();
    this.stopResolver = null;
  }

  private refreshPostCaptureStatus(): void {
    if (this.snapshot.status !== 'processing') {
      return;
    }

    const summary = summarizeTranscriptChunks(this.snapshot.transcriptChunks);
    if (summary.backlogCount > 0) {
      this.patch({
        statusMessage: this.buildProcessingStatusMessage(summary, this.stopBehavior === 'immediate'),
      });
      return;
    }

    this.finalizeSession();
  }

  private addEvent(
    type: RecorderLifecycleEventType,
    message: string,
    details: Pick<RecorderLifecycleEvent, 'chunkDurationMs' | 'chunkIndex' | 'chunkSizeBytes' | 'mimeType'> | null,
  ): void {
    const event: RecorderLifecycleEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      message,
      timestamp: Date.now(),
      chunkDurationMs: details?.chunkDurationMs ?? null,
      chunkIndex: details?.chunkIndex ?? null,
      chunkSizeBytes: details?.chunkSizeBytes ?? null,
      mimeType: details?.mimeType ?? null,
    };

    this.patch({
      events: [event, ...this.snapshot.events].slice(0, MAX_EVENTS),
    });
  }

  private patch(patch: Partial<RecorderSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
    };

    if (this.snapshot.sessionId) {
      try {
        window.localStorage.setItem(`recorder-snapshot-${this.snapshot.sessionId}`, JSON.stringify(this.snapshot));
        window.localStorage.setItem('last-recorder-session-id', this.snapshot.sessionId);
      } catch (error) {
        console.warn('[recorder] failed to persist snapshot to localStorage', error);
      }
    }

    this.emit();
  }

  private emit(): void {
    this.onSnapshot({ ...this.snapshot, events: [...this.snapshot.events] });
  }
}
