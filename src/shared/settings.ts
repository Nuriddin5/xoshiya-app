import type { AiProvider, AppSettings, SettingsPatch, SettingsValidationErrors } from './types.js';
import {
  ADAPTIVE_CHUNK_DEFAULT_SECONDS,
  ADAPTIVE_CHUNK_MAX_SECONDS,
  ADAPTIVE_CHUNK_MIN_SECONDS,
  normalizeAdaptiveChunkSeconds,
} from './adaptive-chunking.js';

const DEFAULT_CORRECTION_MODEL = 'gpt-4.1-mini';
const DEFAULT_SUMMARY_MODEL = 'gpt-4.1-mini';
const DEFAULT_CHUNK_SECONDS = ADAPTIVE_CHUNK_DEFAULT_SECONDS;
const DEFAULT_AI_PROVIDER: AiProvider = 'openai';

export const AI_PROVIDER_DEFAULTS: Record<
  AiProvider,
  {
    apiKeyLabel: string;
    baseUrl: string;
    correctionModel: string;
    label: string;
    summaryModel: string;
  }
> = {
  openai: {
    apiKeyLabel: 'OpenAI API key',
    baseUrl: 'https://api.openai.com/v1',
    correctionModel: DEFAULT_CORRECTION_MODEL,
    label: 'OpenAI',
    summaryModel: DEFAULT_SUMMARY_MODEL,
  },
  deepseek: {
    apiKeyLabel: 'DeepSeek API key',
    baseUrl: 'https://api.deepseek.com',
    correctionModel: 'deepseek-chat',
    label: 'DeepSeek',
    summaryModel: 'deepseek-chat',
  },
};

type LegacySettingsInput = Partial<AppSettings> & {
  openaiApiKey?: unknown;
  saveFolder?: unknown;
};

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePathLikeString(value: unknown): string {
  const trimmed = normalizeOptionalString(value);

  if (trimmed.length < 2) {
    return trimmed;
  }

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];

  if ((firstChar === '"' && lastChar === '"') || (firstChar === '\'' && lastChar === '\'')) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function normalizeRequiredString(value: unknown, fallback: string): string {
  const next = normalizeOptionalString(value);
  return next || fallback;
}

function normalizeAiProvider(value: unknown): AiProvider {
  return value === 'deepseek' || value === 'openai' ? value : DEFAULT_AI_PROVIDER;
}

