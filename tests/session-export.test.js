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

async function importSessionExportModule() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-session-export-module-'));
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf8');

  transpileTsFileToTempRoot('src/shared/types.ts', tempRoot);
  transpileTsFileToTempRoot('src/shared/lesson-polishing.ts', tempRoot);
  const modulePath = transpileTsFileToTempRoot('src/main/session-export.ts', tempRoot);

  return {
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
    module: await import(pathToFileURL(modulePath).href),
  };
}

test('session export preserves lesson and course attribution', async () => {
  const { cleanup, module } = await importSessionExportModule();
  const saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-session-export-'));

  try {
    const validated = module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: 'Corrected transcript',
      courseId: 'course-1',
      courseName: 'Fiqh',
      detectedTopics: [],
      endedAt: 1710000060000,
      id: 'session-1',
      lessonId: 'lesson-1',
      lessonName: 'Tahorat',
      polishingResult: null,
      rawTranscript: 'Raw transcript',
      reviewItems: [],
      sourceName: 'Desktop',
      startedAt: 1710000000000,
      summary: 'Study notes',
      title: 'Lesson capture',
    });

    assert.equal(validated.courseId, 'course-1');
    assert.equal(validated.lessonId, 'lesson-1');

    const result = await module.saveSessionExport(validated, saveFolder);
    const record = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));

    assert.equal(record.courseId, 'course-1');
    assert.equal(record.courseName, 'Fiqh');
    assert.equal(record.lessonId, 'lesson-1');
    assert.equal(record.lessonName, 'Tahorat');
  } finally {
    cleanup();
    fs.rmSync(saveFolder, { recursive: true, force: true });
  }
});

test('session history accepts older exports without polishing result', async () => {
  const { cleanup, module } = await importSessionExportModule();
  const saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-session-export-legacy-'));

  try {
    const jsonPath = path.join(saveFolder, 'legacy-session.json');
    fs.writeFileSync(jsonPath, `${JSON.stringify({
      bookContextUsed: [],
      correctedTranscript: 'Corrected transcript',
      courseId: 'course-1',
      date: new Date(1710000000000).toISOString(),
      detectedTopics: [],
      exportedAt: new Date(1710000060000).toISOString(),
      lessonId: 'lesson-1',
      rawTranscript: 'Raw transcript',
      reviewItems: [],
      source: 'Desktop',
      sessionId: 'session-1',
      summary: 'Legacy notes',
      title: 'Legacy lesson capture',
    }, null, 2)}\n`, 'utf8');

    const sessions = await module.readSessionExportSummaries(saveFolder);

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].hasJson, true);
    assert.equal(sessions[0].sessionId, 'session-1');
    assert.equal(sessions[0].title, 'Legacy lesson capture');
  } finally {
    cleanup();
    fs.rmSync(saveFolder, { recursive: true, force: true });
  }
});

test('session drafts save incrementally outside export history and can be deleted', async () => {
  const { cleanup, module } = await importSessionExportModule();
  const saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-session-draft-'));

  try {
    const session = module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: '',
      courseId: 'course-1',
      courseName: 'Fiqh',
      detectedTopics: [],
      endedAt: null,
      id: 'session-draft-1',
      lessonId: 'lesson-1',
      lessonName: 'Tahorat',
      polishingResult: null,
      rawTranscript: 'First chunk.\n\nSecond chunk.',
      reviewItems: [],
      sourceName: 'Desktop',
      startedAt: 1710000000000,
      summary: '',
      title: 'Lesson capture',
    });

    const draftResult = await module.saveSessionDraft(session, saveFolder);
    assert.equal(draftResult.jsonPath.includes(`${path.sep}_drafts${path.sep}`), true);
    assert.equal(fs.existsSync(draftResult.jsonPath), true);
    assert.equal(fs.existsSync(draftResult.markdownPath), true);

    const sessions = await module.readSessionExportSummaries(saveFolder);
    assert.equal(sessions.length, 0);

    await module.deleteSessionDraft(session.id, saveFolder);
    assert.equal(fs.existsSync(draftResult.jsonPath), false);
    assert.equal(fs.existsSync(draftResult.markdownPath), false);
  } finally {
    cleanup();
    fs.rmSync(saveFolder, { recursive: true, force: true });
  }
});

