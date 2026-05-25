export type TaskQueue = {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  getStats(): TaskQueueStats;
  waitForIdle(): Promise<void>;
};

export type TaskQueueStats = {
  activeCount: number;
  completedCount: number;
  concurrency: number;
  failedCount: number;
  queuedCount: number;
};

export function createTaskQueue(concurrency: number): TaskQueue {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Task queue concurrency must be a positive integer.');
  }

  const queue: Array<{ run: () => void }> = [];
  const idleResolvers = new Set<() => void>();
  let activeCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  function resolveIdleWaiters() {
    if (activeCount !== 0 || queue.length !== 0) {
      return;
    }

    for (const resolve of idleResolvers) {
      resolve();
    }

    idleResolvers.clear();
  }

  function processQueue() {
    while (activeCount < concurrency && queue.length > 0) {
      const next = queue.shift();
      if (next) {
        activeCount++;
        next.run();
      }
    }
  }

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          run: async () => {
            try {
              const result = await task();
              completedCount++;
              resolve(result);
            } catch (error) {
              failedCount++;
              reject(error);
            } finally {
              activeCount--;
              processQueue();
              resolveIdleWaiters();
            }
          },
        });
        processQueue();
      });
    },
    getStats(): TaskQueueStats {
      return {
        activeCount,
        completedCount,
        concurrency,
        failedCount,
        queuedCount: queue.length,
      };
    },
    waitForIdle(): Promise<void> {
      if (activeCount === 0 && queue.length === 0) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        idleResolvers.add(resolve);
      });
    },
  };
}
