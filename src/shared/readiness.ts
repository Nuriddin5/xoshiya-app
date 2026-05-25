import type { AppSettings, RequiredSetupField, SetupReadiness } from './types.js';

const requiredSetupFields: RequiredSetupField[] = ['aiApiKey', 'aiBaseUrl'];

const requiredSetupFieldLabels: Record<RequiredSetupField, string> = {
  aiApiKey: 'AI provider API key',
  aiBaseUrl: 'AI provider base URL',
};

function hasRequiredValue(value: string): boolean {
  return value.trim().length > 0;
}

function describeMissingFields(missingFields: RequiredSetupField[]): string {
  return missingFields.map((field) => requiredSetupFieldLabels[field]).join(', ');
}

export function buildSetupReadiness(settings: Pick<AppSettings, RequiredSetupField>): SetupReadiness {
  const missingFields = requiredSetupFields.filter((field) => !hasRequiredValue(settings[field]));

  if (missingFields.length === 0) {
    return {
      isComplete: true,
      missingFields,
      missingFieldLabels: [],
      statusMessage: 'Setup complete. Dashboard actions are available.',
    };
  }

  const missingFieldLabels = missingFields.map((field) => requiredSetupFieldLabels[field]);

  return {
    isComplete: false,
    missingFields,
    missingFieldLabels,
    statusMessage: `Setup incomplete. Missing ${describeMissingFields(missingFields)}.`,
  };
}
