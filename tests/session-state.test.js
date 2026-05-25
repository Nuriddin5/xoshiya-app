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

test('study session artifacts do not overwrite lesson attribution', async () => {
  const { applyStudySessionArtifacts } = await importTranspiledTsModule('src/shared/session-state.ts');

  const session = {
    bookContextUsed: [],
    correctedTranscript: '',
    courseId: 'course-1',
    courseName: 'Fiqh',
    detectedTopics: [],
    endedAt: null,
    id: 'session-1',
    lessonId: 'lesson-1',
    lessonName: 'Tahorat',
    polishingResult: null,
    rawTranscript: 'Raw transcript',
    reviewItems: [],
    sourceName: 'Desktop',
    startedAt: 1710000000000,
    summary: '',
    title: 'Lesson capture',
  };

  const nextSession = applyStudySessionArtifacts(session, {
    bookContextUsed: [],
    correctedTranscript: 'Corrected transcript',
    detectedTopics: [],
    polishingResult: null,
    reviewItems: ['Review item'],
    summary: 'Study notes',
  });

  assert.equal(nextSession.courseId, 'course-1');
  assert.equal(nextSession.lessonId, 'lesson-1');
  assert.equal(nextSession.correctedTranscript, 'Corrected transcript');
});

test('session scoping only matches the active course and lesson', async () => {
  const { isStudySessionForLesson } = await importTranspiledTsModule('src/shared/session-state.ts');

  const session = {
    courseId: 'course-1',
    lessonId: 'lesson-1',
  };

  assert.equal(isStudySessionForLesson(session, 'course-1', 'lesson-1'), true);
  assert.equal(isStudySessionForLesson(session, 'course-1', 'lesson-2'), false);
  assert.equal(isStudySessionForLesson(session, 'course-2', 'lesson-1'), false);
  assert.equal(isStudySessionForLesson(session, undefined, 'lesson-1'), false);
  assert.equal(isStudySessionForLesson(null, 'course-1', 'lesson-1'), false);
});
