import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function importSettingsModule() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-settings-'));
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
  const modulePaths = [
    'src/shared/settings.ts',
    'src/shared/adaptive-chunking.ts',
  ];

  for (const relativePath of modulePaths) {
    const sourcePath = path.join(root, relativePath);
    const source = fs.readFileSync(sourcePath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: sourcePath,
    });
    const outputPath = path.join(tempDir, path.basename(relativePath).replace(/\.ts$/, '.js'));
    fs.writeFileSync(outputPath, outputText, 'utf8');
  }

  return import(pathToFileURL(path.join(tempDir, 'settings.js')).href);
}

function makeValidSettings(chunkSeconds) {
  return {
    aiApiKey: 'test-key',
    aiBaseUrl: 'https://api.example.com/v1',
    aiProvider: 'openai',
    chunkSeconds,
    correctionModel: 'test-correction',
    mainSaveFolder: 'C:\\StudyCapture\\main',
    productionSaveFolder: 'C:\\StudyCapture\\production',
    summaryModel: 'test-summary',
  };
}

test('settings reject chunk durations outside the adaptive 25-40 second window', async () => {
  const { validateSettings } = await importSettingsModule();

  const tooShortErrors = validateSettings(makeValidSettings(15));
  const tooLongErrors = validateSettings(makeValidSettings(90));

  assert.match(tooShortErrors.chunkSeconds, /between 25 and 40/);
  assert.match(tooLongErrors.chunkSeconds, /between 25 and 40/);
});

test('settings normalize legacy chunk durations into the adaptive 25-40 second window', async () => {
  const { normalizeAppSettings, sanitizeSettingsPatch } = await importSettingsModule();

  const normalizedLow = normalizeAppSettings(makeValidSettings(15), 'C:\\StudyCapture\\main', 'C:\\StudyCapture\\production');
  const normalizedHigh = normalizeAppSettings(makeValidSettings(90), 'C:\\StudyCapture\\main', 'C:\\StudyCapture\\production');
  const lowPatch = sanitizeSettingsPatch({ chunkSeconds: 15 });
  const highPatch = sanitizeSettingsPatch({ chunkSeconds: 90 });

  assert.equal(normalizedLow.chunkSeconds, 25);
  assert.equal(normalizedHigh.chunkSeconds, 40);
  assert.equal(lowPatch.chunkSeconds, 25);
  assert.equal(highPatch.chunkSeconds, 40);
});

test('legacy save folder settings migrate into both roots', async () => {
  const { normalizeAppSettings, sanitizeSettingsPatch } = await importSettingsModule();

  const normalized = normalizeAppSettings({
    aiApiKey: 'test-key',
    aiBaseUrl: 'https://api.example.com/v1',
    aiProvider: 'openai',
    chunkSeconds: 30,
    correctionModel: 'test-correction',
    saveFolder: 'C:\\StudyCapture',
    summaryModel: 'test-summary',
  }, 'C:\\StudyCapture\\main', 'C:\\StudyCapture\\production');
  const patch = sanitizeSettingsPatch({ saveFolder: 'C:\\StudyCapture' });

  assert.equal(normalized.mainSaveFolder, 'C:\\StudyCapture');
  assert.equal(normalized.productionSaveFolder, 'C:\\StudyCapture');
  assert.equal(patch.mainSaveFolder, 'C:\\StudyCapture');
  assert.equal(patch.productionSaveFolder, 'C:\\StudyCapture');
});
