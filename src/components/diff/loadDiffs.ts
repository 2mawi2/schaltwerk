import { invoke } from '@tauri-apps/api/core'
import { addCollapsibleSections, computeSplitDiff, computeUnifiedDiff } from '../../utils/diff'

export type ChangeType = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'

export interface ChangedFile {
  path: string
  change_type: ChangeType
}

export type ViewMode = 'unified' | 'split'

export interface FileDiffDataUnified {
  file: ChangedFile
  mainContent: string
  worktreeContent: string
  diffResult: ReturnType<typeof addCollapsibleSections>
  changedLinesCount: number
}

export interface FileDiffDataSplit {
  file: ChangedFile
  mainContent: string
  worktreeContent: string
  splitDiffResult: ReturnType<typeof computeSplitDiff>
  changedLinesCount: number
}

export type FileDiffData = FileDiffDataUnified | FileDiffDataSplit

function countChangedLinesUnified(lines: ReturnType<typeof addCollapsibleSections>): number {
  let count = 0
  for (const line of lines) {
    if (line.isCollapsible && line.collapsedLines) {
      // Only added/removed lines are considered changed
      for (const cl of line.collapsedLines) {
        if (cl.type !== 'unchanged') count++
      }
    } else if (line.type !== 'unchanged') {
      count++
    }
  }
  return count
}

function countChangedLinesSplit(split: ReturnType<typeof computeSplitDiff>): number {
  let count = 0
  const left = split.leftLines
  const right = split.rightLines
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i]?.type === 'removed') count++
    if (right[i]?.type === 'added') count++
  }
  return count
}

export async function loadFileDiff(
  sessionName: string | null,
  file: ChangedFile,
  viewMode: ViewMode
): Promise<FileDiffData> {
  const [mainText, worktreeText] = await invoke<[string, string]>('get_file_diff_from_main', {
    sessionName,
    filePath: file.path,
  })

  if (viewMode === 'unified') {
    const diffLines = computeUnifiedDiff(mainText, worktreeText)
    const diffResult = addCollapsibleSections(diffLines)
    const changedLinesCount = countChangedLinesUnified(diffResult)
    return { file, mainContent: mainText, worktreeContent: worktreeText, diffResult, changedLinesCount }
  } else {
    const splitDiffResult = computeSplitDiff(mainText, worktreeText)
    const changedLinesCount = countChangedLinesSplit(splitDiffResult)
    return { file, mainContent: mainText, worktreeContent: worktreeText, splitDiffResult, changedLinesCount }
  }
}

export async function loadAllFileDiffs(
  sessionName: string | null,
  files: ChangedFile[],
  viewMode: ViewMode,
  concurrency = 4
): Promise<Map<string, FileDiffData>> {
  const results = new Map<string, FileDiffData>()
  let index = 0
  const inFlight: Promise<void>[] = []

  const runNext = async () => {
    const myIndex = index++
    if (myIndex >= files.length) return
    const file = files[myIndex]
    try {
      const diff = await loadFileDiff(sessionName, file, viewMode)
      results.set(file.path, diff)
    } catch (e) {
      // Swallow per-file errors; caller can decide how to surface
      // Keep place so UI can skip missing entries
    }
    await runNext()
  }

  const workers = Math.min(concurrency, files.length)
  for (let i = 0; i < workers; i++) {
    inFlight.push(runNext())
  }
  await Promise.all(inFlight)
  return results
}
