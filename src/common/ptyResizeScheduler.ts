import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from './tauriCommands'

type Size = { cols: number; rows: number }

const pending = new Map<string, Size>()
let rafId = 0
let lastFlush = 0

// Defaults; we currently force immediate flush to preserve existing behavior in tests.
const DRAG_FPS = 15
const NORMAL_FPS = 60

export function schedulePtyResize(
  id: string,
  size: Size,
  opts?: { force?: boolean }
) {
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line no-console
    console.log('[schedulePtyResize]', id, size, opts?.force);
  }
  pending.set(id, size)
  if (opts?.force) {
    flush(performance.now(), true)
    return
  }
  if (!rafId) rafId = requestAnimationFrame(ts => flush(ts, false))
}

function flush(ts: number, immediate: boolean) {
  rafId = 0
  const dragging = typeof document !== 'undefined' && document.body.classList.contains('is-split-dragging')
  const interval = 1000 / (dragging ? DRAG_FPS : NORMAL_FPS)

  // For now, favor responsiveness: flush immediately if requested or interval elapsed
  if (!immediate && ts - lastFlush < interval) {
    rafId = requestAnimationFrame(t => flush(t, false))
    return
  }
  lastFlush = ts

  const batch = Array.from(pending.entries())
  pending.clear()

  for (const [id, { cols, rows }] of batch) {
    // Preserve original behavior: invoke directly
    // Downstream code already guards min sizes and right-edge margin
    invoke(TauriCommands.ResizeTerminal, { id, cols, rows }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[PTY] resize ignored', err)
    })
  }
}
