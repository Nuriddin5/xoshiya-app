import type {
  AppSettings,
  BookSnippet,
  CorrectTranscriptPayload,
  CorrectTranscriptResult,
  DetectedTopic,
  GenerateStudyNotesPayload,
  LessonQuestionAnswerPayload,
  LessonQuestionAnswerResult,
  LessonFlashcard,
  LessonPolishingResult,
  LessonTerm,
  LessonPolishingContextConfidence,
  PolishLessonTranscriptPayload,
} from '../shared/types.js';
import {
  buildCorrectTranscriptPrompt,
  buildLessonQuestionAnswerPrompt,
  buildPolishLessonPrompt,
  buildStudyNotesPrompt,
  type ChatMessage,
} from './ai-prompts.js';
import { pickPrimaryTopicTitle, resolveLessonSourceReferences } from '../shared/lesson-polishing.js';

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

const AUDIO_PATH_PATTERN = /(?:[a-z]:\\|\/)[^\n\r]+\.(?:webm|wav|mp3|ogg|flac|m4a)\b/iu;
const MAX_BOOK_CONTEXT_SNIPPETS = 6;
const MAX_BOOK_CONTEXT_TEXT_LENGTH = 1200;
const MAX_LESSON_CONTEXT_TEXT_LENGTH = 8000;
const MAX_TOPIC_COUNT = 12;
const MAX_LIST_ITEMS = 12;
const AI_PROVIDER_TIMEOUT_MS = 60_000;
const ALLOWED_CONTEXT_CONFIDENCE = new Set<LessonPolishingContextConfidence>(['high', 'medium', 'low', 'missing']);

type ChatCompletionOptions = {
  jsonMode?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeText(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }

  if (AUDIO_PATH_PATTERN.test(value)) {
    throw new Error(`${label} must not contain audio file paths.`);
  }
}

function readSafeString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`);
  }

  assertSafeText(value, label);
  return value;
}

function readSafeStringArray(record: Record<string, unknown>, key: string, label: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item, index) => {
      assertSafeText(item, `${label} ${index + 1}`);
      return item.trim();
    })
    .slice(0, 12);
}

function sanitizeBookContext(value: unknown): BookSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_BOOK_CONTEXT_SNIPPETS).map((item, index): BookSnippet => {
    if (!isRecord(item)) {
      throw new Error(`Book context snippet ${index + 1} must be a plain object.`);
    }

    const text = readSafeString(item, 'text', `Book context snippet ${index + 1} text`);

    return {
      documentId: readSafeString(item, 'documentId', `Book context snippet ${index + 1} documentId`),
      heading: readSafeString(item, 'heading', `Book context snippet ${index + 1} heading`),
      id: readSafeString(item, 'id', `Book context snippet ${index + 1} id`),
      matchedTerms: readSafeStringArray(item, 'matchedTerms', `Book context snippet ${index + 1} matched term`),
      pageNumber: typeof item.pageNumber === 'number' && Number.isFinite(item.pageNumber) ? item.pageNumber : undefined,
      score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0,
      sourceName: readSafeString(item, 'sourceName', `Book context snippet ${index + 1} sourceName`),
      text: text.slice(0, MAX_BOOK_CONTEXT_TEXT_LENGTH),
    };
  });
}

function sanitizeDetectedTopics(value: unknown): DetectedTopic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_TOPIC_COUNT).map((item, index): DetectedTopic => {
    if (!isRecord(item)) {
      throw new Error(`Detected topic ${index + 1} must be a plain object.`);
    }

    return {
      id: readSafeString(item, 'id', `Detected topic ${index + 1} id`),
      relatedSnippetIds: readSafeStringArray(item, 'relatedSnippetIds', `Detected topic ${index + 1} related snippet id`),
      title: readSafeString(item, 'title', `Detected topic ${index + 1} title`),
    };
  });
}

function normalizeOptionalSafeString(value: unknown, label: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  assertSafeText(trimmed, label);
  return trimmed;
}

function readSafeJsonArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item, index) => {
      assertSafeText(item, `${label} ${index + 1}`);
      return item.trim();
    })
    .slice(0, MAX_LIST_ITEMS);
}

function readSafeJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a plain object.`);
  }

  return value;
}

function readSafeJsonTextList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_LIST_ITEMS).map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`${label} ${index + 1} must be text.`);
    }

    const trimmed = item.trim();
    assertSafeText(trimmed, `${label} ${index + 1}`);
    return trimmed;
  });
}

