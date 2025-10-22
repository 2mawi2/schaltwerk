import { describe, it, expect, vi } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { loadAllFileDiffs, FileDiffData } from './loadDiffs'
import { invoke } from '@tauri-apps/api/core'
import { createChangedFile } from '../../tests/test-utils'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

function mkFiles(n: number) {
  return Array.from({ length: n }, (_, i) =>
    createChangedFile({ path: `file-${i}.txt`, change_type: 'modified', additions: 0, deletions: 0, changes: 0 })
  )
}

describe('loadDiffs concurrency and single-view compute', () => {
  it('loads only requested view and respects concurrency', async () => {
    const files = mkFiles(12)
    let inflight = 0
    let peak = 0

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetFileDiffFromMain) {
        inflight++
        peak = Math.max(peak, inflight)
        await new Promise(r => setTimeout(r, 10))
        inflight--
        const base = 'a\n'.repeat(1000)
        const head = 'a\n'.repeat(1000)
        return [base, head]
      } else if (cmd === TauriCommands.ComputeUnifiedDiffBackend) {
        // Mock the Rust unified diff computation
        const mockLines = [
          { content: 'a', type: 'unchanged', oldLineNumber: 1, newLineNumber: 1 }
        ]
        return {
          lines: mockLines,
          stats: { additions: 0, deletions: 0 },
          fileInfo: { language: 'text', sizeBytes: 1000 },
          isLargeFile: false
        }
      } else if (cmd === TauriCommands.ComputeSplitDiffBackend) {
        // Mock the Rust split diff computation
        const mockLeftLines = [
          { content: 'a', type: 'unchanged', oldLineNumber: 1 }
        ]
        const mockRightLines = [
          { content: 'a', type: 'unchanged', newLineNumber: 1 }
        ]
        return {
          splitResult: { leftLines: mockLeftLines, rightLines: mockRightLines },
          stats: { additions: 0, deletions: 0 },
          fileInfo: { language: 'text', sizeBytes: 1000 },
          isLargeFile: false
        }
      }
       return undefined
    })

    const start = performance.now()
    const map = await loadAllFileDiffs('s', files, 'unified', 3)
    const elapsed = performance.now() - start

    expect(map.size).toBe(files.length)
    expect(peak).toBeLessThanOrEqual(3)
    // Should complete reasonably fast with simulated IO
    expect(elapsed).toBeLessThan(500)

    // Spot check a single file diff contains unified data only
    const first: FileDiffData | undefined = map.values().next().value
    expect(first).toBeDefined()
    expect(first && 'diffResult' in first).toBe(true)
  })
})
