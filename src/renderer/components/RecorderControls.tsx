import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, Pause, Play, RotateCcw, Square, TimerReset } from 'lucide-react';
import {
  ADAPTIVE_CHUNK_DEFAULT_SECONDS,
  ADAPTIVE_CHUNK_MAX_SECONDS,
  normalizeAdaptiveChunkSeconds,
} from '../../shared/adaptive-chunking.js';
import type {
  AppRecordingIndicatorState,
  AppSettings,
  DesktopSourceSummary,
  StudySession,
  Course,
  Lesson,
} from '../../shared/types.js';
import {
  AudioRecorder,
  createIdleRecorderSnapshot,
  type RecorderLifecycleEvent,
  type RecorderSnapshot,
} from '../audio-recorder.js';
import {
  buildStudySession,
  summarizeTranscriptChunks,
  type TranscriptChunkRecord,
} from '../../shared/transcription-session.js';

type RecorderControlsProps = {
  isSetupComplete: boolean;
  setupStatusMessage: string;
  selectedSource: DesktopSourceSummary | null;
  settings: AppSettings;
  activeCourse: Course | null;
  activeLesson: Lesson | null;
  onSessionChange: (session: StudySession | null) => void;
  onRecorderSnapshotChange: (snapshot: RecorderSnapshot) => void;
  onTranscriptSessionReset: () => void;
};

type CaptureAttribution = {
  courseId: string | undefined;
  courseName: string | undefined;
  lessonId: string | undefined;
  lessonName: string | undefined;
  sessionId: string | null;
};

const CAPTURE_ATTRIBUTION_STORAGE_PREFIX = 'recorder-session-attribution-';
const DEFAULT_CHUNK_SECONDS = ADAPTIVE_CHUNK_DEFAULT_SECONDS;