function sanitizeLessonTerms(value: unknown): LessonTerm[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_LIST_ITEMS).map((item, index): LessonTerm => {
    const record = readSafeJsonObject(item, `Lesson term ${index + 1}`);
    return {
      definition: readSafeString(record, 'definition', `Lesson term ${index + 1} definition`),
      sourceReferenceIds: readSafeJsonArray(record.sourceSnippetIds, `Lesson term ${index + 1} source snippet id`),
      term: readSafeString(record, 'term', `Lesson term ${index + 1} term`),
    };
  });
}

function sanitizeLessonFlashcards(value: unknown): LessonFlashcard[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_LIST_ITEMS).map((item, index): LessonFlashcard => {
    const record = readSafeJsonObject(item, `Lesson flashcard ${index + 1}`);
    return {
      answer: readSafeString(record, 'answer', `Lesson flashcard ${index + 1} answer`),
      prompt: readSafeString(record, 'prompt', `Lesson flashcard ${index + 1} prompt`),
      sourceReferenceIds: readSafeJsonArray(record.sourceSnippetIds, `Lesson flashcard ${index + 1} source snippet id`),
    };
  });
}

function filterReferenceIds(ids: string[], availableIds: Set<string>): string[] {
  return ids.filter((id) => availableIds.has(id));
}

function resolveContextConfidence(
  candidate: string | undefined,
  hasBookContext: boolean,
): LessonPolishingContextConfidence {
  if (!hasBookContext) {
    return 'missing';
  }

  return ALLOWED_CONTEXT_CONFIDENCE.has(candidate as LessonPolishingContextConfidence)
    ? candidate as LessonPolishingContextConfidence
    : 'missing';
}

function resolveContextWarning(candidate: string | undefined, hasBookContext: boolean): string {
  if (!hasBookContext) {
    return candidate || 'No relevant book/source context was found for this lesson.';
  }

  return candidate ?? '';
}

function extractJsonObject(responseText: string): string {
  const trimmed = responseText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/u);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}

function escapeJsonControlCharactersInStrings(input: string): string {
  let output = '';
  let inString = false;
  let escaping = false;

  for (const character of input) {
    if (escaping) {
      output += character;
      escaping = false;
      continue;
    }

    if (character === '\\') {
      output += character;
      escaping = inString;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      output += character;
      continue;
    }

    if (inString) {
      const code = character.charCodeAt(0);
      if (code <= 0x1F) {
        switch (character) {
          case '\n':
            output += '\\n';
            break;
          case '\r':
            output += '\\r';
            break;
          case '\t':
            output += '\\t';
            break;
          default:
            output += `\\u${code.toString(16).padStart(4, '0')}`;
            break;
        }
        continue;
      }
    }

    output += character;
  }

  return output;
}

function removeTrailingJsonCommas(input: string): string {
  return input.replace(/,\s*([}\]])/gu, '$1');
}

function parseJsonObjectWithRepair(jsonText: string): unknown {
  const jsonObjectText = extractJsonObject(jsonText);
  const candidates = [
    jsonObjectText,
    escapeJsonControlCharactersInStrings(jsonObjectText),
    removeTrailingJsonCommas(escapeJsonControlCharactersInStrings(jsonObjectText)),
  ];
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unknown parse error.');
}

