import { desktopCapturer, dialog, shell } from 'electron';
import { ipcMain } from 'electron';
import { basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { DesktopSourceSummary, SettingsPatch, BookDocument } from '../shared/types.js';
import { IPC_CHANNELS } from '../shared/ipc-channels.js';
import { sanitizeSettingsPatch } from '../shared/settings.js';
import {
  correctTranscript,
  answerLessonQuestion,
  generateStudyNotes,
  polishLessonTranscript,
  validateLessonQuestionAnswerPayload,
  validateCorrectTranscriptPayload,
  validateGenerateStudyNotesPayload,
  validatePolishLessonTranscriptPayload,
} from './ai-client.js';
import { isArrayBuffer, saveAudioChunk } from './audio-chunks.js';
import {
  deleteBookDocument,
  extractTextFromFile,
  importBookText,
  listBookDocuments,
  searchBook,
} from './book-store.js';
import { assertPathInsideBaseFolder } from './path-security.js';
import {
  attachSessionHistoryToLesson,
  clearSessionHistory,
  deleteSessionHistory,
  deleteSessionDraft,
  readLessonSessionRecords,
  readSessionExportSummaries,
  readSessionHistoryLessonLinks,
  readSessionHistorySummaries,
  saveSessionDraft,
  saveSessionExport,
  saveSessionHistory,
  validateSessionExportPayload,
} from './session-export.js';
import {
  clearLessonSessionLinks,
  linkSessionToLesson,
  reorderLessonSessions,
  repairLessonSessionLinks,
  unlinkSessionFromLessons,
  type SessionLessonLink,
} from './lesson-session-links.js';
import { getRubaiRuntimeStatus, transcribeWithRubai, validateRubaiRuntime } from './rubai-runner.js';
import { randomUUID } from 'node:crypto';
import {
  getActiveSaveFolder,
  getStorageEnvironment,
  listStoreCourses,
  listStoreLessons,
  readSettings,
  writeSettings,
  writeStoreCourses,
  writeStoreLessons,
} from './store.js';
import { buildSetupReadiness } from '../shared/readiness.js';
import { createTaskQueue } from '../shared/task-queue.js';
import type { StudyCaptureStore } from './store.js';
import type { AppRecordingIndicatorState, Course, Lesson } from '../shared/types.js';

const transcriptionQueue = createTaskQueue(2);
const PLAIN_TEXT_SOURCE_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);

function assertExportPathInsideSaveFolder(targetPath: string, saveFolder: string): string {
  return assertPathInsideBaseFolder(
    targetPath,
    saveFolder,
    'Export file action is only allowed inside the configured save folder.',
  );
}

function enqueueTranscription<T>(task: () => Promise<T>): Promise<T> {
  return transcriptionQueue.enqueue(task);
}

function writeLessonSessionLink(store: StudyCaptureStore, link: SessionLessonLink): void {
  const lessons = listStoreLessons(store);
  const update = linkSessionToLesson(lessons, link);
  if (update.changed) {
    writeStoreLessons(store, update.lessons);
  }
}

async function repairStoreLessonSessionLinksFromHistory(store: StudyCaptureStore): Promise<void> {
  const settings = readSettings(store);
  const links = await readSessionHistoryLessonLinks(getActiveSaveFolder(settings));
  const lessons = listStoreLessons(store);
  const update = repairLessonSessionLinks(lessons, links);
  if (update.changed) {
    writeStoreLessons(store, update.lessons);
  }
}

type DesktopShellHandlers = {
  setRecordingIndicatorState?: (state: AppRecordingIndicatorState) => void;
};

