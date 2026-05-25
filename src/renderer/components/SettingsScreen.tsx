import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ADAPTIVE_CHUNK_MAX_SECONDS,
  ADAPTIVE_CHUNK_MIN_SECONDS,
} from '../../shared/adaptive-chunking.js';
import type { AiProvider, AppSettings, SettingsValidationErrors, StorageEnvironment } from '../../shared/types.js';
import { AI_PROVIDER_DEFAULTS, formatSettingsValidationMessage, validateSettings } from '../../shared/settings.js';

type SettingsScreenProps = {
  activeSaveFolder: string;
  settings: AppSettings;
  storageEnvironment: StorageEnvironment;
  onSave: (settings: AppSettings) => Promise<AppSettings>;
};

type SettingsFormValues = {
  aiApiKey: string;
  aiBaseUrl: string;
  aiProvider: AiProvider;
  chunkSeconds: string;
  mainSaveFolder: string;
  productionSaveFolder: string;
  summaryModel: string;
  correctionModel: string;
};

function makeDraft(settings: AppSettings): SettingsFormValues {
  return {
    aiApiKey: settings.aiApiKey,
    aiBaseUrl: settings.aiBaseUrl,
    aiProvider: settings.aiProvider,
    chunkSeconds: String(settings.chunkSeconds),
    mainSaveFolder: settings.mainSaveFolder,
    productionSaveFolder: settings.productionSaveFolder,
    summaryModel: settings.summaryModel,
    correctionModel: settings.correctionModel,
  };
}

function draftToSettings(draft: SettingsFormValues): AppSettings {
  return {
    aiApiKey: draft.aiApiKey.trim(),
    aiBaseUrl: draft.aiBaseUrl.trim(),
    aiProvider: draft.aiProvider,
    chunkSeconds: Number(draft.chunkSeconds),
    mainSaveFolder: draft.mainSaveFolder.trim(),
    productionSaveFolder: draft.productionSaveFolder.trim(),
    summaryModel: draft.summaryModel.trim(),
    correctionModel: draft.correctionModel.trim(),
  };
}

