import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { ChangedFile } from '../../common/events'
import type { DiffResponse } from '../../types/diff'
import { loadFileDiff, type FileDiffData, type ViewMode } from '../../components/diff/loadDiffs'
import { convertDiffResponseToFileDiffMetadata } from '../../adapters/pierreDiffAdapter'
import { getOrCreateWorkerPoolSingleton } from '@pierre/diffs/worker'
import { getHighlighterIfLoaded, renderDiffWithHighlighter } from '@pierre/diffs'
import {
  getPierreWorkerPoolOptions,
  getPierreHighlighterOptions,
} from '../../workers/pierreDiffWorkerFactory'
import { logger } from '../../utils/logger'

async function waitForPoolInit(pool: ReturnType<typeof getOrCreateWorkerPoolSingleton>): Promise<void> {
  if (pool.isInitialized()) return
  const state = (pool as unknown as Record<string, unknown>).initialized
  if (state instanceof Promise) {
    await state
  }
}

class DiffPreloadManager {
  private activeSession: string | null = null
  private controller: AbortController | null = null
  private preloadedFiles = new Map<string, ChangedFile[]>()
  private preloadedDiffs = new Map<string, Map<string, FileDiffData>>()

  preload(
    sessionName: string | null,
    isOrchestrator: boolean,
    diffLayout: ViewMode
  ): void {
    if (!sessionName) return

    if (this.activeSession === sessionName && this.preloadedFiles.has(sessionName)) {
      return
    }

    logger.debug(`[DiffPreloader] Starting preload for session=${sessionName} orchestrator=${isOrchestrator} layout=${diffLayout}`)

    this.controller?.abort()
    this.controller = new AbortController()
    this.activeSession = sessionName

    const { signal } = this.controller

    void this.runPreload(sessionName, isOrchestrator, diffLayout, signal)
  }

  invalidate(sessionName: string): void {
    this.preloadedFiles.delete(sessionName)
    this.preloadedDiffs.delete(sessionName)
    if (this.activeSession === sessionName) {
      this.activeSession = null
    }
  }

  getChangedFiles(sessionName: string): ChangedFile[] | null {
    const result = this.preloadedFiles.get(sessionName) ?? null
    logger.debug(`[DiffPreloader] getChangedFiles(${sessionName}): ${result ? `${result.length} files` : 'miss'}`)
    return result
  }

  getFileDiff(sessionName: string, filePath: string): FileDiffData | null {
    return this.preloadedDiffs.get(sessionName)?.get(filePath) ?? null
  }

  private async runPreload(
    sessionName: string,
    isOrchestrator: boolean,
    diffLayout: ViewMode,
    signal: AbortSignal
  ): Promise<void> {
    const startTime = performance.now()
    try {
      const changedFiles = isOrchestrator
        ? await invoke<ChangedFile[]>(TauriCommands.GetOrchestratorWorkingChanges)
        : await invoke<ChangedFile[]>(TauriCommands.GetChangedFilesFromMain, { sessionName })

      if (signal.aborted) return

      logger.debug(`[DiffPreloader] Fetched ${changedFiles.length} changed files in ${Math.round(performance.now() - startTime)}ms`)
      this.preloadedFiles.set(sessionName, changedFiles)

      if (changedFiles.length === 0) return

      const diffMap = new Map<string, FileDiffData>()
      this.preloadedDiffs.set(sessionName, diffMap)

      let index = 0
      const concurrency = 4
      const files = changedFiles

      const runNext = async (): Promise<void> => {
        while (index < files.length) {
          if (signal.aborted) return
          const myIndex = index++
          const file = files[myIndex]
          try {
            const diff = await loadFileDiff(sessionName, file, diffLayout)
            if (signal.aborted) return
            diffMap.set(file.path, diff)
          } catch (e) {
            logger.debug(`[DiffPreloader] Failed to preload diff for ${file.path}`, e)
          }
        }
      }

      const workers = Math.min(concurrency, files.length)
      const loadTasks: Promise<void>[] = []
      for (let i = 0; i < workers; i++) {
        loadTasks.push(runNext())
      }
      await Promise.all(loadTasks)

      if (signal.aborted) return

      const highlightCached = await this.batchCacheHighlights(diffMap, diffLayout, signal)
      const elapsed = Math.round(performance.now() - startTime)
      logger.debug(`[DiffPreloader] Preload complete: ${diffMap.size} diffs loaded, ${highlightCached} highlighted in ${elapsed}ms`)
    } catch (e) {
      if (!signal.aborted) {
        logger.debug('[DiffPreloader] Preload failed', e)
      }
    }
  }

  private async batchCacheHighlights(
    diffMap: Map<string, FileDiffData>,
    diffLayout: ViewMode,
    signal: AbortSignal
  ): Promise<number> {
    if (diffLayout !== 'unified') return 0

    const pool = getOrCreateWorkerPoolSingleton({
      poolOptions: getPierreWorkerPoolOptions(),
      highlighterOptions: getPierreHighlighterOptions(),
    })

    await waitForPoolInit(pool)
    if (signal.aborted) return 0

    const highlighter = getHighlighterIfLoaded()
    if (!highlighter) {
      logger.debug('[DiffPreloader] Shiki not loaded on main thread, skipping highlight cache')
      return 0
    }

    const options = pool.getDiffRenderOptions()
    const { diffCache } = pool.inspectCaches()
    let count = 0

    for (const [filePath, diff] of diffMap) {
      if (signal.aborted) return count
      if (!('diffResult' in diff)) continue

      try {
        const response: DiffResponse = {
          lines: diff.diffResult,
          stats: {
            additions: diff.file.additions,
            deletions: diff.file.deletions,
          },
          fileInfo: diff.fileInfo,
          isLargeFile: false,
          isBinary: diff.isBinary,
          unsupportedReason: diff.unsupportedReason,
        }

        const converted = convertDiffResponseToFileDiffMetadata(response, filePath)
        const { cacheKey } = converted.fileDiff
        if (!cacheKey) continue
        if (pool.getDiffResultCache(converted.fileDiff)) continue

        const result = renderDiffWithHighlighter(converted.fileDiff, highlighter, options)
        diffCache.set(cacheKey, { result, options })
        count++
        logger.debug(`[DiffPreloader] Cached highlight for ${filePath}`)
      } catch (e) {
        logger.debug(`[DiffPreloader] Failed to highlight ${filePath}`, e)
      }
    }

    return count
  }
}

export const diffPreloader = new DiffPreloadManager()
