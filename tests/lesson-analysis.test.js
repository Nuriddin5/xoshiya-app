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

test('lesson analysis splits transcript into section-derived topics', async () => {
  const { buildLessonAnalysis } = await importTranspiledTsModule('src/shared/lesson-analysis.ts');

  const analysis = buildLessonAnalysis([
    'Bugun tawhid haqida gaplashdik. Allohning birligi va rububiyati haqida izoh berildi.',
    '',
    'Keyingi qismda iman va sunnah masalalari muhokama qilindi.',
  ].join('\n\n'), [
    {
      documentId: 'book-1',
      heading: 'Tawhid',
      id: 'snippet-1',
      matchedTerms: ['tawhid', 'rububiyah'],
      score: 8,
      sourceName: 'Aqida Notes',
      text: 'Tawhid va rububiyah haqida matn.',
    },
    {
      documentId: 'book-1',
      heading: 'Iman',
      id: 'snippet-2',
      matchedTerms: ['iman', 'sunnah'],
      score: 6,
      sourceName: 'Aqida Notes',
      text: 'Iman va sunnah haqida matn.',
    },
  ]);

  assert.equal(analysis.sections.length, 2);
  assert.equal(analysis.topics.length, 2);
  assert.match(analysis.topics[0].title, /tawhid/i);
  assert.deepEqual(analysis.topics[0].relatedSnippetIds, ['snippet-1']);
  assert.match(analysis.topics[1].title, /iman|sunnah/i);
  assert.ok(analysis.topics[1].relatedSnippetIds.includes('snippet-2'));
  assert.equal(analysis.topics[0].relatedSnippetIds.includes('snippet-2'), false);
  assert.ok(analysis.reviewItems.some((item) => item.startsWith('Review lesson section:')));
  assert.ok(analysis.reviewItems.some((item) => item.startsWith('Verify term from book context:')));
});
