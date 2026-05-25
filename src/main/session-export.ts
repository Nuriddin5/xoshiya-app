import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type {
  BookSnippet,
  DetectedTopic,
  LessonFlashcard,
  LessonPolishingResult,
  LessonSourceReference,
  LessonTerm,
  LessonSessionRecord,
  SessionExportRecord,
  SessionExportResult,
  SessionExportSummary,
  StudySession,
} from '../shared/types.js';
import { renderLessonPolishingMarkdown, renderLessonPolishingTable } from '../shared/lesson-polishing.js';

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

const SESSION_DRAFT_FOLDER_NAME = '_drafts';
const SESSION_HISTORY_FOLDER_NAME = '_history';
const SESSION_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type SessionFilePair = {
  jsonPath?: string;
  markdownPath?: string;
  stem: string;
};

type SessionRecordWithPaths = {
  jsonPath: string;
  markdownPath: string;
  record: SessionExportRecord;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isBookSnippet(value: unknown): value is BookSnippet {
  return isRecord(value)
    && typeof value.documentId === 'string'
    && typeof value.heading === 'string'
    && typeof value.id === 'string'
    && isStringArray(value.matchedTerms)
    && (value.pageNumber === undefined || typeof value.pageNumber === 'number')
    && typeof value.score === 'number'
    && typeof value.sourceName === 'string'
    && typeof value.text === 'string';
}

function isDetectedTopic(value: unknown): value is DetectedTopic {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && Array.isArray(value.relatedSnippetIds)
    && value.relatedSnippetIds.every((item) => typeof item === 'string');
}

function isLessonSourceReference(value: unknown): value is LessonSourceReference {
  return isRecord(value)
    && typeof value.citation === 'string'
    && typeof value.documentId === 'string'
    && typeof value.heading === 'string'
    && typeof value.id === 'string'
    && isStringArray(value.matchedTerms)
    && typeof value.note === 'string'
    && (value.pageNumber === undefined || typeof value.pageNumber === 'number')
    && typeof value.snippetId === 'string'
    && typeof value.sourceName === 'string';
}

function isLessonTerm(value: unknown): value is LessonTerm {
  return isRecord(value)
    && typeof value.definition === 'string'
    && isStringArray(value.sourceReferenceIds)
    && typeof value.term === 'string';
}

function isLessonFlashcard(value: unknown): value is LessonFlashcard {
  return isRecord(value)
    && typeof value.answer === 'string'
    && typeof value.prompt === 'string'
    && isStringArray(value.sourceReferenceIds);
}

function isLessonPolishingResult(value: unknown): value is LessonPolishingResult {
  return isRecord(value)
    && Array.isArray(value.bookContextUsed)
    && value.bookContextUsed.every(isBookSnippet)
    && (
      value.contextConfidence === 'high'
      || value.contextConfidence === 'medium'
      || value.contextConfidence === 'low'
      || value.contextConfidence === 'missing'
    )
    && typeof value.contextWarning === 'string'
    && typeof value.correctedTranscript === 'string'
    && Array.isArray(value.detectedTopics)
    && value.detectedTopics.every(isDetectedTopic)
    && Array.isArray(value.flashcards)
    && value.flashcards.every(isLessonFlashcard)
    && typeof value.generatedAt === 'number'
    && Array.isArray(value.keyPoints)
    && value.keyPoints.every((item) => typeof item === 'string')
    && typeof value.rawTranscript === 'string'
    && Array.isArray(value.reviewQuestions)
    && value.reviewQuestions.every((item) => typeof item === 'string')
    && Array.isArray(value.sourceReferences)
    && value.sourceReferences.every(isLessonSourceReference)
    && typeof value.summary === 'string'
    && Array.isArray(value.terms)
    && value.terms.every(isLessonTerm)
    && typeof value.topicTitle === 'string';
}

function normalizeSessionExportRecord(record: SessionExportRecord): SessionExportRecord {
  return {
    ...record,
    polishingResult: record.polishingResult ?? null,
  };
}

function isSessionExportRecord(value: unknown): value is SessionExportRecord {
  return isRecord(value)
    && Array.isArray(value.bookContextUsed)
    && value.bookContextUsed.every(isBookSnippet)
    && typeof value.correctedTranscript === 'string'
    && (value.courseName === undefined || typeof value.courseName === 'string')
    && typeof value.date === 'string'
    && Array.isArray(value.detectedTopics)
    && value.detectedTopics.every(isDetectedTopic)
    && typeof value.exportedAt === 'string'
    && (value.lessonName === undefined || typeof value.lessonName === 'string')
    && (value.polishingResult === undefined || value.polishingResult === null || isLessonPolishingResult(value.polishingResult))
    && typeof value.rawTranscript === 'string'
    && Array.isArray(value.reviewItems)
    && value.reviewItems.every((item) => typeof item === 'string')
    && typeof value.source === 'string'
    && typeof value.summary === 'string'
    && typeof value.title === 'string'
    && typeof value.sessionId === 'string'
    && (value.lessonId === undefined || typeof value.lessonId === 'string')
    && (value.courseId === undefined || typeof value.courseId === 'string');
}

function normalizeSessionString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeSessionNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatStemPart(value: string): string {
  return value.replace(/[-_]+/gu, ' ').trim();
}

function fallbackTitleFromStem(stem: string): string {
  const [timestampPart, titlePart] = stem.split('__');
  return formatStemPart(titlePart ?? timestampPart ?? stem) || 'Study session';
}

function extractMarkdownMetadata(markdown: string, stem: string): Pick<SessionExportSummary, 'date' | 'source' | 'title' | 'topicCount'> {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  let title = '';
  let date = '';
  let source = '';
  let topicCount = 0;
  let inTopicsSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!title && trimmed.startsWith('# ')) {
      title = trimmed.slice(2).trim();
    }

    if (trimmed === '## Detected Topics') {
      inTopicsSection = true;
      continue;
    }

    if (inTopicsSection && trimmed.startsWith('## ')) {
      break;
    }

    if (inTopicsSection && trimmed.startsWith('- ') && trimmed !== '- None') {
      topicCount += 1;
    }

    if (!date && trimmed.startsWith('- Date: ')) {
      date = trimmed.slice('- Date: '.length).trim();
    }

    if (!source && trimmed.startsWith('- Source: ')) {
      source = trimmed.slice('- Source: '.length).trim();
    }
  }

  return {
    date,
    source: source || 'Unknown source',
    title: title || fallbackTitleFromStem(stem),
    topicCount,
  };
}

