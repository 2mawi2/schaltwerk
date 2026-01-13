import type { WorkerPoolOptions } from '@pierre/diffs/react'

export function createPierreWorkerFactory(): WorkerPoolOptions['workerFactory'] {
  return () => {
    return new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
      type: 'module',
    })
  }
}

export const DEFAULT_POOL_SIZE = 2

export function getPierreWorkerPoolOptions(poolSize: number = DEFAULT_POOL_SIZE): WorkerPoolOptions {
  return {
    workerFactory: createPierreWorkerFactory(),
    poolSize,
    totalASTLRUCacheSize: 100,
  }
}
