import type { AdaptiveChunkBoundaryDebug } from './adaptive-chunking.js';
import type { StudySession } from './types.js';

export type TranscriptChunkStatus = 'recording' | 'pending' | 'transcribing' | 'done' | 'failed';

export type TranscriptChunkSummary = {
  backlogCount: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  recordingCount: number;
  retryableFailedCount: number;
  totalCount: number;
  transcribingCount: number;
};

export type TranscriptChunkRecord = {
  audioPath: string | null;
  boundaryDebug: AdaptiveChunkBoundaryDebug | null;
  chunkIndex: number;
  chunkDurationMs: number | null;
  chunkSizeBytes: number;
  createdAt: number;
  errorMessage: string | null;
  id: string;
  mimeType: string | null;
  savedAt: number | null;
  startedAt: number;
  transcriptText: string | null;
  status: TranscriptChunkStatus;
};

type TranscriptChunkDraft = Pick<
  TranscriptChunkRecord,
  'audioPath' | 'boundaryDebug' | 'chunkDurationMs' | 'chunkIndex' | 'chunkSizeBytes' | 'createdAt' | 'errorMessage' | 'id' | 'mimeType' | 'savedAt' | 'startedAt' | 'transcriptText' | 'status'
>;

export type TranscriptChunkInput = {
  chunkIndex: number;
  chunkSizeBytes: number;
  createdAt?: number;
  mimeType: string | null;
  startedAt: number;
};

export type StudySessionInput = {
  courseId?: string | null | undefined;
  courseName?: string | null | undefined;
  endedAt: number | null;
  id?: string | null;
  lessonId?: string | null | undefined;
  lessonName?: string | null | undefined;
  rawTranscript: string;
  sourceName: string | null;
  startedAt: number | null;
  title?: string | null;
};

export function createTranscriptChunkId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createStudySessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSessionTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

export function createStudySessionTitle(sourceName: string, startedAt: number): string {
  return `${sourceName} session - ${formatSessionTimestamp(startedAt)}`;
}

export function createRecordingTranscriptChunk(input: TranscriptChunkInput): TranscriptChunkRecord {
  return {
    audioPath: null,
    boundaryDebug: null,
    chunkDurationMs: null,
    chunkIndex: input.chunkIndex,
    chunkSizeBytes: input.chunkSizeBytes,
    createdAt: input.createdAt ?? input.startedAt,
    errorMessage: null,
    id: createTranscriptChunkId(),
    mimeType: input.mimeType,
    savedAt: null,
    startedAt: input.startedAt,
    transcriptText: null,
    status: 'recording',
  };
}

export function updateTranscriptChunkRecord(
  transcriptChunks: TranscriptChunkRecord[],
  chunkId: string,
  patch: Partial<TranscriptChunkDraft>,
): TranscriptChunkRecord[] {
  return transcriptChunks.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...patch } : chunk));
}

export function buildRawTranscriptText(transcriptChunks: TranscriptChunkRecord[]): string {
  const completedChunks = [...transcriptChunks]
    .filter((chunk) => chunk.status === 'done' && typeof chunk.transcriptText === 'string' && chunk.transcriptText.trim().length > 0)
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .map((chunk) => chunk.transcriptText!.trim());

  return completedChunks.join('\n\n');
}

export function summarizeTranscriptChunks(transcriptChunks: TranscriptChunkRecord[]): TranscriptChunkSummary {
  let completedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  let recordingCount = 0;
  let retryableFailedCount = 0;
  let transcribingCount = 0;

  for (const chunk of transcriptChunks) {
    switch (chunk.status) {
      case 'done':
        completedCount += 1;
        break;
      case 'failed':
        failedCount += 1;
        if (chunk.audioPath || chunk.savedAt !== null) {
          retryableFailedCount += 1;
        }
        break;
      case 'pending':
        pendingCount += 1;
        break;
      case 'recording':
        recordingCount += 1;
        break;
      case 'transcribing':
        transcribingCount += 1;
        break;
    }
  }

  return {
    backlogCount: pendingCount + transcribingCount,
    completedCount,
    failedCount,
    pendingCount,
    recordingCount,
    retryableFailedCount,
    totalCount: transcriptChunks.length,
    transcribingCount,
  };
}

export function buildStudySession(input: StudySessionInput): StudySession | null {
  if (!input.sourceName || input.startedAt === null) {
    return null;
  }

  return {
    bookContextUsed: [],
    correctedTranscript: '',
    courseId: input.courseId ?? undefined,
    courseName: input.courseName ?? undefined,
    detectedTopics: [],
    endedAt: input.endedAt,
    id: input.id ?? createStudySessionId(),
    lessonId: input.lessonId ?? undefined,
    lessonName: input.lessonName ?? undefined,
    polishingResult: null,
    rawTranscript: input.rawTranscript,
    reviewItems: [],
    sourceName: input.sourceName,
    startedAt: input.startedAt,
    summary: '',
    title: input.title?.trim() || createStudySessionTitle(input.sourceName, input.startedAt),
  };
}
