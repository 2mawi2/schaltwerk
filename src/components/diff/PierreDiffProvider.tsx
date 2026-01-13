import { type ReactNode, useMemo, useEffect, useState } from 'react'
import { WorkerPoolContextProvider, type WorkerPoolOptions } from '@pierre/diffs/react'
import { preloadHighlighter, type SupportedLanguages } from '@pierre/diffs'
import { getPierreWorkerPoolOptions } from '../../workers/pierreDiffWorkerFactory'

export interface PierreDiffProviderProps {
  children: ReactNode
  poolSize?: number
}

const COMMON_LANGUAGES: SupportedLanguages[] = [
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

const THEME_NAMES = ['github-dark', 'github-light'] as const

const THEMES = {
  dark: 'github-dark' as const,
  light: 'github-light' as const,
}

let highlighterPreloaded = false
let highlighterPreloadPromise: Promise<void> | null = null

function ensureHighlighterPreloaded(): Promise<void> {
  if (highlighterPreloaded) {
    return Promise.resolve()
  }
  if (!highlighterPreloadPromise) {
    highlighterPreloadPromise = preloadHighlighter({
      themes: THEME_NAMES,
      langs: COMMON_LANGUAGES,
    }).then(() => {
      highlighterPreloaded = true
    })
  }
  return highlighterPreloadPromise
}

export function PierreDiffProvider({ children, poolSize = 2 }: PierreDiffProviderProps) {
  const [ready, setReady] = useState(highlighterPreloaded)

  useEffect(() => {
    if (!ready) {
      void ensureHighlighterPreloaded().then(() => setReady(true))
    }
  }, [ready])

  const poolOptions: WorkerPoolOptions = useMemo(() => getPierreWorkerPoolOptions(poolSize), [poolSize])

  const highlighterOptions = useMemo(
    () => ({
      theme: THEMES,
      langs: COMMON_LANGUAGES,
    }),
    []
  )

  if (!ready) {
    return null
  }

  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {children}
    </WorkerPoolContextProvider>
  )
}
