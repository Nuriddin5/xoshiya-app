import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function importTranspiledTsModule(relativePath) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });

  const dataUrl = `data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`;
  return import(dataUrl);
}

function runPlanner(planner, segments, sampleMs = 120) {
  for (let elapsedMs = 0; elapsedMs <= 60_000; elapsedMs += sampleMs) {
    const segment = segments.find((candidate) => elapsedMs >= candidate.startMs && elapsedMs < candidate.endMs);
    const rms = segment?.rms ?? 0.001;
    const decision = planner.observe({ elapsedMs, rms });
    if (decision) {
      return decision;
    }
  }

  return null;
}

test('adaptive planner waits for a pause instead of cutting at a rigid 30 second boundary', async () => {
  const { AdaptiveChunkBoundaryPlanner } = await importTranspiledTsModule('src/shared/adaptive-chunking.ts');
  const planner = new AdaptiveChunkBoundaryPlanner(30);
  const decision = runPlanner(planner, [
    { endMs: 30_720, rms: 0.06, startMs: 0 },
    { endMs: 31_560, rms: 0.001, startMs: 30_720 },
    { endMs: 60_000, rms: 0.06, startMs: 31_560 },
  ]);

  assert.ok(decision, 'expected an adaptive boundary decision');
  assert.equal(decision.reason, 'detected-pause');
  assert.ok(decision.chunkDurationMs > 30_000, `expected decision after 30s, got ${decision.chunkDurationMs}`);
  assert.ok(decision.chunkDurationMs < 31_560, `expected decision inside the pause window, got ${decision.chunkDurationMs}`);
  assert.match(decision.summary, /pause/i);
});

test('adaptive planner falls back to the 40 second hard limit when no pause appears', async () => {
  const { AdaptiveChunkBoundaryPlanner } = await importTranspiledTsModule('src/shared/adaptive-chunking.ts');
  const planner = new AdaptiveChunkBoundaryPlanner(30);
  const decision = runPlanner(planner, [
    { endMs: 60_000, rms: 0.06, startMs: 0 },
  ]);

  assert.ok(decision, 'expected a hard-limit decision');
  assert.equal(decision.reason, 'hard-limit');
  assert.ok(decision.chunkDurationMs >= 40_000, `expected hard limit at or after 40s, got ${decision.chunkDurationMs}`);
  assert.ok(decision.chunkDurationMs <= 40_200, `expected hard limit close to 40s, got ${decision.chunkDurationMs}`);
  assert.equal(decision.fallbackUsed, true);
});