async function readSessionExportRecord(jsonPath: string): Promise<SessionExportRecord | null> {
  try {
    const content = await readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return isSessionExportRecord(parsed) ? normalizeSessionExportRecord(parsed) : null;
  } catch {
    return null;
  }
}

async function readFileMtime(path: string | null | undefined): Promise<number> {
  if (!path) {
    return 0;
  }

  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

async function readDirectoryEntries(folderPath: string): Promise<Array<{ isFile(): boolean; name: string }>> {
  let entries: Array<{ isFile(): boolean; name: string }> = [];

  try {
    entries = await readdir(folderPath, { withFileTypes: true });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: string }).code
      : undefined;
    if (code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  return entries;
}

async function readSessionFilePairsFromFolder(folderPath: string): Promise<SessionFilePair[]> {
  const entries = await readDirectoryEntries(folderPath);
  const byStem = new Map<string, { jsonPath?: string; markdownPath?: string }>();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    if (extension !== '.json' && extension !== '.md') {
      continue;
    }

    const stem = entry.name.slice(0, -extension.length);
    const current = byStem.get(stem) ?? {};
    const fullPath = join(folderPath, entry.name);

    if (extension === '.json') {
      current.jsonPath = fullPath;
    } else {
      current.markdownPath = fullPath;
    }

    byStem.set(stem, current);
  }

  return Array.from(byStem.entries(), ([stem, paths]) => ({ ...paths, stem }));
}

