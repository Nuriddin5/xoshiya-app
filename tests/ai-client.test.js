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

async function importAiClientModule() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xoshiya-ai-client-'));
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}\n', 'utf8');

  transpileTsFileToTempRoot('src/shared/types.ts', tempRoot);
  transpileTsFileToTempRoot('src/shared/lesson-polishing.ts', tempRoot);
  transpileTsFileToTempRoot('src/main/terminology-repair.ts', tempRoot);
  transpileTsFileToTempRoot('src/main/ai-prompts.ts', tempRoot);
  const modulePath = transpileTsFileToTempRoot('src/main/ai-client.ts', tempRoot);

  return {
    cleanup: () => fs.rmSync(tempRoot, { force: true, recursive: true }),
    module: await import(pathToFileURL(modulePath).href),
  };
}

function makeSettings(patch = {}) {
  return {
    aiApiKey: 'test-key',
    aiBaseUrl: 'https://api.example.com/v1',
    aiProvider: 'openai',
    chunkSeconds: 15,
    correctionModel: 'test-correction-model',
    saveFolder: 'C:\\StudyCapture',
    summaryModel: 'test-summary-model',
    ...patch,
  };
}

const correctionPayload = {
  bookContext: [],
  rawTranscript: 'Aqida haqida qisqa dars.',
};

