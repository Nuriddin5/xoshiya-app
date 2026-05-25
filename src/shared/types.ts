export type AiProvider = 'openai' | 'deepseek';

export type StorageEnvironment = 'main' | 'production';

export type AppSettings = {
  aiApiKey: string;
  aiBaseUrl: string;
  aiProvider: AiProvider;
  chunkSeconds: number;
  correctionModel: string;
  mainSaveFolder: string;
  productionSaveFolder: string;
  summaryModel: string;
};

export type RequiredSetupField = 'aiApiKey' | 'aiBaseUrl';

export type SetupReadiness = {
  isComplete: boolean;
  missingFields: RequiredSetupField[];
  missingFieldLabels: string[];
  statusMessage: string;
};

export type SettingsPatch = Partial<AppSettings>;

export type SettingsValidationErrors = Partial<Record<keyof AppSettings, string>>;

export type DesktopSourceType = 'screen' | 'window';

export type DesktopSourceSummary = {
  id: string;
  name: string;
  type: DesktopSourceType;
  thumbnailDataUrl?: string;
};

export type RubaiRuntimeStatus = {
  backend: string | null;
  isReady: boolean;
  message: string;
  missingItems: string[];
  modelPath: string;
  pythonPath: string;
  worker: RubaiWorkerRuntimeStatus;
};

export type RubaiWorkerRuntimeStatus = {
  activeCount: number;
  backlogCount: number;
  completedCount: number;
  concurrency: number;
  failedCount: number;
  lastCompletedAt: number | null;
  lastProcessingMs: number | null;
  lastQueueDelayMs: number | null;
  lastRealTimeFactor: number | null;
  modelLoadMs: number | null;
  startupMs: number | null;
  state: 'stopped' | 'loading' | 'ready' | 'transcribing' | 'failed';
};

export type BookSection = {
  heading: string;
  id: string;
  pageNumber?: number | undefined;
  text: string;
};

export type BookDocument = {
  id: string;
  importedAt: number;
  name: string;
  filename?: string | undefined;
  fileType: 'text' | 'pdf' | 'docx';
  sections: BookSection[];
  text: string;
  courseId?: string | undefined;
};

export type BookSnippet = {
  documentId: string;
  heading: string;
  id: string;
  matchedTerms: string[];
  pageNumber?: number | undefined;
  score: number;
  sourceName: string;
  text: string;
};

export type CorrectTranscriptResult = {
  correctedTranscript: string;
  evidenceSnippets: BookSnippet[];
};

export type DetectedTopic = {
  id: string;
  relatedSnippetIds: string[];
  title: string;
};

export type CorrectTranscriptPayload = {
  bookContext: BookSnippet[];
  rawTranscript: string;
  courseName?: string | undefined;
  lessonName?: string | undefined;
};

export type GenerateStudyNotesPayload = {
  bookContext: BookSnippet[];
  correctedTranscript: string;
  detectedTopics: DetectedTopic[];
  courseName?: string | undefined;
  lessonName?: string | undefined;
};

export type LessonSourceReference = {
  citation: string;
  documentId: string;
  heading: string;
  id: string;
  matchedTerms: string[];
  note: string;
  pageNumber?: number | undefined;
  snippetId: string;
  sourceName: string;
};

export type LessonTerm = {
  definition: string;
  sourceReferenceIds: string[];
  term: string;
};

export type LessonFlashcard = {
  answer: string;
  prompt: string;
  sourceReferenceIds: string[];
};

export type LessonPolishingContextConfidence = 'high' | 'medium' | 'low' | 'missing';

export type LessonPolishingResult = {
  bookContextUsed: BookSnippet[];
  contextConfidence: LessonPolishingContextConfidence;
  contextWarning: string;
  correctedTranscript: string;
  courseId?: string | undefined;
  courseName?: string | undefined;
  detectedTopics: DetectedTopic[];
  flashcards: LessonFlashcard[];
  generatedAt: number;
  keyPoints: string[];
  lessonId?: string | undefined;
  lessonName?: string | undefined;
  rawTranscript: string;
  reviewQuestions: string[];
  sourceReferences: LessonSourceReference[];
  summary: string;
  terms: LessonTerm[];
  topicTitle: string;
};

export type PolishLessonTranscriptPayload = {
  bookContext: BookSnippet[];
  courseId?: string | undefined;
  courseName?: string | undefined;
  detectedTopics: DetectedTopic[];
  lessonId?: string | undefined;
  lessonName?: string | undefined;
  rawTranscript: string;
  selectedTopic?: string | undefined;
};

export type LessonQuestionAnswerPayload = {
  bookContext: BookSnippet[];
  courseName?: string | undefined;
  lessonName?: string | undefined;
  lessonOutput?: string | undefined;
  polishedLessonText?: string | undefined;
  question: string;
};

export type LessonQuestionAnswerResult = {
  answerText: string;
  bookContextUsed: BookSnippet[];
  generatedAt: number;
};

export type Course = {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  bookIds: string[];
};

export type Lesson = {
  id: string;
  courseId: string;
  lastPolishingResult?: LessonPolishingResult | undefined;
  name: string;
  createdAt: number;
  sessionIds: string[];
};

