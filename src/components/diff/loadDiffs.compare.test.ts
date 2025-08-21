import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { loadAllFileDiffs } from './loadDiffs'
import { computeUnifiedDiff, computeSplitDiff } from '../../utils/diff'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

function mkFiles(n: number) {
  return Array.from({ length: n }, (_, i) => ({ path: `file-${i}.txt`, change_type: 'modified' as const }))
}

async function oldSequentialLoader(sessionName: string | null, files: ReturnType<typeof mkFiles>) {
  const results = new Map<string, any>()
  for (const f of files) {
    const [base, head] = await invoke('get_file_diff_from_main', { sessionName, filePath: f.path }) as [string, string]
    const unified = computeUnifiedDiff(base, head)
    const split = computeSplitDiff(base, head)
    results.set(f.path, { unifiedLen: unified.length, splitLeft: split.leftLines.length })
  }
  return results
}

describe('Loader performance comparison (old vs new)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('new loader (concurrency + single-view) is faster than old sequential (both views)', async () => {
    const files = mkFiles(30)
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_file_diff_from_main') {
        // Simulate IO
        await new Promise(r => setTimeout(r, 2))
        const base = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n') + '\n'
        const head = base
        return [base, head] as any
      }
      return undefined as any
    })

    const t0 = performance.now()
    const oldMap = await oldSequentialLoader('s', files)
    const t1 = performance.now()

    const t2 = performance.now()
    const newMap = await loadAllFileDiffs('s', files, 'unified', 4)
    const t3 = performance.now()

    const oldMs = t1 - t0
    const neuMs = t3 - t2

    // Log numbers for visibility in CI/local runs
    console.log(`[loader-compare] old=${oldMs.toFixed(1)}ms new=${neuMs.toFixed(1)}ms speedup=${(oldMs/neuMs).toFixed(2)}x`)

    expect(oldMap.size).toBe(files.length)
    expect(newMap.size).toBe(files.length)

    // Expect at least 1.5x speedup under simulated conditions
    expect(oldMs / neuMs).toBeGreaterThan(1.5)
  })
})