test('session history autosaves separately from saved exports and can be cleared', async () => {
  const { cleanup, module } = await importSessionExportModule();
  const saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-session-history-'));

  try {
    const session = module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: 'Corrected transcript',
      detectedTopics: [],
      endedAt: null,
      id: 'session-history-1',
      polishingResult: null,
      rawTranscript: 'Autosaved transcript.',
      reviewItems: [],
      sourceName: 'Desktop',
      startedAt: 1710000000000,
      summary: 'Autosaved notes',
      title: 'Autosaved lesson',
    });

    const historyResult = await module.saveSessionHistory(session, saveFolder);
    assert.equal(historyResult.jsonPath.includes(`${path.sep}_history${path.sep}`), true);
    assert.equal(fs.existsSync(historyResult.jsonPath), true);
    assert.equal(fs.existsSync(historyResult.markdownPath), true);

    const historySessions = await module.readSessionHistorySummaries(saveFolder);
    const savedSessions = await module.readSessionExportSummaries(saveFolder);
    assert.equal(historySessions.length, 1);
    assert.equal(historySessions[0].sessionId, 'session-history-1');
    assert.equal(savedSessions.length, 0);

    const exportResult = await module.saveSessionExport(session, saveFolder);
    assert.equal(exportResult.jsonPath.includes(`${path.sep}_history${path.sep}`), false);
    assert.equal((await module.readSessionHistorySummaries(saveFolder)).length, 1);
    assert.equal((await module.readSessionExportSummaries(saveFolder)).length, 1);

    await module.clearSessionHistory(saveFolder);
    assert.equal((await module.readSessionHistorySummaries(saveFolder)).length, 0);
    assert.equal((await module.readSessionExportSummaries(saveFolder)).length, 1);
  } finally {
    cleanup();
    fs.rmSync(saveFolder, { recursive: true, force: true });
  }
});

test('session history prunes entries older than seven days', async () => {
  const { cleanup, module } = await importSessionExportModule();
  const saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-session-history-prune-'));

  function makeSession(id) {
    return module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: '',
      detectedTopics: [],
      endedAt: null,
      id,
      polishingResult: null,
      rawTranscript: `Transcript for ${id}`,
      reviewItems: [],
      sourceName: 'Desktop',
      startedAt: 1710000000000,
      summary: '',
      title: 'Lesson capture',
    });
  }

  try {
    const oldHistory = await module.saveSessionHistory(makeSession('old-history'), saveFolder);
    const recentHistory = await module.saveSessionHistory(makeSession('recent-history'), saveFolder);
    const attachedOldHistory = await module.saveSessionHistory(module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: '',
      courseId: 'course-1',
      courseName: 'Aqida',
      detectedTopics: [],
      endedAt: null,
      id: 'attached-old-history',
      lessonId: 'lesson-1',
      lessonName: 'Lesson 1',
      polishingResult: null,
      rawTranscript: 'Attached transcript',
      reviewItems: [],
      sourceName: 'Desktop',
      startedAt: 1710000000000,
      summary: '',
      title: 'Attached lesson capture',
    }), saveFolder);
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    fs.utimesSync(oldHistory.jsonPath, oldDate, oldDate);
    fs.utimesSync(oldHistory.markdownPath, oldDate, oldDate);
    fs.utimesSync(attachedOldHistory.jsonPath, oldDate, oldDate);
    fs.utimesSync(attachedOldHistory.markdownPath, oldDate, oldDate);

    const sessions = await module.readSessionHistorySummaries(saveFolder);

    assert.deepEqual(sessions.map((session) => session.sessionId).sort(), ['attached-old-history', 'recent-history']);
    assert.equal(fs.existsSync(oldHistory.jsonPath), false);
    assert.equal(fs.existsSync(oldHistory.markdownPath), false);
    assert.equal(fs.existsSync(recentHistory.jsonPath), true);
    assert.equal(fs.existsSync(recentHistory.markdownPath), true);
    assert.equal(fs.existsSync(attachedOldHistory.jsonPath), true);
    assert.equal(fs.existsSync(attachedOldHistory.markdownPath), true);
  } finally {
    cleanup();
    fs.rmSync(saveFolder, { recursive: true, force: true });
  }
});

