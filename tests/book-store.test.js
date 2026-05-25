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

function createMemoryStore() {
  const state = {
    books: [],
  };

  return {
    get(key) {
      return state[key];
    },
    set(key, value) {
      state[key] = value;
    },
  };
}

test('book import stores documents and search returns relevant snippets', async () => {
  const { importBookText, listBookDocuments, searchBook } = await importTranspiledTsModule('src/main/book-store.ts');
  const store = createMemoryStore();

  const imported = importBookText(store, {
    name: 'Aqida Notes',
    text: [
      '# Tawhid',
      'Tawhid haqida muhim matn.',
      '',
      '## Wudu',
      'Wudu qilish tartibi va tahorat haqida izoh.',
      '',
      'Namozdan oldin tahoratni yangilash kerak.',
    ].join('\n'),
  });

  const storedDocuments = listBookDocuments(store);
  assert.equal(storedDocuments.length, 1);
  assert.equal(storedDocuments[0].id, imported.id);
  assert.ok(storedDocuments[0].sections.length >= 2);

  const results = searchBook(store, 'tahorat wudu');
  assert.ok(results.length > 0);
  assert.equal(results[0].sourceName, 'Aqida Notes');
  assert.match(results[0].text, /tahorat|wudu/i);
});

test('book search can be restricted to course-associated documents', async () => {
  const { importBookText, searchBook } = await importTranspiledTsModule('src/main/book-store.ts');
  const store = createMemoryStore();

  const selectedBook = importBookText(store, {
    name: 'Selected Fiqh Notes',
    text: 'Tahorat haqida tanlangan kitob matni. Tahorat namozdan oldin qilinadi.',
  });
  const unrelatedBook = importBookText(store, {
    name: 'Unrelated Fiqh Notes',
    text: 'Tahorat haqida boshqa kitob matni. Bu kursga biriktirilmagan.',
  });

  const results = searchBook(store, 'tahorat kitob', { documentIds: [selectedBook.id] });

  assert.ok(results.length > 0);
  assert.equal(results.every((snippet) => snippet.documentId === selectedBook.id), true);
  assert.equal(results.some((snippet) => snippet.documentId === unrelatedBook.id), false);
});

test('book search returns no snippets for an empty course document filter', async () => {
  const { importBookText, searchBook } = await importTranspiledTsModule('src/main/book-store.ts');
  const store = createMemoryStore();

  importBookText(store, {
    name: 'Fiqh Notes',
    text: 'Tahorat haqida kitob matni. Bu matn global qidiruvda topilishi mumkin.',
  });

  assert.equal(searchBook(store, 'tahorat').length > 0, true);
  assert.deepEqual(searchBook(store, 'tahorat', { documentIds: [] }), []);
});