function buildSessionSummaryFromRecord(
  record: SessionExportRecord,
  paths: { jsonPath?: string; markdownPath?: string },
  folderPath: string,
  sortTimestamp: number,
): SessionExportSummary & { _sortTimestamp: number } {
  const summaryFolderPath = paths.markdownPath ? dirname(paths.markdownPath) : paths.jsonPath ? dirname(paths.jsonPath) : folderPath;

  return {
    courseId: record.courseId,
    courseName: record.courseName,
    date: record.date,
    exportedAt: record.exportedAt,
    folderPath: summaryFolderPath,
    hasJson: Boolean(paths.jsonPath),
    hasMarkdown: Boolean(paths.markdownPath),
    jsonPath: paths.jsonPath ?? join(folderPath, `${record.sessionId}.json`),
    lessonId: record.lessonId,
    lessonName: record.lessonName,
    markdownPath: paths.markdownPath ?? join(folderPath, `${record.sessionId}.md`),
    sessionId: record.sessionId,
    source: record.source,
    title: record.title,
    topicCount: record.detectedTopics.length,
    _sortTimestamp: sortTimestamp,
  };
}

async function readSessionRecordsFromFolder(folderPath: string): Promise<SessionRecordWithPaths[]> {
  const pairs = await readSessionFilePairsFromFolder(folderPath);
  const records = await Promise.all(pairs.map(async (pair) => {
    if (!pair.jsonPath) {
      return null;
    }

    const record = await readSessionExportRecord(pair.jsonPath);
    if (!record) {
      return null;
    }

    return {
      jsonPath: pair.jsonPath,
      markdownPath: pair.markdownPath ?? join(folderPath, `${pair.stem}.md`),
      record,
    };
  }));

  return records.filter((record): record is SessionRecordWithPaths => record !== null);
}

async function readSessionSummariesFromFolder(folderPath: string): Promise<SessionExportSummary[]> {
  const pairs = await readSessionFilePairsFromFolder(folderPath);

  const summaries = await Promise.all(pairs.map(async ({ stem, ...paths }) => {
    const [jsonRecord, markdownMtime, jsonMtime] = await Promise.all([
      paths.jsonPath ? readSessionExportRecord(paths.jsonPath) : Promise.resolve(null),
      readFileMtime(paths.markdownPath),
      readFileMtime(paths.jsonPath),
    ]);
    const markdownMetadata = !jsonRecord && paths.markdownPath
      ? extractMarkdownMetadata(await readFile(paths.markdownPath, 'utf8'), stem)
      : null;
    const latestMtime = Math.max(markdownMtime, jsonMtime);
    const sortTimestamp = Math.max(
      parseTimestamp(jsonRecord?.exportedAt ?? null),
      parseTimestamp(jsonRecord?.date ?? null),
      latestMtime,
    );
    const inferredTimestamp = sortTimestamp > 0 ? new Date(sortTimestamp).toISOString() : new Date().toISOString();
    const summaryFolderPath = paths.markdownPath ? dirname(paths.markdownPath) : paths.jsonPath ? dirname(paths.jsonPath) : folderPath;

    if (jsonRecord) {
      return buildSessionSummaryFromRecord(jsonRecord, paths, folderPath, sortTimestamp);
    }

    return {
      courseId: undefined,
      courseName: undefined,
      date: markdownMetadata?.date ?? inferredTimestamp,
      exportedAt: inferredTimestamp,
      folderPath: summaryFolderPath,
      hasJson: Boolean(paths.jsonPath),
      hasMarkdown: Boolean(paths.markdownPath),
      jsonPath: paths.jsonPath ?? join(folderPath, `${stem}.json`),
      lessonId: undefined,
      lessonName: undefined,
      markdownPath: paths.markdownPath ?? join(folderPath, `${stem}.md`),
      sessionId: stem,
      source: markdownMetadata?.source ?? 'Unknown source',
      title: markdownMetadata?.title ?? fallbackTitleFromStem(stem),
      topicCount: markdownMetadata?.topicCount ?? 0,
      _sortTimestamp: sortTimestamp,
    };
  }));

  return summaries
    .sort((left, right) => right._sortTimestamp - left._sortTimestamp)
    .map(({ _sortTimestamp: _ignored, ...summary }) => summary);
}

export async function readSessionExportSummaries(saveFolder: string): Promise<SessionExportSummary[]> {
  return readSessionSummariesFromFolder(saveFolder);
}