function getChunkSeconds(settings: AppSettings): number {
  if (!Number.isInteger(settings.chunkSeconds) || settings.chunkSeconds <= 0) {
    return DEFAULT_CHUNK_SECONDS;
  }

  return normalizeAdaptiveChunkSeconds(settings.chunkSeconds);
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) {
    return null;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

function getStatusClass(status: RecorderSnapshot['status']): string {
  switch (status) {
    case 'recording':
      return 'recording';
    case 'paused':
      return 'paused';
    case 'processing':
      return 'processing';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'starting':
    case 'pausing':
    case 'stopping':
      return 'working';
    case 'idle':
      return 'idle';
  }
}

function getDisplayState(snapshot: RecorderSnapshot): string {
  switch (snapshot.status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'paused':
    case 'pausing':
      return 'paused';
    case 'processing':
      return 'processing backlog';
    case 'recording':
    case 'starting':
      return 'recording';
    case 'stopping':
      return 'stopping';
    case 'idle':
      return 'idle';
  }
}

function getAppRecordingIndicatorState(status: RecorderSnapshot['status']): AppRecordingIndicatorState {
  switch (status) {
    case 'starting':
    case 'recording':
      return 'recording';
    case 'pausing':
    case 'paused':
      return 'paused';
    case 'stopping':
    case 'processing':
      return 'stopping';
    default:
      return 'idle';
  }
}

export function RecorderControls({
  isSetupComplete,
  setupStatusMessage,
  onSessionChange,
  onRecorderSnapshotChange,
  onTranscriptSessionReset,
  selectedSource,
  settings,
  activeCourse,
  activeLesson,
}: RecorderControlsProps) {
  const [snapshot, setSnapshot] = useState<RecorderSnapshot>(() => createIdleRecorderSnapshot());
  const [now, setNow] = useState(() => Date.now());
  const [retryingChunkId, setRetryingChunkId] = useState<string | null>(null);
  const [isRetryingLesson, setIsRetryingLesson] = useState(false);
  const lastResetSessionIdRef = useRef<string | null>(null);
  const liveIndicatorSessionRef = useRef(false);
  const pendingAttributionRef = useRef<CaptureAttribution | null>(null);
  const preserveSessionOnResetRef = useRef(false);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const recorderSessionAttributionRef = useRef<CaptureAttribution | null>(null);
  const chunkSeconds = getChunkSeconds(settings);
  const chunkSummary = useMemo(() => summarizeTranscriptChunks(snapshot.transcriptChunks), [snapshot.transcriptChunks]);
  const displayState = getDisplayState(snapshot);
  const isStarting = snapshot.status === 'starting';
  const isRecording = snapshot.status === 'recording';
  const isPausing = snapshot.status === 'pausing';
  const isPaused = snapshot.status === 'paused';
  const isProcessing = snapshot.status === 'processing';
  const isStopping = snapshot.status === 'stopping';
  const hasBacklog = chunkSummary.backlogCount > 0;
  const failedChunkCount = chunkSummary.failedCount;
  const isTranscriptionCatchingUp = hasBacklog;

  const canStart = Boolean(selectedSource)
    && isSetupComplete
    && !isStarting
    && !isRecording
    && !isPausing
    && !isPaused
    && !isStopping
    && !isProcessing;
  const canStop = isStarting || isRecording || isPausing || isPaused;
  const canPause = isRecording;
  const canResume = isPaused;
  const canFinishNow = (isStopping || isProcessing) && hasBacklog;
  const canForceFinish = Boolean(snapshot.sessionId) && hasBacklog;
  const canResetRecorder = Boolean(snapshot.sessionId) || snapshot.status !== 'idle';
  const canRetryLesson = failedChunkCount > 0 && !isRecording && !isStarting && !isPausing && !isStopping;
  const hasActiveRecorderSession = isStarting || isRecording || isPausing || isPaused || isStopping || isProcessing;

  const recorderStatusMessage = !isSetupComplete && !hasActiveRecorderSession
    ? setupStatusMessage
    : snapshot.statusMessage;

  const displayStatusMessage = isPaused && isTranscriptionCatchingUp
    ? `${recorderStatusMessage} (Transcription catching up...)`
    : recorderStatusMessage;

  useEffect(() => {
    let initialSnapshot: RecorderSnapshot | undefined;
    try {
      const lastSessionId = window.localStorage.getItem('last-recorder-session-id');
      if (lastSessionId) {
        const stored = window.localStorage.getItem(`recorder-snapshot-${lastSessionId}`);
        if (stored) {
          initialSnapshot = JSON.parse(stored);
          if (initialSnapshot?.sessionId && initialSnapshot.status !== 'idle' && initialSnapshot.status !== 'completed') {
            lastResetSessionIdRef.current = initialSnapshot.sessionId;
          }
        }
      }
    } catch (error) {
      console.error('[recorder] failed to load initial snapshot from localStorage', error);
    }

    recorderRef.current = new AudioRecorder(setSnapshot, initialSnapshot);

    return () => {
      recorderRef.current?.dispose();
      recorderRef.current = null;
    };
  }, []);

  useEffect(() => {
    onRecorderSnapshotChange(snapshot);
  }, [onRecorderSnapshotChange, snapshot]);

  useEffect(() => {
    if (snapshot.status === 'idle' || snapshot.status === 'completed' || snapshot.status === 'failed') {
      liveIndicatorSessionRef.current = false;
    }

    const indicatorState = liveIndicatorSessionRef.current
      ? getAppRecordingIndicatorState(snapshot.status)
      : 'idle';

    window.studyCapture?.setRecordingIndicatorState(indicatorState).catch((error) => {
      console.debug('[recorder] failed to update recording indicator state', error);
    });
  }, [snapshot.status]);

  useEffect(() => {
    if (!isRecording && !isPausing && !isStopping && !isPaused) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [isRecording, isPausing, isStopping, isPaused]);

  useEffect(() => {
    if (snapshot.status !== 'recording' || !snapshot.sessionId) {
      return;
    }

    if (lastResetSessionIdRef.current === snapshot.sessionId) {
      return;
    }

    lastResetSessionIdRef.current = snapshot.sessionId;
    onTranscriptSessionReset();
  }, [onTranscriptSessionReset, snapshot.sessionId, snapshot.status]);

  useEffect(() => {
    if (!snapshot.sessionId) {
      pendingAttributionRef.current = null;
      recorderSessionAttributionRef.current = null;
      return;
    }

    if (recorderSessionAttributionRef.current?.sessionId === snapshot.sessionId) {
      return;
    }

    const nextAttribution = readPersistedCaptureAttribution(snapshot.sessionId) ?? {
      ...createCaptureAttribution(snapshot.sessionId, activeCourse, activeLesson),
      ...pendingAttributionRef.current,
      sessionId: snapshot.sessionId,
    };
    recorderSessionAttributionRef.current = nextAttribution;
    persistCaptureAttribution(nextAttribution);
    pendingAttributionRef.current = null;
  }, [activeCourse, activeLesson, snapshot.sessionId]);

  useEffect(() => {
    const sessionAttribution = recorderSessionAttributionRef.current?.sessionId === snapshot.sessionId
      ? recorderSessionAttributionRef.current
      : null;

    const nextSession = buildStudySession({
      courseId: sessionAttribution?.courseId,
      courseName: sessionAttribution?.courseName,
      endedAt: snapshot.stoppedAt,
      id: snapshot.sessionId,
      lessonId: sessionAttribution?.lessonId,
      lessonName: sessionAttribution?.lessonName,
      rawTranscript: snapshot.rawTranscriptText,
      sourceName: snapshot.sourceName,
      startedAt: snapshot.startedAt,
    });

    if (!nextSession && preserveSessionOnResetRef.current) {
      preserveSessionOnResetRef.current = false;
      return;
    }

    if (!nextSession && snapshot.status === 'idle') {
      return;
    }

    onSessionChange(nextSession);
  }, [
    activeCourse?.id,
    activeLesson?.id,
    onSessionChange,
    snapshot.rawTranscriptText,
    snapshot.sessionId,
    snapshot.sourceName,
    snapshot.startedAt,
    snapshot.stoppedAt,
  ]);

  const elapsedChunkSeconds = useMemo(() => {
    if (!snapshot.currentChunkStartedAt) {
      return 0;
    }

    return Math.max(0, Math.floor((now - snapshot.currentChunkStartedAt) / 1000));
  }, [now, snapshot.currentChunkStartedAt]);

  const chunkProgress = Math.min(100, (elapsedChunkSeconds / ADAPTIVE_CHUNK_MAX_SECONDS) * 100);
  const activeSourceName = snapshot.sourceName ?? selectedSource?.name ?? 'No source selected';
  const activeCaptureAttribution = recorderSessionAttributionRef.current?.sessionId === snapshot.sessionId
    ? recorderSessionAttributionRef.current
    : null;
  const activeCourseName = activeCaptureAttribution?.courseName ?? activeCourse?.name;
  const activeLessonName = activeCaptureAttribution?.lessonName ?? activeLesson?.name ?? 'Desktop capture';
  const captureContextLabel = activeCourseName ? `${activeCourseName} | ${activeSourceName}` : activeSourceName;
  const startButtonLabel = isStarting ? 'Starting...' : 'Start';
  const stopButtonLabel = isPaused ? 'Finish' : isStopping ? 'Finishing...' : 'Stop';

  async function handleStart() {
    if (!selectedSource || !recorderRef.current) {
      return;
    }

    liveIndicatorSessionRef.current = true;
    pendingAttributionRef.current = createCaptureAttribution(null, activeCourse, activeLesson);
    await recorderRef.current.start({
      chunkSeconds,
      source: selectedSource,
    });
  }

  async function handleStop() {
    await recorderRef.current?.stop();
  }

  async function handlePause() {
    recorderRef.current?.pause();
  }

  async function handleResume() {
    await recorderRef.current?.resume();
  }

  async function handleRetryChunk(chunkId: string) {
    if (!recorderRef.current) {
      return;
    }

    setRetryingChunkId(chunkId);
    try {
      await recorderRef.current.retryTranscriptChunk(chunkId);
    } finally {
      setRetryingChunkId((current) => (current === chunkId ? null : current));
    }
  }

  async function handleRetryLesson() {
    if (!recorderRef.current) {
      return;
    }

    setIsRetryingLesson(true);
    try {
      await recorderRef.current.retryFailedTranscriptChunks();
    } finally {
      setIsRetryingLesson(false);
    }
  }

  function handleFinishNow() {
    recorderRef.current?.finishNow();
  }

  function handleForceFinish() {
    recorderRef.current?.forceFinishSession();
  }

  function handleResetRecorder() {
    preserveSessionOnResetRef.current = true;
    clearPersistedCaptureAttribution(snapshot.sessionId);
    pendingAttributionRef.current = null;
    recorderSessionAttributionRef.current = null;
    recorderRef.current?.resetSession();
  }

  return (
    <section className="recorder-panel">
      <div className="recorder-head">
        <div>
          <p className="eyebrow">Audio recorder</p>
          <h3>{activeLessonName}</h3>
          <span>{captureContextLabel}</span>
        </div>
        <div className={`recorder-status ${getStatusClass(snapshot.status)}`}>
          {displayState}
        </div>
      </div>

      <div className="recorder-grid">
        <div className="recorder-control-card">
          <div className="source-summary">
            <div>Source</div>
            <strong>{activeSourceName}</strong>
            <p>
              {selectedSource ? `${selectedSource.type} | ${selectedSource.id}` : 'Select a source before starting.'}
            </p>
          </div>

          <div className="transport-row">
            {isPaused ? (
              <button
                type="button"
                onClick={() => void handleResume()}
                disabled={!canResume}
                className="transport-button start"
              >
                <Play size={18} />
                <span>Resume</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={!canStart}
                className={isStarting ? 'transport-button start is-loading' : 'transport-button start'}
              >
                {isStarting ? <LoaderCircle size={18} className="spin" /> : <Play size={18} />}
                <span>{startButtonLabel}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handlePause()}
              disabled={!canPause}
              className="transport-button pause"
            >
              <Pause size={18} />
              <span>Pause</span>
            </button>

            <button
              type="button"
              onClick={() => void handleStop()}
              disabled={!canStop}
              className="transport-button stop"
            >
              <Square size={18} />
              <span>{stopButtonLabel}</span>
            </button>
          </div>

          <div className="status-message">
            <strong>Status</strong>
            <p>{displayStatusMessage}</p>
            {snapshot.errorMessage ? <span>{snapshot.errorMessage}</span> : null}
          </div>

          <div className="recorder-stats">
            <MetricCard label="Chunks" value={String(chunkSummary.totalCount)} />
            <MetricCard label="Backlog" value={String(chunkSummary.backlogCount)} />
            <MetricCard label="Done" value={String(chunkSummary.completedCount)} />
            <MetricCard label="Failed" value={String(chunkSummary.failedCount)} />
          </div>

          {(canFinishNow || canForceFinish || canRetryLesson || canResetRecorder) ? (
            <div className="recorder-actions">
              {canFinishNow ? (
                <button
                  type="button"
                  onClick={handleFinishNow}
                  className="secondary-action-button"
                >
                  Finish now
                </button>
              ) : null}
              {canForceFinish ? (
                <button
                  type="button"
                  onClick={handleForceFinish}
                  className="secondary-action-button danger"
                >
                  Force finish
                </button>
              ) : null}
              {canRetryLesson ? (
                <button
                  type="button"
                  onClick={() => void handleRetryLesson()}
                  disabled={isRetryingLesson}
                  className="secondary-action-button danger"
                >
                  {isRetryingLesson ? 'Retrying lesson...' : `Retry failed lesson (${failedChunkCount})`}
                </button>
              ) : null}
              {canResetRecorder ? (
                <button
                  type="button"
                  onClick={handleResetRecorder}
                  className="secondary-action-button danger"
                >
                  Reset recorder
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="timer-card">
          <div className="timer-head">
            <div>
              <div className="eyebrow">Current chunk</div>
              <div className="timer-value">
                {formatDuration(elapsedChunkSeconds)}
                <span>/ {formatDuration(ADAPTIVE_CHUNK_MAX_SECONDS)} max</span>
              </div>
            </div>
            <div className="chunk-badge">
              <TimerReset size={18} />
              <span>{snapshot.currentChunkIndex ?? '-'}</span>
            </div>
          </div>

          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${chunkProgress}%` }}
            />
          </div>
          <p className="timer-note">
            Preferred target {formatDuration(snapshot.chunkSeconds)}. Adaptive pause scan runs before the {formatDuration(ADAPTIVE_CHUNK_MAX_SECONDS)} hard limit.
          </p>

          <div className="recorder-lists">
            <div>
              <div className="list-head">
                <span>Lifecycle</span>
                <small>{snapshot.events.length}</small>
              </div>
              <div className="compact-scroll">
                {snapshot.events.length > 0 ? (
                  snapshot.events.map((event) => <LifecycleLogItem key={event.id} event={event} />)
                ) : (
                  <div className="empty-mini">No chunks recorded yet.</div>
                )}
              </div>
            </div>
            <div>
              <div className="list-head">
                <span>Chunks</span>
                <small>{chunkSummary.totalCount} total | {chunkSummary.backlogCount} backlog</small>
              </div>
              <div className="compact-scroll">
                {snapshot.transcriptChunks.length > 0 ? (
                  snapshot.transcriptChunks.map((chunk) => (
                    <ChunkRecordItem
                      key={chunk.id}
                      chunk={chunk}
                      isRetrying={retryingChunkId === chunk.id}
                      onRetry={handleRetryChunk}
                    />
                  ))
                ) : (
                  <div className="empty-mini">No saved chunks yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
};

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="metric-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function createCaptureAttribution(
  sessionId: string | null,
  activeCourse: Course | null,
  activeLesson: Lesson | null,
): CaptureAttribution {
  return {
    courseId: activeCourse?.id,
    courseName: activeCourse?.name,
    lessonId: activeLesson?.id,
    lessonName: activeLesson?.name,
    sessionId,
  };
}

function readPersistedCaptureAttribution(sessionId: string): CaptureAttribution | null {
  try {
    const stored = window.localStorage.getItem(`${CAPTURE_ATTRIBUTION_STORAGE_PREFIX}${sessionId}`);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as unknown;
    return normalizeCaptureAttribution(parsed, sessionId);
  } catch (error) {
    console.warn('[recorder] failed to load persisted session attribution', error);
    return null;
  }
}

function persistCaptureAttribution(attribution: CaptureAttribution): void {
  if (!attribution.sessionId) {
    return;
  }

  try {
    window.localStorage.setItem(
      `${CAPTURE_ATTRIBUTION_STORAGE_PREFIX}${attribution.sessionId}`,
      JSON.stringify(attribution),
    );
  } catch (error) {
    console.warn('[recorder] failed to persist session attribution', error);
  }
}

function clearPersistedCaptureAttribution(sessionId: string | null): void {
  if (!sessionId) {
    return;
  }

  try {
    window.localStorage.removeItem(`${CAPTURE_ATTRIBUTION_STORAGE_PREFIX}${sessionId}`);
  } catch (error) {
    console.warn('[recorder] failed to clear persisted session attribution', error);
  }
}

function normalizeCaptureAttribution(value: unknown, sessionId: string): CaptureAttribution | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.sessionId !== sessionId) {
    return null;
  }

  return {
    courseId: normalizeOptionalString(candidate.courseId),
    courseName: normalizeOptionalString(candidate.courseName),
    lessonId: normalizeOptionalString(candidate.lessonId),
    lessonName: normalizeOptionalString(candidate.lessonName),
    sessionId,
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

type LifecycleLogItemProps = {
  event: RecorderLifecycleEvent;
};

function LifecycleLogItem({ event }: LifecycleLogItemProps) {
  const sizeLabel = formatBytes(event.chunkSizeBytes);

  return (
    <div className="log-item">
      <div>
        <strong>{event.message}</strong>
        <time>{formatTime(event.timestamp)}</time>
      </div>
      <p>
        <span>{event.type}</span>
        {event.chunkDurationMs !== null ? <span>{formatDuration(Math.round(event.chunkDurationMs / 1000))}</span> : null}
        {sizeLabel ? <span>{sizeLabel}</span> : null}
        {event.mimeType ? <span>{event.mimeType}</span> : null}
      </p>
    </div>
  );
}

type ChunkRecordItemProps = {
  chunk: TranscriptChunkRecord;
  isRetrying: boolean;
  onRetry: (chunkId: string) => Promise<void>;
};

function ChunkRecordItem({ chunk, isRetrying, onRetry }: ChunkRecordItemProps) {
  const statusClass =
    chunk.status === 'done'
      ? 'done'
      : chunk.status === 'transcribing'
        ? 'transcribing'
        : chunk.status === 'pending'
          ? 'pending'
        : chunk.status === 'recording'
          ? 'recording'
        : 'failed';

  return (
    <div className="chunk-item">
      <div className="chunk-title">
        <strong>Chunk {chunk.chunkIndex}</strong>
        <div className={`chunk-status ${statusClass}`}>
          {chunk.status}
        </div>
      </div>
      <p className="chunk-meta">
        {chunk.chunkDurationMs !== null ? <span>{formatDuration(Math.round(chunk.chunkDurationMs / 1000))}</span> : null}
        <span>{formatBytes(chunk.chunkSizeBytes)}</span>
        {chunk.mimeType ? <span>{chunk.mimeType}</span> : null}
      </p>
      <div className="chunk-copy">
        {chunk.boundaryDebug ? <small>{chunk.boundaryDebug.summary}</small> : null}
        {chunk.status === 'recording' ? (
          <div>Recording chunk locally...</div>
        ) : chunk.status === 'pending' ? (
          <div>Queued for local transcription...</div>
        ) : chunk.status === 'transcribing' ? (
          <div>Saving and transcribing locally...</div>
        ) : chunk.status === 'done' && chunk.transcriptText ? (
          <div>{chunk.transcriptText}</div>
        ) : chunk.errorMessage ? (
          <div>{chunk.errorMessage}</div>
        ) : (
          <div>Waiting for transcription...</div>
        )}
        {chunk.audioPath ? <small>{chunk.audioPath}</small> : null}
      </div>
      {chunk.status === 'failed' ? (
        <div className="chunk-retry">
          <p>Local transcription failed.</p>
          <button
            type="button"
            onClick={() => void onRetry(chunk.id)}
            disabled={isRetrying}
            className="retry-button"
          >
            <RotateCcw size={14} />
            {isRetrying ? 'Retrying' : 'Retry'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