function parsePolishLessonResponse(
  responseText: string,
  payload: PolishLessonTranscriptPayload,
): LessonPolishingResult {
  let parsed: unknown;
  try {
    parsed = parseJsonObjectWithRepair(responseText);
  } catch (error) {
    throw new Error(`AI provider returned invalid lesson polishing JSON. ${error instanceof Error ? error.message : 'Unknown parse error.'}`);
  }

  const record = readSafeJsonObject(parsed, 'Lesson polishing response');
  const sourceReferenceRows = Array.isArray(record.sourceReferences) ? record.sourceReferences : [];
  const notesById = new Map<string, string>();
  const requestedIds: string[] = [];

  for (const [index, entry] of sourceReferenceRows.entries()) {
    const item = readSafeJsonObject(entry, `Source reference ${index + 1}`);
    const snippetId = readSafeString(item, 'sourceSnippetId', `Source reference ${index + 1} snippet id`);
    requestedIds.push(snippetId);
    notesById.set(snippetId, normalizeOptionalSafeString(item.note, `Source reference ${index + 1} note`) ?? '');
  }

  const topicTitle = normalizeOptionalSafeString(record.topicTitle, 'Topic title')
    ?? pickPrimaryTopicTitle(payload.selectedTopic, payload.detectedTopics, payload.rawTranscript);
  const contextConfidenceCandidate = normalizeOptionalSafeString(record.contextConfidence, 'Context confidence') ?? 'missing';
  const hasBookContext = payload.bookContext.length > 0;
  const contextConfidence = resolveContextConfidence(contextConfidenceCandidate, hasBookContext);
  const contextWarning = resolveContextWarning(
    normalizeOptionalSafeString(record.contextWarning, 'Context warning'),
    hasBookContext,
  );
  const availableReferenceIds = new Set(payload.bookContext.map((snippet) => snippet.id));
  const sourceReferences = resolveLessonSourceReferences(payload.bookContext, [...new Set(requestedIds)], notesById);

  return {
    bookContextUsed: payload.bookContext,
    contextConfidence,
    contextWarning,
    correctedTranscript: readSafeString(record, 'polishedTranscript', 'Polished transcript'),
    courseId: payload.courseId,
    courseName: normalizeOptionalSafeString(payload.courseName, 'Course name'),
    detectedTopics: payload.detectedTopics,
    flashcards: sanitizeLessonFlashcards(record.flashcards).map((item) => ({
      ...item,
      sourceReferenceIds: filterReferenceIds(item.sourceReferenceIds, availableReferenceIds),
    })),
    generatedAt: Date.now(),
    keyPoints: readSafeJsonTextList(record.keyPoints, 'Key point'),
    lessonId: payload.lessonId,
    lessonName: normalizeOptionalSafeString(payload.lessonName, 'Lesson name'),
    rawTranscript: payload.rawTranscript,
    reviewQuestions: readSafeJsonTextList(record.reviewQuestions, 'Review question'),
    sourceReferences,
    summary: readSafeString(record, 'summary', 'Summary'),
    terms: sanitizeLessonTerms(record.terms).map((item) => ({
      ...item,
      sourceReferenceIds: filterReferenceIds(item.sourceReferenceIds, availableReferenceIds),
    })),
    topicTitle,
  };
}

function buildFallbackLessonPolishingResult(
  payload: PolishLessonTranscriptPayload,
  correctedTranscript: string,
  warning: string,
): LessonPolishingResult {
  const topicTitle = pickPrimaryTopicTitle(payload.selectedTopic, payload.detectedTopics, payload.rawTranscript);
  const hasBookContext = payload.bookContext.length > 0;
  const cleanedWarning = warning.trim() || 'Structured lesson polishing failed, so only the corrected transcript was returned.';

  return {
    bookContextUsed: payload.bookContext,
    contextConfidence: hasBookContext ? 'low' : 'missing',
    contextWarning: cleanedWarning,
    correctedTranscript,
    courseId: payload.courseId,
    courseName: normalizeOptionalSafeString(payload.courseName, 'Course name'),
    detectedTopics: payload.detectedTopics,
    flashcards: [],
    generatedAt: Date.now(),
    keyPoints: [],
    lessonId: payload.lessonId,
    lessonName: normalizeOptionalSafeString(payload.lessonName, 'Lesson name'),
    rawTranscript: payload.rawTranscript,
    reviewQuestions: [],
    sourceReferences: [],
    summary: correctedTranscript,
    terms: [],
    topicTitle,
  };
}

