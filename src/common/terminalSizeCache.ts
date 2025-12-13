import { logger } from '../utils/logger'

// src/common/terminalSizeCache.ts
type Size = { cols: number; rows: number; ts: number };
// In-memory "last known" sizes used to bootstrap terminals during a single app run (fast path).
const cache = new Map<string, Size>();
const TTL_MS = 1000 * 60 * 60 * 12; // 12h, tweak as you like
const MIN = { cols: 100, rows: 28 }; // hard floor to avoid silly sizes
const MAX = { cols: 280, rows: 90 }; // sanity ceiling

type PersistedSize = { cols: number; rows: number; ts: number }

const STORAGE_PREFIX = 'schaltwerk:terminalSize:'
const STORAGE_LAST_TOP_KEY = `${STORAGE_PREFIX}lastTop`
// LocalStorage writes can happen at high frequency during resizes; keep a tiny in-memory mirror to avoid
// repeatedly serializing/writing identical payloads. This is internal plumbing (not UI state) and mirrors
// the "module singleton" pattern used by other terminal helpers like `terminalStartState`.
const storageMirror = new Map<string, { cols: number; rows: number }>()
const loggedStorageFailures = new Set<string>()
let loggedStorageUnavailable = false

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage)
  } catch (error) {
    if (!loggedStorageUnavailable) {
      loggedStorageUnavailable = true
      logger.warn(
        '[terminalSizeCache] localStorage unavailable; terminal bootstrap sizes will not be persisted',
        error,
      )
    }
    return false
  }
}

function storageGet(key: string): PersistedSize | null {
  if (!canUseStorage()) return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedSize>
    if (typeof parsed.cols !== 'number' || typeof parsed.rows !== 'number') return null
    const ts = typeof parsed.ts === 'number' ? parsed.ts : 0
    return { cols: parsed.cols, rows: parsed.rows, ts }
  } catch (error) {
    const signature = `storage:get:${key}`
    if (!loggedStorageFailures.has(signature)) {
      loggedStorageFailures.add(signature)
      logger.warn(`[terminalSizeCache] Failed to read persisted terminal size from localStorage key='${key}'`, error)
    }
    return null
  }
}

function storageSet(key: string, cols: number, rows: number): void {
  if (!canUseStorage()) return
  const previous = storageMirror.get(key)
  if (previous && previous.cols === cols && previous.rows === rows) return
  storageMirror.set(key, { cols, rows })
  try {
    const payload: PersistedSize = { cols, rows, ts: Date.now() }
    window.localStorage.setItem(key, JSON.stringify(payload))
  } catch (error) {
    const signature = `storage:set:${key}`
    if (!loggedStorageFailures.has(signature)) {
      loggedStorageFailures.add(signature)
      logger.warn(`[terminalSizeCache] Failed to persist terminal size to localStorage key='${key}'`, error)
    }
  }
}

function clampSize(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: Math.min(MAX.cols, Math.max(MIN.cols, cols)),
    rows: Math.min(MAX.rows, Math.max(MIN.rows, rows)),
  }
}

function persistedKeyForTerminal(id: string): string {
  // Uses terminal ids directly. Orchestrator ids include a project-specific hash; session/run ids are
  // intentionally stable across projects (session-name scope), matching the terminal id rules.
  return `${STORAGE_PREFIX}${id}`
}

function getPersistedSizeForTerminal(id: string): { cols: number; rows: number } | null {
  const hit = storageGet(persistedKeyForTerminal(id))
  if (!hit) return null
  return clampSize(hit.cols, hit.rows)
}

function getPersistedLastTopSize(): { cols: number; rows: number } | null {
  const hit = storageGet(STORAGE_LAST_TOP_KEY)
  if (!hit) return null
  return clampSize(hit.cols, hit.rows)
}

export function recordTerminalSize(id: string, cols: number, rows: number) {
  cache.set(id, { cols, rows, ts: Date.now() });
  if (id.endsWith('-top')) {
    const clamped = clampSize(cols, rows)
    storageSet(STORAGE_LAST_TOP_KEY, clamped.cols, clamped.rows)
    if (id.startsWith('orchestrator-')) {
      storageSet(persistedKeyForTerminal(id), clamped.cols, clamped.rows)
    }
  }
}

export function getTerminalSize(id: string): { cols: number; rows: number } | null {
  const hit = cache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.ts > TTL_MS) { cache.delete(id); return null; }
  return { cols: hit.cols, rows: hit.rows };
}

export function clearCacheForTesting(): void {
  cache.clear();
  storageMirror.clear()
  loggedStorageFailures.clear()
  loggedStorageUnavailable = false
}

/**
 * Best-effort bootstrap:
 * 1) exact id
 * 2) project orchestrator (helps newly created sessions in same project)
 * 3) any other top terminal (better than bottom terminals which have different dimensions)
 * 4) conservative fallback derived from viewport (last resort)
 *
 * We add a tiny +2 col safety margin because you observed wrap vanishing when width increases by ~2–3.
 * The terminal will immediately resize to the exact live size on mount anyway.
 */
export function bestBootstrapSize(opts: {
  topId: string;           // e.g. "session-foo-top"
  projectOrchestratorId?: string; // e.g. "orchestrator-<project>-top"
}): { cols: number; rows: number } {
  // First try exact match or orchestrator
  const cand =
    getTerminalSize(opts.topId) ??
    (opts.projectOrchestratorId ? getTerminalSize(opts.projectOrchestratorId) : null) ??
    (opts.projectOrchestratorId ? getPersistedSizeForTerminal(opts.projectOrchestratorId) : null) ??
    getPersistedLastTopSize();

  // If no direct match, try to find any other top or run terminal (avoid bottom terminals)
  let fallbackCand = null;
  if (!cand) {
    for (const [id, size] of cache.entries()) {
      if (Date.now() - size.ts > TTL_MS) {
        cache.delete(id);
        continue;
      }
      if (id.endsWith('-top') || id.startsWith('run-terminal-')) {
        fallbackCand = { cols: size.cols, rows: size.rows };
        break;
      }
    }
  }

  const bestCand = cand ?? fallbackCand;
  let cols: number;
  let rows: number;

  if (bestCand) {
    cols = bestCand.cols + 2;   // <= important: give Claude a little breathing room
    rows = bestCand.rows;
  } else {
    // viewport-derived conservative guess (works even before mount)
    // These divisors are typical monospace cell sizes on macOS @1x/@2x
    const vw = (typeof window !== 'undefined' ? window.innerWidth : 1440);
    const vh = (typeof window !== 'undefined' ? window.innerHeight : 900);
    cols = Math.floor(Math.max(MIN.cols, Math.min(MAX.cols, (vw - 360) / 8.5)));
    rows = Math.floor(Math.max(MIN.rows, Math.min(MAX.rows, (vh - 280) / 17)));
  }

  const clamped = clampSize(cols, rows)
  cols = clamped.cols
  rows = clamped.rows
  return { cols, rows };
}
