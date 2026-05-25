export const ADAPTIVE_CHUNK_MIN_SECONDS = 25;
export const ADAPTIVE_CHUNK_DEFAULT_SECONDS = 30;
export const ADAPTIVE_CHUNK_MAX_SECONDS = 40;
export const ADAPTIVE_CHUNK_ANALYSIS_INTERVAL_MS = 120;

const EARLY_SCAN_LEAD_MS = 5_000;
const EARLY_SCAN_REQUIRED_SILENCE_MS = 420;
const TARGET_SCAN_REQUIRED_SILENCE_MS = 280;
const LATE_SCAN_REQUIRED_SILENCE_MS = 180;
const LATE_SCAN_AFTER_TARGET_MS = 4_000;
const DEFAULT_SILENCE_THRESHOLD_RMS = 0.004;
const FLOOR_MULTIPLIER = 2.4;
const FLOOR_OFFSET_RMS = 0.0015;
const MIN_SILENCE_THRESHOLD_RMS = 0.0025;
const MAX_SILENCE_THRESHOLD_RMS = 0.018;
const RECENT_RMS_SAMPLE_LIMIT = 96;

export type AdaptiveChunkBoundaryReason =
  | 'detected-pause'
  | 'hard-limit'
  | 'pause-request'
  | 'stop-request';

export type AdaptiveChunkBoundaryConfig = {
  maxChunkMs: number;
  minChunkMs: number;
  preferredChunkMs: number;
  scanStartMs: number;
};

export type AdaptiveChunkBoundaryDebug = AdaptiveChunkBoundaryConfig & {
  fallbackUsed: boolean;
  noiseFloorRms: number | null;
  reason: AdaptiveChunkBoundaryReason;
  rms: number | null;
  scanWindowOpened: boolean;
  silenceDurationMs: number | null;
  summary: string;
  thresholdRms: number | null;
  chunkDurationMs: number;
};

type AdaptiveChunkBoundaryDebugInput = Omit<AdaptiveChunkBoundaryDebug, 'summary'>;

export type AdaptiveChunkSample = {
  elapsedMs: number;
  rms: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatSeconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(1);
}

function formatRms(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(4);
}

function getRequiredSilenceMs(elapsedMs: number, config: AdaptiveChunkBoundaryConfig): number {
  if (elapsedMs < config.preferredChunkMs) {
    return EARLY_SCAN_REQUIRED_SILENCE_MS;
  }

  if (elapsedMs < config.preferredChunkMs + LATE_SCAN_AFTER_TARGET_MS) {
    return TARGET_SCAN_REQUIRED_SILENCE_MS;
  }

  return LATE_SCAN_REQUIRED_SILENCE_MS;
}

function describeAdaptiveChunkBoundary(input: AdaptiveChunkBoundaryDebugInput): string {
  switch (input.reason) {
    case 'detected-pause':
      return `Detected a ${formatSeconds(input.silenceDurationMs ?? 0)}s pause at ${formatSeconds(input.chunkDurationMs)}s after scan opened at ${formatSeconds(input.scanStartMs)}s (rms ${formatRms(input.rms)} <= ${formatRms(input.thresholdRms)}).`;
    case 'hard-limit':
      return `Reached the ${formatSeconds(input.maxChunkMs)}s hard limit at ${formatSeconds(input.chunkDurationMs)}s because no strong pause appeared after scan opened at ${formatSeconds(input.scanStartMs)}s.`;
    case 'pause-request':
      return `Capture paused by user at ${formatSeconds(input.chunkDurationMs)}s before the next adaptive boundary.`;
    case 'stop-request':
      return `Capture stopped by user at ${formatSeconds(input.chunkDurationMs)}s before the next adaptive boundary.`;
  }
}

export function createAdaptiveChunkBoundaryDebug(
  input: AdaptiveChunkBoundaryDebugInput,
): AdaptiveChunkBoundaryDebug {
  return {
    ...input,
    summary: describeAdaptiveChunkBoundary(input),
  };
}

