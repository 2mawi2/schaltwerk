import { type ReactNode, useMemo } from 'react'
import { WorkerPoolContextProvider, type WorkerPoolOptions } from '@pierre/diffs/react'
import { getPierreWorkerPoolOptions } from '../../workers/pierreDiffWorkerFactory'

export interface PierreDiffProviderProps {
  children: ReactNode
  poolSize?: number
}

export function PierreDiffProvider({ children, poolSize = 2 }: PierreDiffProviderProps) {
  const poolOptions: WorkerPoolOptions = useMemo(() => getPierreWorkerPoolOptions(poolSize), [poolSize])

  const highlighterOptions = useMemo(
    () => ({
      theme: {
        dark: 'github-dark' as const,
        light: 'github-light' as const,
      },
    }),
    []
  )

  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {children}
    </WorkerPoolContextProvider>
  )
}