test('AI correction wraps pre-response provider failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('getaddrinfo ENOTFOUND api.example.com');
  };

  const { cleanup, module } = await importAiClientModule();
  try {
    await assert.rejects(
      module.correctTranscript(makeSettings(), correctionPayload),
      /AI provider request failed before receiving a response.*ENOTFOUND/u,
    );
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

test('AI correction validates the configured model before requesting provider', async () => {
  const originalFetch = globalThis.fetch;
  let requested = false;
  globalThis.fetch = async () => {
    requested = true;
    throw new Error('fetch should not be called');
  };

  const { cleanup, module } = await importAiClientModule();
  try {
    await assert.rejects(
      module.correctTranscript(makeSettings({ correctionModel: '' }), correctionPayload),
      /AI provider model is required/u,
    );
    assert.equal(requested, false);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

test('lesson polishing parses structured JSON and resolves source references from snippets', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                contextConfidence: 'medium',
                contextWarning: 'Source context was partial.',
                flashcards: [
                  {
                    answer: 'Tahorat namoz uchun poklikni tayyorlaydi.',
                    prompt: 'Tahoratning asosiy maqsadi nima?',
                    sourceSnippetIds: ['snippet-1'],
                  },
                ],
                keyPoints: ['Tahorat ibodatga tayyorgarlikdir.'],
                polishedTranscript: 'Tahorat haqida aniqroq matn.',
                reviewQuestions: ['Tahoratning farzlari nimalar?'],
                sourceReferences: [
                  {
                    note: 'Tahorat ta`rifini qo`llab-quvvatlaydi.',
                    sourceSnippetId: 'snippet-1',
                  },
                ],
                summary: 'Tahorat mavzusi qisqacha tushuntirildi.',
                terms: [
                  {
                    definition: 'Ibodat oldidan qilinadigan poklanish.',
                    sourceSnippetIds: ['snippet-1'],
                    term: 'Tahorat',
                  },
                ],
                topicTitle: 'Tahorat',
              }),
            },
          },
        ],
      }),
      status: 200,
      statusText: 'OK',
    };
  };

  const { cleanup, module } = await importAiClientModule();
  try {
    const result = await module.polishLessonTranscript(makeSettings(), {
      bookContext: [
        {
          documentId: 'book-1',
          heading: 'Tahorat',
          id: 'snippet-1',
          matchedTerms: ['tahorat'],
          pageNumber: 12,
          score: 6,
          sourceName: 'Fiqh Notes',
          text: 'Tahorat ibodat oldidan qilinadigan poklanishdir.',
        },
      ],
      courseId: 'course-1',
      courseName: 'Fiqh',
      detectedTopics: [],
      lessonId: 'lesson-1',
      lessonName: 'Tahorat darsi',
      rawTranscript: 'Tahorat haqida xom matn.',
      selectedTopic: 'Tahorat',
    });

    assert.equal(result.topicTitle, 'Tahorat');
    assert.equal(result.sourceReferences.length, 1);
    assert.equal(result.sourceReferences[0].sourceName, 'Fiqh Notes');
    assert.equal(result.sourceReferences[0].pageNumber, 12);
    assert.equal(result.flashcards[0].prompt, 'Tahoratning asosiy maqsadi nima?');
    assert.deepEqual(requestBody.response_format, { type: 'json_object' });
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

test('lesson polishing repairs provider JSON with literal newlines inside string values', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: `{
              "topicTitle": "Sifatlar",
              "polishedTranscript": "Birinchi satr
Ikkinchi satr",
              "summary": "Xulosa
davomi",
              "keyPoints": ["Asosiy fikr"],
              "terms": [],
              "flashcards": [],
              "reviewQuestions": ["Savol?"],
              "sourceReferences": [],
              "contextConfidence": "low",
              "contextWarning": "DeepSeek literal newline qaytardi",
            }`,
          },
        },
      ],
    }),
    status: 200,
    statusText: 'OK',
  });

  const { cleanup, module } = await importAiClientModule();
  try {
    const result = await module.polishLessonTranscript(makeSettings(), {
      bookContext: [
        {
          documentId: 'book-1',
          heading: 'Sifatlar',
          id: 'snippet-1',
          matchedTerms: ['sifat'],
          score: 4,
          sourceName: 'Aqida source',
          text: 'Alloh taoloning sifatlari haqida matn.',
        },
      ],
      detectedTopics: [],
      rawTranscript: 'Alloh taoloning sifatlari haqida raw matn.',
    });

    assert.equal(result.correctedTranscript, 'Birinchi satr\nIkkinchi satr');
    assert.equal(result.summary, 'Xulosa\ndavomi');
    assert.equal(result.contextConfidence, 'low');
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

test('lesson polishing falls back to corrected transcript when structured JSON stays invalid', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);

    if (requests.length === 1) {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"topicTitle":"Aqida","polishedTranscript":"unterminated',
              },
            },
          ],
        }),
        status: 200,
        statusText: 'OK',
      };
    }

    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Fallback corrected transcript matni.',
            },
          },
        ],
      }),
      status: 200,
      statusText: 'OK',
    };
  };

  const { cleanup, module } = await importAiClientModule();
  try {
    const result = await module.polishLessonTranscript(makeSettings({
      correctionModel: 'fallback-correction-model',
      summaryModel: 'structured-summary-model',
    }), {
      bookContext: [],
      detectedTopics: [],
      rawTranscript: 'Raw transcript fallback sinovi.',
      selectedTopic: 'Aqida',
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].model, 'structured-summary-model');
    assert.deepEqual(requests[0].response_format, { type: 'json_object' });
    assert.equal(requests[1].model, 'fallback-correction-model');
    assert.equal(requests[1].response_format, undefined);
    assert.equal(result.correctedTranscript, 'Fallback corrected transcript matni.');
    assert.equal(result.summary, 'Fallback corrected transcript matni.');
    assert.equal(result.topicTitle, 'Aqida');
    assert.equal(result.contextConfidence, 'missing');
    assert.match(result.contextWarning, /Structured lesson polishing failed/u);
    assert.deepEqual(result.keyPoints, []);
    assert.deepEqual(result.flashcards, []);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

test('lesson polishing marks context missing when no book snippets are provided', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              contextConfidence: 'high',
              contextWarning: '',
              flashcards: [],
              keyPoints: ['Transcript-only point.'],
              polishedTranscript: 'Manbasiz transcript sayqallandi.',
              reviewQuestions: ['Asosiy savol nima?'],
              sourceReferences: [
                {
                  note: 'Invented reference should be ignored.',
                  sourceSnippetId: 'missing-snippet',
                },
              ],
              summary: 'Manba topilmagan holatda qisqa xulosa.',
              terms: [],
              topicTitle: 'Manbasiz mavzu',
            }),
          },
        },
      ],
    }),
    status: 200,
    statusText: 'OK',
  });

  const { cleanup, module } = await importAiClientModule();
  try {
    const result = await module.polishLessonTranscript(makeSettings(), {
      bookContext: [],
      courseName: 'Fiqh',
      detectedTopics: [],
      lessonName: 'No source lesson',
      rawTranscript: 'Manba topilmagan raw transcript.',
    });

    assert.equal(result.contextConfidence, 'missing');
    assert.match(result.contextWarning, /No relevant book\/source context/u);
    assert.deepEqual(result.sourceReferences, []);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

test('lesson question answering sends polished lesson and book context to summary model', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Жавоб: B) Зотидан бошқа маънони ифодаловчи сифатлари.\nМанба: sayqallangan dars va Aqida source.',
            },
          },
        ],
      }),
      status: 200,
      statusText: 'OK',
    };
  };

  const { cleanup, module } = await importAiClientModule();
  try {
    const bookContext = [
      {
        documentId: 'book-1',
        heading: 'Субутий сифатлар',
        id: 'snippet-1',
        matchedTerms: ['сифатлари'],
        score: 5,
        sourceName: 'Aqida source',
        text: 'Субутий сифатлар зотдан бошқа маънони ифодалайди.',
      },
    ];

    const result = await module.answerLessonQuestion(makeSettings({ summaryModel: 'lesson-answer-model' }), {
      bookContext,
      courseName: 'Aqida',
      lessonName: 'Sifatlar',
      lessonOutput: 'Subutiy sifatlar dars konspekti.',
      polishedLessonText: 'Sayqallangan dars matnida subutiy sifatlar tushuntirilgan.',
      question: 'Аллоҳ таолонинг қандай сифатлари субутий сифатлари дейилади?',
    });

    assert.equal(requestBody.model, 'lesson-answer-model');
    assert.equal(requestBody.response_format, undefined);
    assert.match(requestBody.messages[1].content, /Sayqallangan dars matnida/u);
    assert.match(requestBody.messages[1].content, /Субутий сифатлар зотдан бошқа/u);
    assert.match(result.answerText, /Жавоб: B/u);
    assert.equal(result.bookContextUsed.length, 1);
    assert.equal(result.bookContextUsed[0].id, 'snippet-1');
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});