function hasValidationErrors(errors: SettingsValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

function storageEnvironmentLabel(storageEnvironment: StorageEnvironment): string {
  return storageEnvironment === 'main' ? 'Development / main' : 'Production';
}

export function SettingsScreen({ activeSaveFolder, settings, storageEnvironment, onSave }: SettingsScreenProps) {
  const [draft, setDraft] = useState<SettingsFormValues>(() => makeDraft(settings));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<SettingsValidationErrors>({});
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setDraft(makeDraft(settings));
    setFieldErrors({});
    setErrorMessage(null);
  }, [settings]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextSettings = draftToSettings(draft);
    const validationErrors = validateSettings(nextSettings);
    if (hasValidationErrors(validationErrors)) {
      setFieldErrors(validationErrors);
      setErrorMessage(formatSettingsValidationMessage(validationErrors));
      setStatus('error');
      return;
    }

    try {
      setErrorMessage(null);
      setFieldErrors({});
      setStatus('saving');
      const savedSettings = await onSave(nextSettings);
      setDraft(makeDraft(savedSettings));
      setStatus('saved');
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = window.setTimeout(() => setStatus('idle'), 1600);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings.';
      setErrorMessage(`Could not save settings. ${message}`);
      setStatus('error');
    }
  }

  function handleProviderChange(aiProvider: AiProvider) {
    const providerDefaults = AI_PROVIDER_DEFAULTS[aiProvider];

    setDraft((current) => {
      const currentProviderDefaults = AI_PROVIDER_DEFAULTS[current.aiProvider];
      const shouldReplaceBaseUrl = !current.aiBaseUrl.trim() || current.aiBaseUrl.trim() === currentProviderDefaults.baseUrl;
      const shouldReplaceCorrectionModel =
        !current.correctionModel.trim() || current.correctionModel.trim() === currentProviderDefaults.correctionModel;
      const shouldReplaceSummaryModel =
        !current.summaryModel.trim() || current.summaryModel.trim() === currentProviderDefaults.summaryModel;

      return {
        ...current,
        aiProvider,
        aiBaseUrl: shouldReplaceBaseUrl ? providerDefaults.baseUrl : current.aiBaseUrl,
        correctionModel: shouldReplaceCorrectionModel ? providerDefaults.correctionModel : current.correctionModel,
        summaryModel: shouldReplaceSummaryModel ? providerDefaults.summaryModel : current.summaryModel,
      };
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-glow">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-emerald-300/70">Settings</p>
            <h3 className="mt-2 text-3xl font-semibold text-white">Local configuration</h3>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              These values stay on the machine. The bridge only exposes `getSettings` and `saveSettings`, so the renderer never touches storage directly.
              No Whisper paths are required in this Rubai-first build.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-ink-800/80 px-4 py-3 text-sm text-slate-300">
            Save status:{' '}
            <span className="text-slate-100">
              {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved' : status === 'error' ? 'Error' : 'Idle'}
            </span>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-4 text-sm text-emerald-50">
          <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-100/70">Active root</div>
          <div className="mt-2 font-semibold text-white">{storageEnvironmentLabel(storageEnvironment)}</div>
          <div className="mt-1 break-words font-mono text-xs leading-5 text-emerald-50/85">{activeSaveFolder}</div>
        </div>
        {errorMessage ? <p className="mt-4 text-sm text-rose-200">{errorMessage}</p> : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Field
          label="AI provider"
          helper="Choose which text model provider will be used for correction and notes later."
          error={fieldErrors.aiProvider}
          full
          required
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {(['openai', 'deepseek'] as AiProvider[]).map((provider) => {
              const isSelected = draft.aiProvider === provider;
              const providerDefaults = AI_PROVIDER_DEFAULTS[provider];

              return (
                <button
                  key={provider}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => handleProviderChange(provider)}
                  className={[
                    'rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-4 focus:ring-emerald-500/15',
                    isSelected
                      ? 'border-emerald-300/50 bg-emerald-400/15 text-white'
                      : 'border-slate-600/30 bg-slate-950/70 text-slate-300 hover:border-slate-500/60 hover:bg-slate-900/80',
                  ].join(' ')}
                >
                  <span className="text-sm font-semibold">{providerDefaults.label}</span>
                  <span className="mt-1 block break-all text-xs leading-5 text-slate-400">{providerDefaults.baseUrl}</span>
                </button>
              );
            })}
          </div>
        </Field>
        <Field
          label={AI_PROVIDER_DEFAULTS[draft.aiProvider].apiKeyLabel}
          helper="Stored locally through the preload bridge. Never logged."
          error={fieldErrors.aiApiKey}
          full
          required
        >
          <input
            type="password"
            autoComplete="off"
            className="w-full rounded-2xl border border-slate-600/30 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/15"
            value={draft.aiApiKey}
            onChange={(event) => setDraft((current) => ({ ...current, aiApiKey: event.target.value }))}
          />
        </Field>
        <Field
          label="AI base URL"
          helper="OpenAI-compatible chat completions endpoint base URL for the selected provider."
          error={fieldErrors.aiBaseUrl}
          full
          required
        >
          <input
            type="url"
            className="w-full rounded-2xl border border-slate-600/30 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/15"
            value={draft.aiBaseUrl}
            onChange={(event) => setDraft((current) => ({ ...current, aiBaseUrl: event.target.value }))}
          />
        </Field>
        <Field
          label="Preferred chunk target"
          helper={`Adaptive capture aims for a natural pause near this point, then keeps scanning until a pause is found or the ${ADAPTIVE_CHUNK_MAX_SECONDS}s hard limit is reached.`}
          error={fieldErrors.chunkSeconds}
          required
        >
          <input
            type="number"
            min={ADAPTIVE_CHUNK_MIN_SECONDS}
            max={ADAPTIVE_CHUNK_MAX_SECONDS}
            step={1}
            className="w-full rounded-2xl border border-slate-600/30 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/15"
            value={draft.chunkSeconds}
            onChange={(event) => setDraft((current) => ({ ...current, chunkSeconds: event.target.value }))}
          />
        </Field>
        <Field
          label="Main / dev save folder"
          helper="Used by unpackaged development runs."
          error={fieldErrors.mainSaveFolder}
          full
          required
        >
          <input
            type="text"
            className="w-full rounded-2xl border border-slate-600/30 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/15"
            value={draft.mainSaveFolder}
            onChange={(event) => setDraft((current) => ({ ...current, mainSaveFolder: event.target.value }))}
          />
        </Field>
        <Field
          label="Production save folder"
          helper="Used by packaged production builds."
          error={fieldErrors.productionSaveFolder}
          full
          required
        >
          <input
            type="text"
            className="w-full rounded-2xl border border-slate-600/30 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/15"
            value={draft.productionSaveFolder}
            onChange={(event) => setDraft((current) => ({ ...current, productionSaveFolder: event.target.value }))}
          />
        </Field>
        <Field
          label="Summary model"
          helper="Text-only note generation model used later in the flow."
          error={fieldErrors.summaryModel}
          required
        >
          <input
            type="text"
            className="w-full rounded-2xl border border-slate-600/30 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/15"
            value={draft.summaryModel}
            onChange={(event) => setDraft((current) => ({ ...current, summaryModel: event.target.value }))}
          />
        </Field>
        <Field
          label="Correction model"
          helper="Text-only correction model used after local transcription."
          error={fieldErrors.correctionModel}
          required
        >
          <input
            type="text"
            className="w-full rounded-2xl border border-slate-600/30 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/15"
            value={draft.correctionModel}
            onChange={(event) => setDraft((current) => ({ ...current, correctionModel: event.target.value }))}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={status === 'saving'}
          className="rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Save settings
        </button>
        <p className="text-sm text-slate-400">
          Local Rubai ASR is validated automatically before recording starts. Whisper binary and model path fields are not used.
        </p>
      </div>
    </form>
  );
}

type FieldProps = {
  label: string;
  helper: string;
  children: ReactNode;
  error?: string | undefined;
  full?: boolean;
  required?: boolean;
};

function Field({ label, helper, children, error, full = false, required = false }: FieldProps) {
  return (
    <div className={`rounded-[24px] border border-white/10 bg-slate-950/45 p-5 ${full ? 'xl:col-span-2' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-sm font-semibold text-white">{label}</span>
          <p className="mt-1 text-xs leading-5 text-slate-400">{helper}</p>
        </div>
        {required ? (
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-400">
            Required
          </span>
        ) : null}
      </div>
      <div className="mt-4">
        {children}
      </div>
      {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
    </div>
  );
}
