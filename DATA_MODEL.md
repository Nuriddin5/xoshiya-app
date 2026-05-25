# Data Model

## Core Types

```ts
export type AppSettings = {
  aiProvider: "openai" | "deepseek";
  aiApiKey: string;
  aiBaseUrl: string;
  correctionModel: string;
  summaryModel: string;
  chunkSeconds: number;
  saveFolder: string;
};

export type RubaiRuntimeStatus = {
  isReady: boolean;
  backend: string | null;
  pythonPath: string;
  modelPath: string;
  missingItems: string[];
  message: string;
};

export type TranscriptChunk = {
  id: string;
  audioPath?: string;
  chunkIndex: number;
  chunkDurationMs?: number;
  boundaryDebug?: AdaptiveChunkBoundaryDebug;
  rawText?: string;
  status: "recording" | "pending" | "transcribing" | "done" | "failed";
  error?: string;
};

export type BookDocument = {
  id: string;
  name: string;
  importedAt: number;
  text: string;
  sections: BookSection[];
};

export type BookSnippet = {
  id: string;
  documentId: string;
  sourceName: string;
  heading: string;
  text: string;
  score: number;
  matchedTerms: string[];
  pageNumber?: number;
};

export type LessonSourceReference = {
  id: string;
  snippetId: string;
  sourceName: string;
  heading: string;
  citation: string;
  note: string;
  matchedTerms: string[];
  pageNumber?: number;
};

export type LessonPolishingResult = {
  rawTranscript: string;
  correctedTranscript: string;
  topicTitle: string;
  summary: string;
  keyPoints: string[];
  terms: { term: string; definition: string; sourceReferenceIds: string[] }[];
  flashcards: { prompt: string; answer: string; sourceReferenceIds: string[] }[];
  reviewQuestions: string[];
  sourceReferences: LessonSourceReference[];
  contextConfidence: "high" | "medium" | "low" | "missing";
  contextWarning: string;
  bookContextUsed: BookSnippet[];
  detectedTopics: DetectedTopic[];
  generatedAt: number;
};

export type StudySession = {
  id: string;
  title: string;
  sourceName: string;
  startedAt: number;
  endedAt: number | null;
  rawTranscript: string;
  correctedTranscript: string;
  summary: string;
  bookContextUsed: BookSnippet[];
  detectedTopics: DetectedTopic[];
  reviewItems: string[];
  polishingResult: LessonPolishingResult | null;
};
```

## State Relationships

- `StudySession.rawTranscript` is derived from completed transcript chunks.
- `StudySession.bookContextUsed` contains selected or auto-found snippets used for lesson polishing.
- `Lesson.lastPolishingResult` stores the latest structured AI output for that lesson and makes retry possible without re-recording.
- `StudySession.detectedTopics` is derived from lesson sections and matched book headings.
- `StudySession.reviewItems` is sourced from the structured lesson polishing result when available.
- `LessonPolishingResult.sourceReferences` only points at snippets that were actually provided to the AI prompt.

## IPC Contract

```ts
window.studyCapture = {
  getStartupState: () => Promise<StudyCaptureStartupState>,
  getSettings: () => Promise<AppSettings>,
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>,
  getDesktopSources: () => Promise<DesktopSourceSummary[]>,
  getRubaiRuntimeStatus: () => Promise<RubaiRuntimeStatus>,
  validateRubaiRuntime: () => Promise<RubaiRuntimeStatus>,
  saveAudioChunk: (arrayBuffer: ArrayBuffer) => Promise<string>,
  transcribeAudio: (audioPath: string) => Promise<string>,
  importBookText: (payload: { name: string; text: string }) => Promise<BookDocument>,
  listBookDocuments: () => Promise<BookDocument[]>,
  searchBook: (query: string) => Promise<BookSnippet[]>,
  polishLessonTranscript: (payload: {
    rawTranscript: string,
    courseName?: string,
    lessonName?: string,
    detectedTopics: DetectedTopic[],
    selectedTopic?: string,
    bookContext: BookSnippet[]
  }) => Promise<LessonPolishingResult>,
  updateLesson: (id: string, patch: Partial<Lesson>) => Promise<Lesson>
}
```

## Validation Rules

- `chunkSeconds` is the preferred adaptive chunk target and must be a whole number from `25` to `40`.
- `saveFolder` must be non-empty.
- AI provider API key and base URL are required for text correction/notes.
- Rubai runtime must be ready before recording.
- Text-only AI requests must reject audio paths, blobs, buffers, and binary media.
- Structured source references must be derived from provided book snippets instead of invented citations.
