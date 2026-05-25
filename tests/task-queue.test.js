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

test('task queue respects concurrency limit', async () => {
  const { createTaskQueue } = await importTranspiledTsModule('src/shared/task-queue.ts');
  const queue = createTaskQueue(2);
  const order = [];
  let activeJobs = 0;
  let peakJobs = 0;
  let releaseFirst;
  let releaseSecond;

  const firstStarted = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const secondStarted = new Promise((resolve) => {
    releaseSecond = resolve;
  });

  const first = queue.enqueue(async () => {
    order.push('first:start');
    activeJobs += 1;
    peakJobs = Math.max(peakJobs, activeJobs);
    await firstStarted;
    activeJobs -= 1;
    order.push('first:end');
    return 'first';
  });

  const second = queue.enqueue(async () => {
    order.push('second:start');
    activeJobs += 1;
    peakJobs = Math.max(peakJobs, activeJobs);
    await secondStarted;
    activeJobs -= 1;
    order.push('second:end');
    return 'second';
  });

  const third = queue.enqueue(async () => {
    order.push('third:start');
    activeJobs += 1;
    peakJobs = Math.max(peakJobs, activeJobs);
    activeJobs -= 1;
    order.push('third:end');
    return 'third';
  });

  // wait a tick to allow first and second to start
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(queue.getStats(), {
    activeCount: 2,
    completedCount: 0,
    concurrency: 2,
    failedCount: 0,
    queuedCount: 1,
  });
  assert.equal(peakJobs, 2);
  assert.equal(activeJobs, 2);
  assert.deepEqual(order, ['first:start', 'second:start']);

  releaseFirst();
  await first;

  // wait a tick for third to start
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(order, ['first:start', 'second:start', 'first:end', 'third:start', 'third:end']);

  releaseSecond();
  await second;

  const results = await Promise.all([first, second, third]);
  assert.deepEqual(results, ['first', 'second', 'third']);
  assert.deepEqual(queue.getStats(), {
    activeCount: 0,
    completedCount: 3,
    concurrency: 2,
    failedCount: 0,
    queuedCount: 0,
  });
});

test('task queue rejects invalid concurrency', async () => {
  const { createTaskQueue } = await importTranspiledTsModule('src/shared/task-queue.ts');

  assert.throws(() => createTaskQueue(0), /positive integer/);
});

test('task queue waitForIdle resolves after active and queued work drains', async () => {
  const { createTaskQueue } = await importTranspiledTsModule('src/shared/task-queue.ts');
  const queue = createTaskQueue(1);
  const order = [];
  let releaseFirst;

  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  void queue.enqueue(async () => {
    order.push('first:start');
    await firstGate;
    order.push('first:end');
  });

  void queue.enqueue(async () => {
    order.push('second:start');
    order.push('second:end');
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  const idlePromise = queue.waitForIdle().then(() => {
    order.push('idle');
  });

  releaseFirst();
  await idlePromise;

  assert.deepEqual(order, [
    'first:start',
    'first:end',
    'second:start',
    'second:end',
    'idle',
  ]);
});