export async function pruneExpiredSessionHistory(saveFolder: string): Promise<void> {
  const historyFolder = getSessionHistoryFolder(saveFolder);
  const pairs = await readSessionFilePairsFromFolder(historyFolder);
  const cutoffMs = Date.now() - SESSION_HISTORY_RETENTION_MS;

  await Promise.all(pairs.map(async (pair) => {
    const record = pair.jsonPath ? await readSessionExportRecord(pair.jsonPath) : null;
    if (record?.courseId && record.lessonId) {
      return;
    }

    const paths = [pair.jsonPath, pair.markdownPath].filter((path): path is string => Boolean(path));
    const mtimes = await Promise.all(paths.map(readFileMtime));
    const latestMtime = Math.max(...mtimes, 0);
    if (latestMtime > 0 && latestMtime < cutoffMs) {
      await Promise.all(paths.map((path) => rm(path, { force: true })));
    }
  }));
}

export async function readSessionHistorySummaries(saveFolder: string): Promise<SessionExportSummary[]> {
  await pruneExpiredSessionHistory(saveFolder);
  return readSessionSummariesFromFolder(getSessionHistoryFolder(saveFolder));
}

export async function readSessionHistoryLessonLinks(saveFolder: string): Promise<Array<{ courseId: string; lessonId: string; sessionId: string }>> {
  await pruneExpiredSessionHistory(saveFolder);
  const records = await readSessionRecordsFromFolder(getSessionHistoryFolder(saveFolder));

  return records
    .map(({ record }) => ({
      courseId: record.courseId ?? '',
      lessonId: record.lessonId ?? '',
      sessionId: record.sessionId,
    }))
    .filter((link) => link.courseId.length > 0 && link.lessonId.length > 0 && link.sessionId.length > 0);
}

export async function readLessonSessionRecords(
  saveFolder: string,
  courseId: string,
  lessonId: string,
  sessionIds: string[] = [],
): Promise<LessonSessionRecord[]> {
  await pruneExpiredSessionHistory(saveFolder);
  const sessionIdSet = new Set(sessionIds);
  const sessionIdOrder = new Map(sessionIds.map((sessionId, index) => [sessionId, index]));
  const historyFolder = getSessionHistoryFolder(saveFolder);
  const records = await readSessionRecordsFromFolder(historyFolder);

  return records
    .filter(({ record }) => (
      record.courseId === courseId && record.lessonId === lessonId
    ) || sessionIdSet.has(record.sessionId))
    .map(({ jsonPath, markdownPath, record }) => {
      const sortTimestamp = Math.max(parseTimestamp(record.date), parseTimestamp(record.exportedAt), 0);
      const summary = buildSessionSummaryFromRecord(record, { jsonPath, markdownPath }, historyFolder, sortTimestamp);
      const { _sortTimestamp: _ignored, ...publicSummary } = summary;

      return {
        ...publicSummary,
        correctedTranscript: record.correctedTranscript,
        rawTranscript: record.rawTranscript,
        summary: record.summary,
      };
    })
    .sort((left, right) => {
      const leftOrder = sessionIdOrder.get(left.sessionId);
      const rightOrder = sessionIdOrder.get(right.sessionId);

      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
      }

      return parseTimestamp(left.date) - parseTimestamp(right.date);
    });
}