test('lesson session records are sorted by date and include raw transcript', async () => {
  const { cleanup, module } = await importSessionExportModule();
  const saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-lesson-session-records-'));

  function makeAttachedSession(id, startedAt, rawTranscript) {
    return module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: '',
      courseId: 'course-1',
      courseName: 'Aqida',
      detectedTopics: [],
      endedAt: startedAt + 1000,
      id,
      lessonId: 'lesson-1',
      lessonName: 'Lesson 1',
      polishingResult: null,
      rawTranscript,
      reviewItems: [],
      sourceName: 'Desktop',
      startedAt,
      summary: '',
      title: `Capture ${id}`,
    });
  }

  try {
    await module.saveSessionHistory(makeAttachedSession('second', 1710000100000, 'Second transcript'), saveFolder);
    await module.saveSessionHistory(makeAttachedSession('first', 1710000000000, 'First transcript'), saveFolder);

    const records = await module.readLessonSessionRecords(saveFolder, 'course-1', 'lesson-1');

    assert.deepEqual(records.map((record) => record.sessionId), ['first', 'second']);
    assert.deepEqual(records.map((record) => record.rawTranscript), ['First transcript', 'Second transcript']);
  } finally {
    cleanup();
    fs.rmSync(saveFolder, { recursive: true, force: true });
  }
});

test('lesson session records follow stored lesson order when session IDs are provided', async () => {
  const { cleanup, module } = await importSessionExportModule();
  const saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-lesson-session-record-order-'));

  try {
    await module.saveSessionHistory(module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: '',
      courseId: 'course-1',
      courseName: 'Course',
      detectedTopics: [],
      endedAt: 2,
      id: 'first',
      lessonId: 'lesson-1',
      lessonName: 'Lesson 1',
      polishingResult: null,
      rawTranscript: 'First transcript',
      reviewItems: [],
      sourceName: 'Screen',
      startedAt: 1,
      summary: '',
      title: 'First',
    }), saveFolder);
    await module.saveSessionHistory(module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: '',
      courseId: 'course-1',
      courseName: 'Course',
      detectedTopics: [],
      endedAt: 4,
      id: 'second',
      lessonId: 'lesson-1',
      lessonName: 'Lesson 1',
      polishingResult: null,
      rawTranscript: 'Second transcript',
      reviewItems: [],
      sourceName: 'Screen',
      startedAt: 3,
      summary: '',
      title: 'Second',
    }), saveFolder);

    const records = await module.readLessonSessionRecords(saveFolder, 'course-1', 'lesson-1', ['second', 'first']);
    assert.deepEqual(records.map((record) => record.sessionId), ['second', 'first']);
  } finally {
    cleanup();
    fs.rmSync(saveFolder, { recursive: true, force: true });
  }
});

