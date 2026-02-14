import { type ReactNode, useMemo } from 'react'
import { WorkerPoolContextProvider, type WorkerPoolOptions } from '@pierre/diffs/react'
import { preloadHighlighter } from '@pierre/diffs'
import {
  getPierreWorkerPoolOptions,
  getPierreHighlighterOptions,
  COMMON_LANGUAGES,
  THEME_NAMES,
} from '../../workers/pierreDiffWorkerFactory'

void preloadHighlighter({
  themes: [...THEME_NAMES],
  langs: COMMON_LANGUAGES,
})

export interface PierreDiffProviderProps {
  children: ReactNode
  poolSize?: number
}

export function PierreDiffProvider({ children, poolSize = 2 }: PierreDiffProviderProps) {
  const poolOptions: WorkerPoolOptions = useMemo(() => getPierreWorkerPoolOptions(poolSize), [poolSize])
  const highlighterOptions = useMemo(() => getPierreHighlighterOptions(), [])

  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {children}
    </WorkerPoolContextProvider>
  )
}
