import { describe, it, expect, vi } from 'vitest'
import { loadAllFileDiffs } from './loadDiffs'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

function mkFiles(n: number) {
  return Array.from({ length: n }, (_, i) => ({ path: `file-${i}.txt`, change_type: 'modified' as const }))
}

describe('loadDiffs concurrency and single-view compute', () => {
  it('loads only requested view and respects concurrency', async () => {
    const files = mkFiles(12)
    let inflight = 0
    let peak = 0

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_file_diff_from_main') {
        inflight++
        peak = Math.max(peak, inflight)
        await new Promise(r => setTimeout(r, 10))
        inflight--
        const base = 'a\n'.repeat(1000)
        const head = 'a\n'.repeat(1000)
        return [base, head]
      }
      return undefined as any
    })

    const start = performance.now()
    const map = await loadAllFileDiffs('s', files, 'unified', 3)
    const elapsed = performance.now() - start

    expect(map.size).toBe(files.length)
    expect(peak).toBeLessThanOrEqual(3)
    // Should complete reasonably fast with simulated IO
    expect(elapsed).toBeLessThan(500)

    // Spot check a single file diff contains unified data only
    const first: any = map.values().next().value
    expect(first).toBeDefined()
    expect('diffResult' in first).toBe(true)
  })
})
