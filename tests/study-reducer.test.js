import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function transpileTsFileToTempRoot(relativePath, tempRoot) {
  const sourcePath = path.join(root, relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  });

  const targetPath = path.join(tempRoot, relativePath.replace(/\.ts$/u, '.js'));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, outputText, 'utf8');
  return targetPath;
}

async function importStudyReducerModule() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-study-reducer-'));
  try {
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf8');

    transpileTsFileToTempRoot('src/shared/lesson-analysis.ts', tempRoot);
    const modulePath = transpileTsFileToTempRoot('src/shared/study-reducer.ts', tempRoot);

    return await import(pathToFileURL(modulePath).href);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
}

test('study reducer keeps selected snippets as the primary notes context', async () => {
  const { buildStudyReducerArtifacts } = await importStudyReducerModule();

  const selectedSnippets = [
    {
      documentId: 'book-selected',
      heading: 'Tahorat',
      id: 'selected-1',
      matchedTerms: ['tahorat'],
      score: 5,
      sourceName: 'Selected Notes',
      text: 'Selected context about tahorat.',
    },
  ];

  const correctionEvidence = [
    {
      documentId: 'book-evidence',
      heading: 'Tawhid',
      id: 'evidence-1',
      matchedTerms: ['tawhid'],
      score: 9,
      sourceName: 'Evidence Notes',
      text: 'Evidence context about tawhid.',
    },
  ];

  const artifacts = buildStudyReducerArtifacts('Tahorat haqida dars bo`ldi.', correctionEvidence, selectedSnippets);

  assert.deepEqual(artifacts.bookContext.map((snippet) => snippet.id), ['selected-1']);
  assert.ok(artifacts.sections.length > 0);
  assert.equal(artifacts.sections[0].relatedSnippetIds.includes('selected-1'), true);
  assert.equal(artifacts.sections[0].relatedSnippetIds.includes('evidence-1'), false);
  assert.ok(artifacts.topics[0].title.toLowerCase().includes('tahorat'));
  assert.ok(artifacts.reviewItems.some((item) => item.includes('Tahorat')));
});

test('study reducer falls back to correction evidence when no snippets are selected', async () => {
  const { buildStudyReducerArtifacts } = await importStudyReducerModule();

  const correctionEvidence = [
    {
      documentId: 'book-evidence',
      heading: 'Tawhid',
      id: 'evidence-1',
      matchedTerms: ['tawhid'],
      score: 5,
      sourceName: 'Evidence Notes',
      text: 'Evidence context about tawhid.',
    },
  ];

  const artifacts = buildStudyReducerArtifacts('Tawhid haqida dars bo`ldi.', correctionEvidence, []);

  assert.deepEqual(artifacts.bookContext.map((snippet) => snippet.id), ['evidence-1']);
  assert.ok(artifacts.sections.length > 0);
  assert.equal(artifacts.sections[0].relatedSnippetIds.includes('evidence-1'), true);
  assert.ok(artifacts.topics[0].title.toLowerCase().includes('tawhid'));
});