export type StudySession = {
  bookContextUsed: BookSnippet[];
  correctedTranscript: string;
  courseName?: string | undefined;
  detectedTopics: DetectedTopic[];
  endedAt: number | null;
  id: string;
  lessonId?: string | undefined;
  lessonName?: string | undefined;
  courseId?: string | undefined;
  polishingResult: LessonPolishingResult | null;
  rawTranscript: string;
  reviewItems: string[];
  sourceName: string;
  startedAt: number;
  summary: string;
  title: string;
};

export type SessionExportRecord = {
  bookContextUsed: BookSnippet[];
  correctedTranscript: string;
  courseName?: string | undefined;
  date: string;
  detectedTopics: DetectedTopic[];
  exportedAt: string;
  lessonId?: string | undefined;
  lessonName?: string | undefined;
  courseId?: string | undefined;
  polishingResult: LessonPolishingResult | null;
  rawTranscript: string;
  reviewItems: string[];
  source: string;
  summary: string;
  title: string;
  sessionId: string;
};

export type SessionExportSummary = {
  courseId?: string | undefined;
  courseName?: string | undefined;
  date: string;
  exportedAt: string;
  folderPath: string;
  hasJson: boolean;
  hasMarkdown: boolean;
  jsonPath: string;
  lessonId?: string | undefined;
  lessonName?: string | undefined;
  markdownPath: string;
  sessionId: string;
  source: string;
  title: string;
  topicCount: number;
};

export type LessonSessionRecord = SessionExportSummary & {
  correctedTranscript: string;
  rawTranscript: string;
  summary: string;
};

export type SessionExportResult = {
  jsonPath: string;
  markdownPath: string;
};

export type StudyCaptureStartupState = {
  activeSaveFolder: string;
  readiness: SetupReadiness;
  rubaiRuntime: RubaiRuntimeStatus | null;
  settings: AppSettings;
  storageEnvironment: StorageEnvironment;
};

export type AppRecordingIndicatorState = 'idle' | 'recording' | 'paused' | 'stopping';

export type StudyCaptureApi = {
  getStartupState: () => Promise<StudyCaptureStartupState>;
  getSettings: () => Promise<AppSettings>;
  getDesktopSources: () => Promise<DesktopSourceSummary[]>;
  getRubaiRuntimeStatus: () => Promise<RubaiRuntimeStatus>;
  setRecordingIndicatorState: (state: AppRecordingIndicatorState) => Promise<void>;
  importBookText: (payload: { name: string; text: string; courseId?: string | undefined }) => Promise<BookDocument>;
  importBookFile: (payload: { courseId?: string | undefined }) => Promise<BookDocument | null>;
  deleteBookDocument: (id: string) => Promise<void>;
  listBookDocuments: (options?: { courseId?: string | undefined }) => Promise<BookDocument[]>;
  searchBook: (query: string, options?: { documentIds?: string[] }) => Promise<BookSnippet[]>;
  correctTranscript: (payload: CorrectTranscriptPayload) => Promise<CorrectTranscriptResult>;
  generateStudyNotes: (payload: GenerateStudyNotesPayload) => Promise<string>;
  polishLessonTranscript: (payload: PolishLessonTranscriptPayload) => Promise<LessonPolishingResult>;
  answerLessonQuestion: (payload: LessonQuestionAnswerPayload) => Promise<LessonQuestionAnswerResult>;
  saveAudioChunk: (arrayBuffer: ArrayBuffer) => Promise<string>;
  listSessionExports: () => Promise<SessionExportSummary[]>;
  listSessionHistory: () => Promise<SessionExportSummary[]>;
  listLessonSessionRecords: (payload: { courseId: string; lessonId: string }) => Promise<LessonSessionRecord[]>;
  openSessionExportFolder: (folderPath: string) => Promise<void>;
  openSessionExportMarkdown: (markdownPath: string) => Promise<void>;
  attachSessionHistoryToLesson: (payload: { courseId: string; lessonId: string; sessionId: string }) => Promise<SessionExportResult>;
  saveSessionDraft: (session: StudySession) => Promise<SessionExportResult>;
  saveSessionHistory: (session: StudySession) => Promise<SessionExportResult>;
  saveSessionExport: (session: StudySession) => Promise<SessionExportResult>;
  deleteSessionDraft: (sessionId: string) => Promise<void>;
  deleteSessionHistory: (sessionId: string) => Promise<void>;
  clearSessionHistory: () => Promise<void>;
  transcribeAudio: (audioPath: string, metadata?: { audioDurationMs?: number | null }) => Promise<string>;
  saveSettings: (settings: SettingsPatch) => Promise<AppSettings>;
  validateRubaiRuntime: () => Promise<RubaiRuntimeStatus>;
  listCourses: () => Promise<Course[]>;
  createCourse: (payload: { name: string; description: string }) => Promise<Course>;
  updateCourse: (id: string, patch: Partial<Course>) => Promise<Course>;
  deleteCourse: (id: string) => Promise<void>;
  listLessons: (courseId: string) => Promise<Lesson[]>;
  createLesson: (payload: { courseId: string; name: string }) => Promise<Lesson>;
  updateLesson: (id: string, patch: Partial<Lesson>) => Promise<Lesson>;
  deleteLesson: (id: string) => Promise<void>;
};