export function registerIpcHandlers(store: StudyCaptureStore, desktopShellHandlers: DesktopShellHandlers = {}) {
  ipcMain.handle(IPC_CHANNELS.getStartupState, () => {
    const settings = readSettings(store);
    return {
      activeSaveFolder: getActiveSaveFolder(settings),
      readiness: buildSetupReadiness(settings),
      rubaiRuntime: null,
      settings,
      storageEnvironment: getStorageEnvironment(),
    };
  });
  ipcMain.handle(IPC_CHANNELS.getSettings, () => readSettings(store));
  ipcMain.handle(IPC_CHANNELS.getDesktopSources, async (): Promise<DesktopSourceSummary[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 240, height: 135 },
      fetchWindowIcons: false,
    });

    return sources.map((source) => {
      const type = source.id.startsWith('screen:') ? 'screen' : 'window';
      const summary: DesktopSourceSummary = {
        id: source.id,
        name: source.name,
        type,
      };

      if (!source.thumbnail.isEmpty()) {
        summary.thumbnailDataUrl = source.thumbnail.toDataURL();
      }

      return summary;
    });
  });
  ipcMain.handle(IPC_CHANNELS.saveSettings, (_event, patch: SettingsPatch) => {
    return writeSettings(store, sanitizeSettingsPatch(patch));
  });
  ipcMain.handle(IPC_CHANNELS.getRubaiRuntimeStatus, () => getRubaiRuntimeStatus(transcriptionQueue.getStats()));
  ipcMain.handle(IPC_CHANNELS.setRecordingIndicatorState, (_event, state: unknown) => {
    if (state !== 'idle' && state !== 'recording' && state !== 'paused' && state !== 'stopping') {
      throw new Error('Invalid recording indicator state.');
    }

    desktopShellHandlers.setRecordingIndicatorState?.(state);
  });
  ipcMain.handle(IPC_CHANNELS.validateRubaiRuntime, () => validateRubaiRuntime());
  ipcMain.handle(IPC_CHANNELS.importBookText, (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('Expected book import payload.');
    }

    const candidate = payload as Record<string, unknown>;
    if (typeof candidate.name !== 'string' || typeof candidate.text !== 'string') {
      throw new Error('Book import requires name and text strings.');
    }

    return importBookText(store, {
      name: candidate.name,
      text: candidate.text,
      courseId: typeof candidate.courseId === 'string' ? candidate.courseId : undefined,
    });
  });
  ipcMain.handle(IPC_CHANNELS.importBookFile, async (_event, payload: unknown): Promise<BookDocument | null> => {
    let courseId: string | undefined;
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      const candidate = payload as Record<string, unknown>;
      if (typeof candidate.courseId === 'string') {
        courseId = candidate.courseId;
      }
    }

    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Books and Sources', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0]!;
    const fileName = basename(filePath);
    const ext = extname(filePath).toLowerCase();

    if (PLAIN_TEXT_SOURCE_EXTENSIONS.has(ext)) {
      const text = await readFile(filePath, 'utf8');
      return importBookText(store, { name: fileName, text, courseId, filename: fileName, fileType: 'text' });
    }

    const { sections, text, fileType } = await extractTextFromFile(filePath);
    return importBookText(store, { name: fileName, text, courseId, filename: fileName, fileType, sections });
  });

  ipcMain.handle(IPC_CHANNELS.deleteBookDocument, (_event, id: string) => {
    if (typeof id !== 'string') {
      throw new Error('Book ID is required.');
    }
    return deleteBookDocument(store, id);
  });

  ipcMain.handle(IPC_CHANNELS.listBookDocuments, (_event, options: unknown) => {
    const candidateCourseId = typeof options === 'object' && options !== null && !Array.isArray(options)
      ? (options as Record<string, unknown>).courseId
      : null;
    const courseId = typeof candidateCourseId === 'string' ? candidateCourseId : undefined;
    return listBookDocuments(store, { courseId });
  });
  ipcMain.handle(IPC_CHANNELS.searchBook, (_event, query: unknown, options: unknown) => {
    if (typeof query !== 'string') {
      throw new Error('Book search query must be a string.');
    }

    const documentIds = readDocumentIdFilter(options);
    return searchBook(store, query, documentIds ? { documentIds } : undefined);
  });
  ipcMain.handle(IPC_CHANNELS.correctTranscript, (_event, payload: unknown) => {
    return correctTranscript(readSettings(store), validateCorrectTranscriptPayload(payload));
  });
  ipcMain.handle(IPC_CHANNELS.generateStudyNotes, (_event, payload: unknown) => {
    return generateStudyNotes(readSettings(store), validateGenerateStudyNotesPayload(payload));
  });
  ipcMain.handle(IPC_CHANNELS.polishLessonTranscript, (_event, payload: unknown) => {
    return polishLessonTranscript(readSettings(store), validatePolishLessonTranscriptPayload(payload));
  });
  ipcMain.handle(IPC_CHANNELS.answerLessonQuestion, (_event, payload: unknown) => {
    return answerLessonQuestion(readSettings(store), validateLessonQuestionAnswerPayload(payload));
  });
  ipcMain.handle(IPC_CHANNELS.saveAudioChunk, async (_event, arrayBuffer: unknown): Promise<string> => {
    if (!isArrayBuffer(arrayBuffer)) {
      throw new Error('Expected audio chunk data as an ArrayBuffer.');
    }

    return saveAudioChunk(arrayBuffer);
  });
  ipcMain.handle(IPC_CHANNELS.listSessionExports, async () => {
    const settings = readSettings(store);
    return readSessionExportSummaries(getActiveSaveFolder(settings));
  });
  ipcMain.handle(IPC_CHANNELS.listSessionHistory, async () => {
    await repairStoreLessonSessionLinksFromHistory(store);
    const settings = readSettings(store);
    return readSessionHistorySummaries(getActiveSaveFolder(settings));
  });
  ipcMain.handle(IPC_CHANNELS.listLessonSessionRecords, async (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('Expected lesson session list payload.');
    }

    const candidate = payload as Record<string, unknown>;
    const courseId = typeof candidate.courseId === 'string' ? candidate.courseId.trim() : '';
    const lessonId = typeof candidate.lessonId === 'string' ? candidate.lessonId.trim() : '';
    if (!courseId || !lessonId) {
      throw new Error('Course and lesson IDs are required to list lesson sessions.');
    }

    await repairStoreLessonSessionLinksFromHistory(store);
    const lessons = listStoreLessons(store);
    const lesson = lessons.find((item) => item.id === lessonId && item.courseId === courseId);
    if (!lesson) {
      throw new Error('Lesson not found for the selected course.');
    }

    const settings = readSettings(store);
    return readLessonSessionRecords(getActiveSaveFolder(settings), courseId, lessonId, lesson.sessionIds);
  });
  ipcMain.handle(IPC_CHANNELS.openSessionExportMarkdown, async (_event, markdownPath: unknown) => {
    if (typeof markdownPath !== 'string' || markdownPath.trim().length === 0) {
      throw new Error('Expected Markdown file path as a non-empty string.');
    }

    const settings = readSettings(store);
    const resolvedMarkdownPath = assertExportPathInsideSaveFolder(markdownPath, getActiveSaveFolder(settings));
    if (extname(resolvedMarkdownPath).toLowerCase() !== '.md') {
      throw new Error('Expected a Markdown export file.');
    }

    const result = await shell.openPath(resolvedMarkdownPath);
    if (result) {
      throw new Error(`Failed to open Markdown file: ${result}`);
    }
  });
  ipcMain.handle(IPC_CHANNELS.openSessionExportFolder, async (_event, folderPath: unknown) => {
    if (typeof folderPath !== 'string' || folderPath.trim().length === 0) {
      throw new Error('Expected folder path as a non-empty string.');
    }

    const settings = readSettings(store);
    const resolvedFolderPath = assertExportPathInsideSaveFolder(folderPath, getActiveSaveFolder(settings));
    const result = await shell.openPath(resolvedFolderPath);
    if (result) {
      throw new Error(`Failed to open folder: ${result}`);
    }
  });
  ipcMain.handle(IPC_CHANNELS.attachSessionHistoryToLesson, async (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('Expected session history lesson attachment payload.');
    }

    const candidate = payload as Record<string, unknown>;
    const courseId = typeof candidate.courseId === 'string' ? candidate.courseId.trim() : '';
    const lessonId = typeof candidate.lessonId === 'string' ? candidate.lessonId.trim() : '';
    const sessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId.trim() : '';

    if (!courseId || !lessonId || !sessionId) {
      throw new Error('Course, lesson, and session IDs are required to attach history.');
    }

    const courses = listStoreCourses(store);
    const lessons = listStoreLessons(store);
    const course = courses.find((item) => item.id === courseId);
    const lesson = lessons.find((item) => item.id === lessonId);

    if (!course) {
      throw new Error('Course not found.');
    }

    if (!lesson || lesson.courseId !== course.id) {
      throw new Error('Lesson not found for the selected course.');
    }

    const settings = readSettings(store);
    const result = await attachSessionHistoryToLesson(sessionId, {
      courseId: course.id,
      courseName: course.name,
      lessonId: lesson.id,
      lessonName: lesson.name,
    }, getActiveSaveFolder(settings));

    writeLessonSessionLink(store, {
      courseId: course.id,
      lessonId: lesson.id,
      sessionId,
    });

    return result;
  });
  ipcMain.handle(IPC_CHANNELS.updateLessonSessionOrder, async (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('Expected lesson session order payload.');
    }

    const candidate = payload as Record<string, unknown>;
    const courseId = typeof candidate.courseId === 'string' ? candidate.courseId.trim() : '';
    const lessonId = typeof candidate.lessonId === 'string' ? candidate.lessonId.trim() : '';
    const sessionIds = Array.isArray(candidate.sessionIds)
      ? candidate.sessionIds.filter((sessionId): sessionId is string => typeof sessionId === 'string')
      : [];

    if (!courseId || !lessonId) {
      throw new Error('Course and lesson IDs are required to update lesson session order.');
    }

    await repairStoreLessonSessionLinksFromHistory(store);
    const update = reorderLessonSessions(listStoreLessons(store), { courseId, lessonId, sessionIds });
    if (!update.lesson) {
      throw new Error('Lesson not found for the selected course.');
    }

    if (update.changed) {
      writeStoreLessons(store, update.lessons);
    }

    return update.lesson;
  });
  ipcMain.handle(IPC_CHANNELS.saveSessionDraft, (_event, payload: unknown) => {
    const session = validateSessionExportPayload(payload);
    const settings = readSettings(store);
    return saveSessionDraft(session, getActiveSaveFolder(settings));
  });
  ipcMain.handle(IPC_CHANNELS.saveSessionHistory, async (_event, payload: unknown) => {
    const session = validateSessionExportPayload(payload);
    const settings = readSettings(store);
    const result = await saveSessionHistory(session, getActiveSaveFolder(settings));
    if (session.courseId && session.lessonId) {
      writeLessonSessionLink(store, {
        courseId: session.courseId,
        lessonId: session.lessonId,
        sessionId: session.id,
      });
    }

    return result;
  });
  ipcMain.handle(IPC_CHANNELS.saveSessionExport, (_event, payload: unknown) => {
    const session = validateSessionExportPayload(payload);
    const settings = readSettings(store);

    if (session.courseId && session.lessonId) {
      writeLessonSessionLink(store, {
        courseId: session.courseId,
        lessonId: session.lessonId,
        sessionId: session.id,
      });
    }

    return saveSessionExport(session, getActiveSaveFolder(settings));
  });
  ipcMain.handle(IPC_CHANNELS.deleteSessionDraft, (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new Error('Session ID is required to delete a draft.');
    }

    const settings = readSettings(store);
    return deleteSessionDraft(sessionId, getActiveSaveFolder(settings));
  });
  ipcMain.handle(IPC_CHANNELS.deleteSessionHistory, async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new Error('Session ID is required to delete history.');
    }

    const settings = readSettings(store);
    await deleteSessionHistory(sessionId, getActiveSaveFolder(settings));
    const update = unlinkSessionFromLessons(listStoreLessons(store), sessionId);
    if (update.changed) {
      writeStoreLessons(store, update.lessons);
    }
  });
  ipcMain.handle(IPC_CHANNELS.clearSessionHistory, async () => {
    const settings = readSettings(store);
    await clearSessionHistory(getActiveSaveFolder(settings));
    const update = clearLessonSessionLinks(listStoreLessons(store));
    if (update.changed) {
      writeStoreLessons(store, update.lessons);
    }
  });
  ipcMain.handle(IPC_CHANNELS.transcribeAudio, async (_event, audioPath: unknown, metadata: unknown): Promise<string> => {
    if (typeof audioPath !== 'string' || audioPath.trim().length === 0) {
      throw new Error('Expected audio path as a non-empty string.');
    }

    const audioDurationMs = readAudioDurationMs(metadata);
    const queuedAtMs = Date.now();
    return enqueueTranscription(() => transcribeWithRubai(audioPath, {
      audioDurationMs,
      queuedAtMs,
    }));
  });

  ipcMain.handle(IPC_CHANNELS.listCourses, () => listStoreCourses(store));
  ipcMain.handle(IPC_CHANNELS.createCourse, (_event, payload: { name: string; description: string }) => {
    const courses = listStoreCourses(store);
    const newCourse: Course = {
      id: randomUUID(),
      name: payload.name,
      description: payload.description,
      createdAt: Date.now(),
      bookIds: [],
    };
    courses.push(newCourse);
    writeStoreCourses(store, courses);
    return newCourse;
  });
  ipcMain.handle(IPC_CHANNELS.updateCourse, (_event, id: string, patch: Partial<Course>) => {
    const courses = listStoreCourses(store);
    const index = courses.findIndex((c) => c.id === id);
    if (index === -1) {
      throw new Error('Course not found.');
    }
    courses[index] = { ...courses[index]!, ...patch };
    writeStoreCourses(store, courses);
    return courses[index]!;
  });
  ipcMain.handle(IPC_CHANNELS.deleteCourse, (_event, id: string) => {
    const courses = listStoreCourses(store);
    const nextCourses = courses.filter((c) => c.id !== id);
    writeStoreCourses(store, nextCourses);

    const lessons = listStoreLessons(store);
    const nextLessons = lessons.filter((l) => l.courseId !== id);
    writeStoreLessons(store, nextLessons);
  });
  ipcMain.handle(IPC_CHANNELS.listLessons, async (_event, courseId: string) => {
    await repairStoreLessonSessionLinksFromHistory(store);
    const lessons = listStoreLessons(store);
    return lessons.filter((l) => l.courseId === courseId);
  });
  ipcMain.handle(IPC_CHANNELS.createLesson, (_event, payload: { courseId: string; name: string }) => {
    const lessons = listStoreLessons(store);
    const newLesson: Lesson = {
      id: randomUUID(),
      courseId: payload.courseId,
      lastPolishingResult: undefined,
      name: payload.name,
      createdAt: Date.now(),
      sessionIds: [],
    };
    lessons.push(newLesson);
    writeStoreLessons(store, lessons);
    return newLesson;
  });
  ipcMain.handle(IPC_CHANNELS.updateLesson, (_event, id: string, patch: Partial<Lesson>) => {
    const lessons = listStoreLessons(store);
    const index = lessons.findIndex((lesson) => lesson.id === id);
    if (index === -1) {
      throw new Error('Lesson not found.');
    }

    lessons[index] = { ...lessons[index]!, ...patch };
    writeStoreLessons(store, lessons);
    return lessons[index]!;
  });
  ipcMain.handle(IPC_CHANNELS.deleteLesson, (_event, id: string) => {
    const lessons = listStoreLessons(store);
    const nextLessons = lessons.filter((l) => l.id !== id);
    writeStoreLessons(store, nextLessons);
  });
}

function readAudioDurationMs(metadata: unknown): number | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>).audioDurationMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function readDocumentIdFilter(options: unknown): string[] | undefined {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return undefined;
  }

  const value = (options as Record<string, unknown>).documentIds;
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