function normalizeChunkSeconds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return normalizeAdaptiveChunkSeconds(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getValidationFieldLabel(field: keyof AppSettings): string {
  switch (field) {
    case 'aiApiKey':
      return 'AI provider API key';
    case 'aiBaseUrl':
      return 'AI provider base URL';
    case 'aiProvider':
      return 'AI provider';
    case 'chunkSeconds':
      return 'Chunk duration';
    case 'mainSaveFolder':
      return 'Main save folder';
    case 'productionSaveFolder':
      return 'Production save folder';
    case 'summaryModel':
      return 'Summary model';
    case 'correctionModel':
      return 'Correction model';
  }
}

export function formatSettingsValidationMessage(errors: SettingsValidationErrors): string {
  const entries = Object.entries(errors) as Array<[keyof AppSettings, string]>;
  const parts = entries.map(([field, message]) => `${getValidationFieldLabel(field)}: ${message}`);
  return parts.length > 0 ? `Settings validation failed. ${parts.join(' ')}` : 'Settings validation failed.';
}

export function validateSettings(settings: AppSettings): SettingsValidationErrors {
  const errors: SettingsValidationErrors = {};

  if (!settings.aiApiKey.trim()) {
    errors.aiApiKey = 'This field is required.';
  }

  if (!settings.aiBaseUrl.trim()) {
    errors.aiBaseUrl = 'This field is required.';
  } else {
    try {
      const url = new URL(settings.aiBaseUrl);
      if (url.protocol !== 'https:') {
        errors.aiBaseUrl = 'Must be an HTTPS URL.';
      }
    } catch {
      errors.aiBaseUrl = 'Must be a valid URL.';
    }
  }

  if (!settings.mainSaveFolder.trim()) {
    errors.mainSaveFolder = 'This field is required.';
  }

  if (!settings.productionSaveFolder.trim()) {
    errors.productionSaveFolder = 'This field is required.';
  }

  if (!settings.summaryModel.trim()) {
    errors.summaryModel = 'This field is required.';
  }

  if (!settings.correctionModel.trim()) {
    errors.correctionModel = 'This field is required.';
  }

  if (
    !Number.isInteger(settings.chunkSeconds)
    || settings.chunkSeconds < ADAPTIVE_CHUNK_MIN_SECONDS
    || settings.chunkSeconds > ADAPTIVE_CHUNK_MAX_SECONDS
  ) {
    errors.chunkSeconds = `Must be a whole number between ${ADAPTIVE_CHUNK_MIN_SECONDS} and ${ADAPTIVE_CHUNK_MAX_SECONDS}.`;
  }

  return errors;
}

export function normalizeAppSettings(
  input: LegacySettingsInput,
  defaultMainSaveFolder: string,
  defaultProductionSaveFolder: string = defaultMainSaveFolder,
): AppSettings {
  const aiProvider = normalizeAiProvider(input.aiProvider);
  const providerDefaults = AI_PROVIDER_DEFAULTS[aiProvider];
  const legacySaveFolder = normalizePathLikeString(input.saveFolder);

  return {
    aiApiKey: normalizeOptionalString(input.aiApiKey || input.openaiApiKey),
    aiBaseUrl: normalizeRequiredString(input.aiBaseUrl, providerDefaults.baseUrl),
    aiProvider,
    correctionModel: normalizeRequiredString(input.correctionModel, providerDefaults.correctionModel),
    mainSaveFolder: normalizePathLikeString(input.mainSaveFolder) || legacySaveFolder || defaultMainSaveFolder,
    productionSaveFolder: normalizePathLikeString(input.productionSaveFolder) || legacySaveFolder || defaultProductionSaveFolder,
    summaryModel: normalizeRequiredString(input.summaryModel, providerDefaults.summaryModel),
    chunkSeconds: normalizeChunkSeconds(input.chunkSeconds, DEFAULT_CHUNK_SECONDS),
  };
}

export function sanitizeSettingsPatch(input: unknown): SettingsPatch {
  if (!isRecord(input)) {
    throw new TypeError('Settings payload must be a plain object.');
  }

  const patch: SettingsPatch = {};

  if ('aiProvider' in input) {
    patch.aiProvider = normalizeAiProvider(input.aiProvider);
  }

  if ('aiApiKey' in input) {
    patch.aiApiKey = normalizeOptionalString(input.aiApiKey);
  } else if ('openaiApiKey' in input) {
    patch.aiApiKey = normalizeOptionalString(input.openaiApiKey);
  }

  if ('aiBaseUrl' in input) {
    patch.aiBaseUrl = normalizeOptionalString(input.aiBaseUrl);
  }

  if ('correctionModel' in input) {
    patch.correctionModel = normalizeOptionalString(input.correctionModel);
  }

  if ('summaryModel' in input) {
    patch.summaryModel = normalizeOptionalString(input.summaryModel);
  }

  if ('chunkSeconds' in input) {
    patch.chunkSeconds = normalizeChunkSeconds(input.chunkSeconds, 0);
  }

  if ('saveFolder' in input) {
    const saveFolder = normalizePathLikeString(input.saveFolder);
    patch.mainSaveFolder = saveFolder;
    patch.productionSaveFolder = saveFolder;
  }

  if ('mainSaveFolder' in input) {
    patch.mainSaveFolder = normalizePathLikeString(input.mainSaveFolder);
  }

  if ('productionSaveFolder' in input) {
    patch.productionSaveFolder = normalizePathLikeString(input.productionSaveFolder);
  }

  return patch;
}
