import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  LessonSessionRecord,
  SettingsPatch,
  SessionExportSummary,
  SessionExportResult,
  StudyCaptureApi,
  StudyCaptureStartupState,
  StudySession,
  Course,
  Lesson,
} from '../shared/types.js';
import { sanitizeSettingsPatch } from '../shared/settings.js';
import { IPC_CHANNELS } from '../shared/ipc-channels.js';

async function loadStartupState(): Promise<StudyCaptureStartupState> {
  return ipcRenderer.invoke(IPC_CHANNELS.getStartupState) as Promise<StudyCaptureStartupState>;
}

const startupStatePromise = loadStartupState();

// Keep the renderer on a narrow bridge. Add new IPC methods here as the app grows.
const api: StudyCaptureApi = {
  getStartupState: () => startupStatePromise,
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings) as Promise<AppSettings>,
  getDesktopSources: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getDesktopSources) as Promise<Awaited<ReturnType<StudyCaptureApi['getDesktopSources']>>>,
  getRubaiRuntimeStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getRubaiRuntimeStatus) as Promise<Awaited<ReturnType<StudyCaptureApi['getRubaiRuntimeStatus']>>>,
  setRecordingIndicatorState: (state) =>
    ipcRenderer.invoke(IPC_CHANNELS.setRecordingIndicatorState, state) as Promise<void>,
  importBookText: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.importBookText, payload) as Promise<Awaited<ReturnType<StudyCaptureApi['importBookText']>>>,
  importBookFile: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.importBookFile, payload) as Promise<Awaited<ReturnType<StudyCaptureApi['importBookFile']>>>,
  deleteBookDocument: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteBookDocument, id) as Promise<void>,
  listBookDocuments: (options) =>
    ipcRenderer.invoke(IPC_CHANNELS.listBookDocuments, options) as Promise<Awaited<ReturnType<StudyCaptureApi['listBookDocuments']>>>,
  searchBook: (query, options) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchBook, query, options) as Promise<Awaited<ReturnType<StudyCaptureApi['searchBook']>>>,
  correctTranscript: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.correctTranscript, payload) as Promise<Awaited<ReturnType<StudyCaptureApi['correctTranscript']>>>,
  generateStudyNotes: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.generateStudyNotes, payload) as Promise<string>,
  polishLessonTranscript: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.polishLessonTranscript, payload) as Promise<Awaited<ReturnType<StudyCaptureApi['polishLessonTranscript']>>>,
  answerLessonQuestion: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.answerLessonQuestion, payload) as Promise<Awaited<ReturnType<StudyCaptureApi['answerLessonQuestion']>>>,
  saveAudioChunk: (arrayBuffer: ArrayBuffer) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveAudioChunk, arrayBuffer) as Promise<string>,
  listSessionExports: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listSessionExports) as Promise<SessionExportSummary[]>,
  listSessionHistory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listSessionHistory) as Promise<SessionExportSummary[]>,
  listLessonSessionRecords: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.listLessonSessionRecords, payload) as Promise<LessonSessionRecord[]>,
  openSessionExportFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openSessionExportFolder, folderPath) as Promise<void>,
  openSessionExportMarkdown: (markdownPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openSessionExportMarkdown, markdownPath) as Promise<void>,
  attachSessionHistoryToLesson: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.attachSessionHistoryToLesson, payload) as Promise<SessionExportResult>,
  saveSessionDraft: (session: StudySession) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveSessionDraft, session) as Promise<SessionExportResult>,
  saveSessionHistory: (session: StudySession) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveSessionHistory, session) as Promise<SessionExportResult>,
  saveSessionExport: (session: StudySession) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveSessionExport, session) as Promise<SessionExportResult>,
  deleteSessionDraft: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteSessionDraft, sessionId) as Promise<void>,
  deleteSessionHistory: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteSessionHistory, sessionId) as Promise<void>,
  clearSessionHistory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.clearSessionHistory) as Promise<void>,
  transcribeAudio: (audioPath: string, metadata) =>
    ipcRenderer.invoke(IPC_CHANNELS.transcribeAudio, audioPath, metadata) as Promise<string>,
  saveSettings: (settings: SettingsPatch) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveSettings, sanitizeSettingsPatch(settings)) as Promise<AppSettings>,
  validateRubaiRuntime: () =>
    ipcRenderer.invoke(IPC_CHANNELS.validateRubaiRuntime) as Promise<Awaited<ReturnType<StudyCaptureApi['validateRubaiRuntime']>>>,
  listCourses: () => ipcRenderer.invoke(IPC_CHANNELS.listCourses) as Promise<Course[]>,
  createCourse: (payload) => ipcRenderer.invoke(IPC_CHANNELS.createCourse, payload) as Promise<Course>,
  updateCourse: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.updateCourse, id, patch) as Promise<Course>,
  deleteCourse: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteCourse, id) as Promise<void>,
  listLessons: (courseId) => ipcRenderer.invoke(IPC_CHANNELS.listLessons, courseId) as Promise<Lesson[]>,
  createLesson: (payload) => ipcRenderer.invoke(IPC_CHANNELS.createLesson, payload) as Promise<Lesson>,
  updateLesson: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.updateLesson, id, patch) as Promise<Lesson>,
  deleteLesson: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteLesson, id) as Promise<void>,
};

contextBridge.exposeInMainWorld('studyCapture', api);
