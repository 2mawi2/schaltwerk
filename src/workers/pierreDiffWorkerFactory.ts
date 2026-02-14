import type { SupportedLanguages } from '@pierre/diffs'
import type { WorkerPoolOptions, WorkerInitializationRenderOptions } from '@pierre/diffs/react'

export const COMMON_LANGUAGES: SupportedLanguages[] = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'rust',
  'json',
  'css',
  'html',
  'markdown',
  'yaml',
  'toml',
]

export const THEME_NAMES = ['github-dark', 'github-light'] as const

export const THEMES = {
  dark: 'github-dark' as const,
  light: 'github-light' as const,
}

export function getPierreHighlighterOptions(): WorkerInitializationRenderOptions {
  return {
    theme: THEMES,
    langs: COMMON_LANGUAGES,
  }
}

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