export function validateSessionExportPayload(payload: unknown): StudySession {
  if (!isRecord(payload)) {
    throw new Error('Expected a study session export payload.');
  }

  const startedAt = normalizeSessionNumber(payload.startedAt, Date.now());
  const endedAt = payload.endedAt === null ? null : normalizeSessionNumber(payload.endedAt, startedAt);

  return {
    bookContextUsed: Array.isArray(payload.bookContextUsed) ? payload.bookContextUsed.filter(isBookSnippet) : [],
    correctedTranscript: normalizeSessionString(payload.correctedTranscript),
    courseId: normalizeOptionalSessionId(payload.courseId),
    courseName: normalizeOptionalSessionText(payload.courseName),
    detectedTopics: Array.isArray(payload.detectedTopics) ? payload.detectedTopics.filter(isDetectedTopic) : [],
    endedAt,
    id: normalizeSessionString(payload.id, `session-${startedAt}`),
    lessonId: normalizeOptionalSessionId(payload.lessonId),
    lessonName: normalizeOptionalSessionText(payload.lessonName),
    polishingResult: isLessonPolishingResult(payload.polishingResult) ? payload.polishingResult : null,
    rawTranscript: normalizeSessionString(payload.rawTranscript),
    reviewItems: Array.isArray(payload.reviewItems)
      ? payload.reviewItems.filter((item): item is string => typeof item === 'string')
      : [],
    sourceName: normalizeSessionString(payload.sourceName, 'Unknown source'),
    startedAt,
    summary: normalizeSessionString(payload.summary),
    title: normalizeSessionString(payload.title, 'Study session'),
  };
}

function formatFileTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function normalizeOptionalSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptionalSessionText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeWindowsFilePart(input: string, fallback: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[. ]+$/gu, '');

  const candidate = normalized.replace(/\s+/gu, '-');
  const trimmed = candidate.slice(0, 48).replace(/^-+|-+$/gu, '');
  const next = trimmed || fallback;
  const reservedStem = next.replace(/[. ]+$/gu, '').split('.')[0]?.toUpperCase() ?? '';

  if (WINDOWS_RESERVED_NAMES.has(reservedStem)) {
    return `${fallback}-${next}`.replace(/[. ]+$/gu, '');
  }

  return next;
}

function getLongestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;

  for (const character of text) {
    if (character === '`') {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

function wrapCodeBlock(text: string): string {
  const normalized = text.replace(/\r\n?/gu, '\n').trimEnd();
  const fence = '`'.repeat(Math.max(3, getLongestBacktickRun(normalized) + 1));
  return `${fence}\n${normalized}\n${fence}`;
}

function escapeMarkdownText(input: string): string {
  return input.replace(/([\\`*_{}\[\]()#+|>])/gu, '\\$1');
}

function formatDateLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(timestamp);
}

function formatTopicLine(topic: DetectedTopic): string {
  const relatedSnippets = topic.relatedSnippetIds.length > 0
    ? ` related snippets: ${topic.relatedSnippetIds.map((snippetId) => `\`${snippetId}\``).join(', ')}`
    : '';

  return `- ${escapeMarkdownText(topic.title)}${relatedSnippets}`;
}

function formatReviewItem(item: string): string {
  return `- ${escapeMarkdownText(item)}`;
}

function formatBookSnippet(snippet: BookSnippet, index: number): string {
  const matchedTerms = snippet.matchedTerms.length > 0
    ? snippet.matchedTerms.map((term) => `\`${term}\``).join(', ')
    : 'None';

  return [
    `### ${index + 1}. ${escapeMarkdownText(snippet.heading || snippet.sourceName)}`,
    `- Source: ${escapeMarkdownText(snippet.sourceName)}`,
    typeof snippet.pageNumber === 'number' ? `- Page: ${snippet.pageNumber}` : null,
    `- Score: ${snippet.score}`,
    `- Matched terms: ${matchedTerms}`,
    '',
    wrapCodeBlock(snippet.text || ''),
  ].filter((line): line is string => line !== null).join('\n');
}

function buildSessionExportRecord(session: StudySession): SessionExportRecord {
  const exportedAt = new Date().toISOString();

  return {
    bookContextUsed: session.bookContextUsed,
    correctedTranscript: session.correctedTranscript,
    courseId: session.courseId,
    courseName: session.courseName,
    date: new Date(session.startedAt).toISOString(),
    detectedTopics: session.detectedTopics,
    exportedAt,
    lessonId: session.lessonId,
    lessonName: session.lessonName,
    polishingResult: session.polishingResult,
    rawTranscript: session.rawTranscript,
    reviewItems: session.reviewItems,
    source: session.sourceName,
    summary: session.summary,
    title: session.title,
    sessionId: session.id,
  };
}

function buildSessionMarkdown(record: SessionExportRecord): string {
  const topicSection = record.detectedTopics.length > 0
    ? record.detectedTopics.map(formatTopicLine).join('\n')
    : '- None';
  const reviewSection = record.reviewItems.length > 0
    ? record.reviewItems.map(formatReviewItem).join('\n')
    : '- None';
  const bookContextSection = record.bookContextUsed.length > 0
    ? record.bookContextUsed.map((snippet, index) => formatBookSnippet(snippet, index)).join('\n\n')
    : 'No book context was used for this session.';
  const lessonOutputSection = record.polishingResult
    ? renderLessonPolishingMarkdown(record.polishingResult)
    : record.summary;
  const sourceReferenceTable = record.polishingResult
    ? renderLessonPolishingTable(record.polishingResult)
    : 'No structured source references were saved.';

  return [
    `# ${escapeMarkdownText(record.title)}`,
    '',
    `- Date: ${escapeMarkdownText(formatDateLabel(Date.parse(record.date)))}`,
    `- Source: ${escapeMarkdownText(record.source)}`,
    record.courseName ? `- Course: ${escapeMarkdownText(record.courseName)}` : null,
    record.lessonName ? `- Lesson: ${escapeMarkdownText(record.lessonName)}` : null,
    `- Session ID: ${escapeMarkdownText(record.sessionId)}`,
    `- Exported at: ${escapeMarkdownText(formatDateLabel(Date.parse(record.exportedAt)))}`,
    '',
    '## Raw Transcript',
    '',
    wrapCodeBlock(record.rawTranscript),
    '',
    '## Corrected Transcript',
    '',
    wrapCodeBlock(record.correctedTranscript),
    '',
    '## Lesson Output',
    '',
    wrapCodeBlock(lessonOutputSection),
    '',
    '## Source References',
    '',
    sourceReferenceTable,
    '',
    '## Detected Topics',
    '',
    topicSection,
    '',
    '## Review Items',
    '',
    reviewSection,
    '',
    '## Book Context Used',
    '',
    bookContextSection,
    '',
  ].filter((line): line is string => line !== null).join('\n');
}

function buildSessionFileStem(session: StudySession): string {
  const timestampPart = formatFileTimestamp(session.startedAt);
  const titlePart = sanitizeWindowsFilePart(session.title, 'Study-session');
  const sourcePart = sanitizeWindowsFilePart(session.sourceName, 'Source');
  const sessionPart = sanitizeWindowsFilePart(session.id, 'session');
  const fileStem = `${timestampPart}__${titlePart}__${sourcePart}__${sessionPart}`;

  return fileStem.slice(0, 180).replace(/[. ]+$/u, '');
}

function getSessionDraftFolder(saveFolder: string): string {
  return join(saveFolder, SESSION_DRAFT_FOLDER_NAME);
}

function getSessionHistoryFolder(saveFolder: string): string {
  return join(saveFolder, SESSION_HISTORY_FOLDER_NAME);
}

function buildSessionDraftFileStem(session: StudySession): string {
  const sessionPart = sanitizeWindowsFilePart(session.id, 'session');
  return sessionPart.slice(0, 120).replace(/[. ]+$/u, '');
}

export async function saveSessionExport(session: StudySession, saveFolder: string): Promise<SessionExportResult> {
  const exportSession = validateSessionExportPayload(session);
  const record = buildSessionExportRecord(exportSession);
  const fileStem = buildSessionFileStem(exportSession);
  const markdownPath = join(saveFolder, `${fileStem}.md`);
  const jsonPath = join(saveFolder, `${fileStem}.json`);

  await mkdir(saveFolder, { recursive: true });
  await Promise.all([
    writeFile(markdownPath, buildSessionMarkdown(record), 'utf8'),
    writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8'),
  ]);

  return {
    jsonPath,
    markdownPath,
  };
}

export async function saveSessionDraft(session: StudySession, saveFolder: string): Promise<SessionExportResult> {
  const exportSession = validateSessionExportPayload(session);
  const record = buildSessionExportRecord(exportSession);
  const draftFolder = getSessionDraftFolder(saveFolder);
  const fileStem = buildSessionDraftFileStem(exportSession);
  const markdownPath = join(draftFolder, `${fileStem}.md`);
  const jsonPath = join(draftFolder, `${fileStem}.json`);

  await mkdir(draftFolder, { recursive: true });
  await Promise.all([
    writeFile(markdownPath, buildSessionMarkdown(record), 'utf8'),
    writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8'),
  ]);

  return {
    jsonPath,
    markdownPath,
  };
}

export async function saveSessionHistory(session: StudySession, saveFolder: string): Promise<SessionExportResult> {
  await pruneExpiredSessionHistory(saveFolder);

  const exportSession = validateSessionExportPayload(session);
  const record = buildSessionExportRecord(exportSession);
  const historyFolder = getSessionHistoryFolder(saveFolder);
  const fileStem = buildSessionDraftFileStem(exportSession);
  const markdownPath = join(historyFolder, `${fileStem}.md`);
  const jsonPath = join(historyFolder, `${fileStem}.json`);

  await mkdir(historyFolder, { recursive: true });
  await Promise.all([
    writeFile(markdownPath, buildSessionMarkdown(record), 'utf8'),
    writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8'),
  ]);

  return {
    jsonPath,
    markdownPath,
  };
}

export async function attachSessionHistoryToLesson(
  sessionId: string,
  attribution: { courseId: string; courseName: string; lessonId: string; lessonName: string },
  saveFolder: string,
): Promise<SessionExportResult> {
  const sessionKey = sanitizeWindowsFilePart(sessionId, 'session');
  if (!sessionKey) {
    throw new Error('Session ID is required to attach history to a lesson.');
  }

  const historyFolder = getSessionHistoryFolder(saveFolder);
  const jsonPath = join(historyFolder, `${sessionKey}.json`);
  const markdownPath = join(historyFolder, `${sessionKey}.md`);
  const currentRecord = await readSessionExportRecord(jsonPath);

  if (!currentRecord) {
    throw new Error('Could not find an autosaved history record for this session.');
  }

  const nextRecord: SessionExportRecord = {
    ...currentRecord,
    courseId: attribution.courseId,
    courseName: attribution.courseName,
    exportedAt: new Date().toISOString(),
    lessonId: attribution.lessonId,
    lessonName: attribution.lessonName,
  };

  await mkdir(historyFolder, { recursive: true });
  await Promise.all([
    writeFile(markdownPath, buildSessionMarkdown(nextRecord), 'utf8'),
    writeFile(jsonPath, `${JSON.stringify(nextRecord, null, 2)}\n`, 'utf8'),
  ]);

  return {
    jsonPath,
    markdownPath,
  };
}

export async function deleteSessionDraft(sessionId: string, saveFolder: string): Promise<void> {
  const sessionKey = sanitizeWindowsFilePart(sessionId, 'session');
  if (!sessionKey) {
    return;
  }

  const draftFolder = getSessionDraftFolder(saveFolder);

  let entries: Array<{ isFile(): boolean; name: string }> = [];
  try {
    entries = await readdir(draftFolder, { withFileTypes: true });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: string }).code
      : undefined;
    if (code === 'ENOENT') {
      return;
    }

    throw error;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && (entry.name === `${sessionKey}.json` || entry.name === `${sessionKey}.md`))
      .map((entry) => rm(join(draftFolder, entry.name), { force: true })),
  );
}

export async function deleteSessionHistory(sessionId: string, saveFolder: string): Promise<void> {
  const sessionKey = sanitizeWindowsFilePart(sessionId, 'session');
  if (!sessionKey) {
    return;
  }

  const historyFolder = getSessionHistoryFolder(saveFolder);

  let entries: Array<{ isFile(): boolean; name: string }> = [];
  try {
    entries = await readDirectoryEntries(historyFolder);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: string }).code
      : undefined;
    if (code === 'ENOENT') {
      return;
    }

    throw error;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && (entry.name === `${sessionKey}.json` || entry.name === `${sessionKey}.md`))
      .map((entry) => rm(join(historyFolder, entry.name), { force: true })),
  );
}

export async function clearSessionHistory(saveFolder: string): Promise<void> {
  await rm(getSessionHistoryFolder(saveFolder), { recursive: true, force: true });
}