async function createChatCompletion(
  settings: AppSettings,
  model: string,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<string> {
  assertSafeText(settings.aiApiKey, 'AI provider API key');
  assertSafeText(settings.aiBaseUrl, 'AI provider base URL');
  assertSafeText(model, 'AI provider model');

  const endpoint = `${settings.aiBaseUrl.replace(/\/+$/u, '')}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_PROVIDER_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${settings.aiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        model,
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        temperature: 0.1,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`AI provider request timed out after ${AI_PROVIDER_TIMEOUT_MS / 1000} seconds.`);
    }

    throw new Error(`AI provider request failed before receiving a response. ${error instanceof Error ? error.message : 'Unknown network error.'}`);
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({})) as ChatCompletionResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `AI provider request failed with HTTP ${response.status} ${response.statusText}.`);
  }

  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('AI provider returned an empty response.');
  }

  return text;
}

export function validateCorrectTranscriptPayload(payload: unknown): CorrectTranscriptPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Correction payload must be a plain object.');
  }

  const candidate = payload as Record<string, unknown>;
  const rawTranscript = readSafeString(candidate, 'rawTranscript', 'Raw transcript');

  return {
    bookContext: sanitizeBookContext(candidate.bookContext),
    rawTranscript,
    courseName: typeof candidate.courseName === 'string' ? candidate.courseName.trim() : undefined,
    lessonName: typeof candidate.lessonName === 'string' ? candidate.lessonName.trim() : undefined,
  };
}

export function validateGenerateStudyNotesPayload(payload: unknown): GenerateStudyNotesPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Study notes payload must be a plain object.');
  }

  const candidate = payload as Record<string, unknown>;
  const correctedTranscript = readSafeString(candidate, 'correctedTranscript', 'Corrected transcript');

  return {
    bookContext: sanitizeBookContext(candidate.bookContext),
    correctedTranscript,
    detectedTopics: sanitizeDetectedTopics(candidate.detectedTopics),
    courseName: typeof candidate.courseName === 'string' ? candidate.courseName.trim() : undefined,
    lessonName: typeof candidate.lessonName === 'string' ? candidate.lessonName.trim() : undefined,
  };
}

export function validatePolishLessonTranscriptPayload(payload: unknown): PolishLessonTranscriptPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Lesson polishing payload must be a plain object.');
  }

  const candidate = payload as Record<string, unknown>;

  return {
    bookContext: sanitizeBookContext(candidate.bookContext),
    courseId: normalizeOptionalSafeString(candidate.courseId, 'Course ID'),
    courseName: normalizeOptionalSafeString(candidate.courseName, 'Course name'),
    detectedTopics: sanitizeDetectedTopics(candidate.detectedTopics),
    lessonId: normalizeOptionalSafeString(candidate.lessonId, 'Lesson ID'),
    lessonName: normalizeOptionalSafeString(candidate.lessonName, 'Lesson name'),
    rawTranscript: readSafeString(candidate, 'rawTranscript', 'Raw transcript'),
    selectedTopic: normalizeOptionalSafeString(candidate.selectedTopic, 'Selected topic'),
  };
}

export function validateLessonQuestionAnswerPayload(payload: unknown): LessonQuestionAnswerPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Lesson question payload must be a plain object.');
  }

  const candidate = payload as Record<string, unknown>;

  return {
    bookContext: sanitizeBookContext(candidate.bookContext),
    courseName: normalizeOptionalSafeString(candidate.courseName, 'Course name'),
    lessonName: normalizeOptionalSafeString(candidate.lessonName, 'Lesson name'),
    lessonOutput: normalizeOptionalSafeString(candidate.lessonOutput, 'Lesson output')?.slice(0, MAX_LESSON_CONTEXT_TEXT_LENGTH),
    polishedLessonText: normalizeOptionalSafeString(candidate.polishedLessonText, 'Polished lesson text')?.slice(0, MAX_LESSON_CONTEXT_TEXT_LENGTH),
    question: readSafeString(candidate, 'question', 'Question'),
  };
}

export function correctTranscript(settings: AppSettings, payload: CorrectTranscriptPayload): Promise<CorrectTranscriptResult> {
  const prompt = buildCorrectTranscriptPrompt(payload);

  return createChatCompletion(settings, settings.correctionModel, prompt.messages).then((correctedTranscript) => ({
    correctedTranscript,
    evidenceSnippets: prompt.evidenceSnippets,
  } satisfies CorrectTranscriptResult));
}

export function generateStudyNotes(settings: AppSettings, payload: GenerateStudyNotesPayload): Promise<string> {
  return createChatCompletion(settings, settings.summaryModel, buildStudyNotesPrompt(payload));
}

export function polishLessonTranscript(settings: AppSettings, payload: PolishLessonTranscriptPayload): Promise<LessonPolishingResult> {
  return createChatCompletion(settings, settings.summaryModel, buildPolishLessonPrompt(payload), { jsonMode: true })
    .then((responseText) => {
      try {
        return parsePolishLessonResponse(responseText, payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown parse error.';
        return correctTranscript(settings, {
          bookContext: payload.bookContext,
          courseName: payload.courseName,
          lessonName: payload.lessonName,
          rawTranscript: payload.rawTranscript,
        }).then((fallback) => buildFallbackLessonPolishingResult(
          payload,
          fallback.correctedTranscript,
          `Structured lesson polishing failed, so only the corrected transcript was returned. ${message}`,
        ));
      }
    });
}

export function answerLessonQuestion(
  settings: AppSettings,
  payload: LessonQuestionAnswerPayload,
): Promise<LessonQuestionAnswerResult> {
  return createChatCompletion(settings, settings.summaryModel, buildLessonQuestionAnswerPrompt(payload)).then((answerText) => ({
    answerText,
    bookContextUsed: payload.bookContext,
    generatedAt: Date.now(),
  }));
}
