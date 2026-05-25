import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function transpileTsFileToTempRoot(relativePath, tempRoot) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });

  const targetPath = path.join(tempRoot, relativePath.replace(/\.ts$/u, '.js'));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, outputText, 'utf8');
  return targetPath;
}

async function importTranspiledTsModule(relativePath) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-lesson-session-links-'));
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
  transpileTsFileToTempRoot('src/shared/types.ts', tempRoot);
  const modulePath = transpileTsFileToTempRoot(relativePath, tempRoot);

  return {
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
    module: await import(pathToFileURL(modulePath).href),
  };
}

test('linkSessionToLesson attaches sessions without duplicates and removes stale lesson ownership', async () => {
  const { cleanup, module } = await importTranspiledTsModule('src/main/lesson-session-links.ts');

  try {
    const lessons = [
      {
        courseId: 'course-1',
        createdAt: 1,
        id: 'lesson-1',
        name: 'Lesson 1',
        sessionIds: ['session-existing'],
      },
      {
        courseId: 'course-1',
        createdAt: 2,
        id: 'lesson-2',
        name: 'Lesson 2',
        sessionIds: ['session-moving'],
      },
    ];

    const first = module.linkSessionToLesson(lessons, {
      courseId: 'course-1',
      lessonId: 'lesson-1',
      sessionId: 'session-moving',
    });
    const second = module.linkSessionToLesson(first.lessons, {
      courseId: 'course-1',
      lessonId: 'lesson-1',
      sessionId: 'session-moving',
    });

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.deepEqual(second.lessons[0].sessionIds, ['session-existing', 'session-moving']);
    assert.deepEqual(second.lessons[1].sessionIds, []);
  } finally {
    cleanup();
  }
});

test('repairLessonSessionLinks backfills missing session IDs from history links', async () => {
  const { cleanup, module } = await importTranspiledTsModule('src/main/lesson-session-links.ts');

  try {
    const lessons = [
      {
        courseId: 'course-1',
        createdAt: 1,
        id: 'lesson-1',
        name: 'Lesson 1',
        sessionIds: ['session-1'],
      },
    ];

    const repaired = module.repairLessonSessionLinks(lessons, [
      { courseId: 'course-1', lessonId: 'lesson-1', sessionId: 'session-1' },
      { courseId: 'course-1', lessonId: 'lesson-1', sessionId: 'session-2' },
    ]);

    assert.equal(repaired.changed, true);
    assert.deepEqual(repaired.lessons[0].sessionIds, ['session-1', 'session-2']);
  } finally {
    cleanup();
  }
});

test('unlinkSessionFromLessons removes deleted history sessions from lesson indexes', async () => {
  const { cleanup, module } = await importTranspiledTsModule('src/main/lesson-session-links.ts');

  try {
    const update = module.unlinkSessionFromLessons([
      {
        courseId: 'course-1',
        createdAt: 1,
        id: 'lesson-1',
        name: 'Lesson 1',
        sessionIds: ['session-1', 'session-2'],
      },
    ], 'session-1');

    assert.equal(update.changed, true);
    assert.deepEqual(update.lessons[0].sessionIds, ['session-2']);
  } finally {
    cleanup();
  }
});

test('clearLessonSessionLinks removes stale session indexes after history is cleared', async () => {
  const { cleanup, module } = await importTranspiledTsModule('src/main/lesson-session-links.ts');

  try {
    const update = module.clearLessonSessionLinks([
      {
        courseId: 'course-1',
        createdAt: 1,
        id: 'lesson-1',
        name: 'Lesson 1',
        sessionIds: ['session-1', 'session-2'],
      },
      {
        courseId: 'course-1',
        createdAt: 2,
        id: 'lesson-2',
        name: 'Lesson 2',
        sessionIds: [],
      },
    ]);

    assert.equal(update.changed, true);
    assert.deepEqual(update.lessons.map((lesson) => lesson.sessionIds), [[], []]);
  } finally {
    cleanup();
  }
});

test('buildSelectedLessonTranscript combines selected parts and live transcript in order', async () => {
  const { cleanup, module } = await importTranspiledTsModule('src/shared/lesson-session-selection.ts');

  try {
    const combined = module.buildSelectedLessonTranscript(
      [
        { sessionId: 'first', rawTranscript: 'First part' },
        { sessionId: 'second', rawTranscript: 'Old second part' },
      ],
      ['first', 'second'],
      { sessionId: 'second', rawTranscript: 'Live second part' },
    );
    const appended = module.buildSelectedLessonTranscript(
      [{ sessionId: 'first', rawTranscript: 'First part' }],
      ['first'],
      { sessionId: 'live', rawTranscript: 'Live part' },
    );

    assert.equal(combined, 'First part\n\nLive second part');
    assert.equal(appended, 'First part\n\nLive part');
  } finally {
    cleanup();
  }
});