test('session history lesson links can be read for store repair', async () => {
  const { cleanup, module } = await importSessionExportModule();
  const saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-session-history-links-'));

  try {
    await module.saveSessionHistory(module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: '',
      courseId: 'course-1',
      detectedTopics: [],
      endedAt: null,
      id: 'session-linked',
      lessonId: 'lesson-1',
      polishingResult: null,
      rawTranscript: 'Linked transcript',
      reviewItems: [],
      sourceName: 'Desktop',
      startedAt: 1710000000000,
      summary: '',
      title: 'Linked capture',
    }), saveFolder);
    await module.saveSessionHistory(module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: '',
      detectedTopics: [],
      endedAt: null,
      id: 'session-unlinked',
      polishingResult: null,
      rawTranscript: 'Unlinked transcript',
      reviewItems: [],
      sourceName: 'Desktop',
      startedAt: 1710000000000,
      summary: '',
      title: 'Unlinked capture',
    }), saveFolder);

    const links = await module.readSessionHistoryLessonLinks(saveFolder);

    assert.deepEqual(links, [{ courseId: 'course-1', lessonId: 'lesson-1', sessionId: 'session-linked' }]);
  } finally {
    cleanup();
    fs.rmSync(saveFolder, { recursive: true, force: true });
  }
});

test('session history can be attached to a lesson after autosave', async () => {
  const { cleanup, module } = await importSessionExportModule();
  const saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-session-history-attach-'));

  try {
    const session = module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: 'Corrected transcript',
      detectedTopics: [],
      endedAt: null,
      id: 'unassigned-session',
      polishingResult: null,
      rawTranscript: 'Transcript recorded before choosing a lesson.',
      reviewItems: [],
      sourceName: 'Desktop',
      startedAt: 1710000000000,
      summary: 'Notes',
      title: 'Unassigned lesson capture',
    });

    const historyResult = await module.saveSessionHistory(session, saveFolder);
    await module.attachSessionHistoryToLesson('unassigned-session', {
      courseId: 'course-1',
      courseName: 'Fiqh',
      lessonId: 'lesson-1',
      lessonName: 'Tahorat',
    }, saveFolder);

    const record = JSON.parse(fs.readFileSync(historyResult.jsonPath, 'utf8'));
    const markdown = fs.readFileSync(historyResult.markdownPath, 'utf8');
    const sessions = await module.readSessionHistorySummaries(saveFolder);

    assert.equal(record.courseId, 'course-1');
    assert.equal(record.courseName, 'Fiqh');
    assert.equal(record.lessonId, 'lesson-1');
    assert.equal(record.lessonName, 'Tahorat');
    assert.equal(markdown.includes('- Course: Fiqh'), true);
    assert.equal(markdown.includes('- Lesson: Tahorat'), true);
    assert.equal(sessions[0].courseId, 'course-1');
    assert.equal(sessions[0].lessonId, 'lesson-1');
  } finally {
    cleanup();
    fs.rmSync(saveFolder, { recursive: true, force: true });
  }
});

test('session draft delete does not remove another session with a matching prefix', async () => {
  const { cleanup, module } = await importSessionExportModule();
  const saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-session-draft-prefix-'));

  function makeSession(id) {
    return module.validateSessionExportPayload({
      bookContextUsed: [],
      correctedTranscript: '',
      detectedTopics: [],
      endedAt: null,
      id,
      polishingResult: null,
      rawTranscript: `Transcript for ${id}`,
      reviewItems: [],
      sourceName: 'Desktop',
      startedAt: 1710000000000,
      summary: '',
      title: 'Lesson capture',
    });
  }

  try {
    const firstDraft = await module.saveSessionDraft(makeSession('session-1'), saveFolder);
    const secondDraft = await module.saveSessionDraft(makeSession('session-10'), saveFolder);

    await module.deleteSessionDraft('session-1', saveFolder);

    assert.equal(fs.existsSync(firstDraft.jsonPath), false);
    assert.equal(fs.existsSync(firstDraft.markdownPath), false);
    assert.equal(fs.existsSync(secondDraft.jsonPath), true);
    assert.equal(fs.existsSync(secondDraft.markdownPath), true);
  } finally {
    cleanup();
    fs.rmSync(saveFolder, { recursive: true, force: true });
  }
});
