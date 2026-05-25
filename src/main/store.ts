import { app } from 'electron';
import Store from 'electron-store';
import { join } from 'node:path';
import type { AppSettings, BookDocument, Course, Lesson, SettingsPatch, StorageEnvironment } from '../shared/types.js';
import {
  AI_PROVIDER_DEFAULTS,
  formatSettingsValidationMessage,
  normalizeAppSettings,
  validateSettings,
} from '../shared/settings.js';

type StoreSchema = {
  books: BookDocument[];
  settings: AppSettings;
  courses: Course[];
  lessons: Lesson[];
};

export function createDefaultSettings(): AppSettings {
  const documentsFolder = app.getPath('documents');
  const mainSaveFolder = join(documentsFolder, 'StudyCaptureDev');
  const productionSaveFolder = join(documentsFolder, 'StudyCapture');

  return normalizeAppSettings({
    aiApiKey: '',
    aiBaseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl,
    aiProvider: 'openai',
    correctionModel: AI_PROVIDER_DEFAULTS.openai.correctionModel,
    summaryModel: AI_PROVIDER_DEFAULTS.openai.summaryModel,
    chunkSeconds: 30,
    mainSaveFolder,
    productionSaveFolder,
  }, mainSaveFolder, productionSaveFolder);
}

function normalizeSettings(input: Partial<AppSettings>): AppSettings {
  const documentsFolder = app.getPath('documents');
  return normalizeAppSettings(
    input,
    join(documentsFolder, 'StudyCaptureDev'),
    join(documentsFolder, 'StudyCapture'),
  );
}

export function createSettingsStore() {
  return new Store<StoreSchema>({
    name: 'study-capture-settings',
    defaults: {
      books: [],
      settings: createDefaultSettings(),
      courses: [],
      lessons: [],
    },
  });
}

export type StudyCaptureStore = Store<StoreSchema>;

export function getStorageEnvironment(): StorageEnvironment {
  return app.isPackaged ? 'production' : 'main';
}

export function getActiveSaveFolder(settings: AppSettings): string {
  return getStorageEnvironment() === 'production'
    ? settings.productionSaveFolder
    : settings.mainSaveFolder;
}

export function readSettings(store: Store<StoreSchema>): AppSettings {
  const settings = store.get('settings');
  return normalizeSettings(settings ?? createDefaultSettings());
}

export function writeSettings(store: Store<StoreSchema>, patch: SettingsPatch): AppSettings {
  const next = {
    ...readSettings(store),
    ...patch,
  };

  const validationErrors = validateSettings(next);
  if (Object.keys(validationErrors).length > 0) {
    throw new Error(formatSettingsValidationMessage(validationErrors));
  }

  store.set('settings', next);
  return next;
}

export function listStoreBookDocuments(store: Store<StoreSchema>): BookDocument[] {
  return store.get('books') ?? [];
}

export function listStoreCourses(store: Store<StoreSchema>): Course[] {
  return store.get('courses') ?? [];
}

export function writeStoreCourses(store: Store<StoreSchema>, courses: Course[]): Course[] {
  store.set('courses', courses);
  return courses;
}

export function listStoreLessons(store: Store<StoreSchema>): Lesson[] {
  return store.get('lessons') ?? [];
}

export function writeStoreLessons(store: Store<StoreSchema>, lessons: Lesson[]): Lesson[] {
  store.set('lessons', lessons);
  return lessons;
}