export function buildAdaptiveChunkBoundaryConfig(preferredChunkSeconds: number): AdaptiveChunkBoundaryConfig {
  const preferredChunkMs = normalizeAdaptiveChunkSeconds(preferredChunkSeconds) * 1000;
  const minChunkMs = ADAPTIVE_CHUNK_MIN_SECONDS * 1000;
  const maxChunkMs = ADAPTIVE_CHUNK_MAX_SECONDS * 1000;

  return {
    maxChunkMs,
    minChunkMs,
    preferredChunkMs,
    scanStartMs: Math.max(minChunkMs, preferredChunkMs - EARLY_SCAN_LEAD_MS),
  };
}

export function normalizeAdaptiveChunkSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return ADAPTIVE_CHUNK_DEFAULT_SECONDS;
  }

  return clamp(Math.floor(value), ADAPTIVE_CHUNK_MIN_SECONDS, ADAPTIVE_CHUNK_MAX_SECONDS);
}

export class AdaptiveChunkBoundaryPlanner {
  private readonly config: AdaptiveChunkBoundaryConfig;
  private recentRmsValues: number[] = [];
  private silenceStartedAtMs: number | null = null;

  constructor(preferredChunkSeconds: number) {
    this.config = buildAdaptiveChunkBoundaryConfig(preferredChunkSeconds);
  }

  getConfig(): AdaptiveChunkBoundaryConfig {
    return this.config;
  }

  observe(sample: AdaptiveChunkSample): AdaptiveChunkBoundaryDebug | null {
    const elapsedMs = Math.max(0, Math.round(sample.elapsedMs));
    const rms = Number.isFinite(sample.rms) ? Math.max(0, sample.rms) : 0;
    this.pushRmsSample(rms);
    const noiseFloorRms = this.getNoiseFloorRms();
    const thresholdRms = this.getSilenceThresholdRms(noiseFloorRms);
    const scanWindowOpened = elapsedMs >= this.config.scanStartMs;
    const isQuiet = rms <= thresholdRms;

    if (scanWindowOpened && isQuiet) {
      if (this.silenceStartedAtMs === null) {
        this.silenceStartedAtMs = elapsedMs;
      }
    } else {
      this.silenceStartedAtMs = null;
    }

    const silenceDurationMs =
      scanWindowOpened && isQuiet && this.silenceStartedAtMs !== null
        ? Math.max(0, elapsedMs - this.silenceStartedAtMs)
        : null;

    if (elapsedMs >= this.config.maxChunkMs) {
      return createAdaptiveChunkBoundaryDebug({
        ...this.config,
        chunkDurationMs: elapsedMs,
        fallbackUsed: true,
        noiseFloorRms,
        reason: 'hard-limit',
        rms,
        scanWindowOpened,
        silenceDurationMs,
        thresholdRms,
      });
    }

    if (!scanWindowOpened || silenceDurationMs === null) {
      return null;
    }

    if (silenceDurationMs < getRequiredSilenceMs(elapsedMs, this.config)) {
      return null;
    }

    return createAdaptiveChunkBoundaryDebug({
      ...this.config,
      chunkDurationMs: elapsedMs,
      fallbackUsed: false,
      noiseFloorRms,
      reason: 'detected-pause',
      rms,
      scanWindowOpened,
      silenceDurationMs,
      thresholdRms,
    });
  }

  private getNoiseFloorRms(): number | null {
    if (this.recentRmsValues.length === 0) {
      return null;
    }

    const sorted = [...this.recentRmsValues].sort((left, right) => left - right);
    return sorted[Math.floor((sorted.length - 1) * 0.2)] ?? sorted[0] ?? null;
  }

  private getSilenceThresholdRms(noiseFloorRms: number | null): number {
    if (noiseFloorRms === null) {
      return DEFAULT_SILENCE_THRESHOLD_RMS;
    }

    return clamp(
      noiseFloorRms * FLOOR_MULTIPLIER + FLOOR_OFFSET_RMS,
      MIN_SILENCE_THRESHOLD_RMS,
      MAX_SILENCE_THRESHOLD_RMS,
    );
  }

  private pushRmsSample(rms: number): void {
    this.recentRmsValues.push(rms);
    if (this.recentRmsValues.length > RECENT_RMS_SAMPLE_LIMIT) {
      this.recentRmsValues.shift();
    }
  }
}
