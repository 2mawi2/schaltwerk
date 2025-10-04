// src/common/terminalSizeCache.ts
type Size = { cols: number; rows: number; ts: number };
const cache = new Map<string, Size>();
const TTL_MS = 1000 * 60 * 60 * 12; // 12h, tweak as you like
const MIN = { cols: 100, rows: 28 }; // hard floor to avoid silly sizes
const MAX = { cols: 280, rows: 90 }; // sanity ceiling

export function recordTerminalSize(id: string, cols: number, rows: number) {
  cache.set(id, { cols, rows, ts: Date.now() });
}

export function getTerminalSize(id: string): { cols: number; rows: number } | null {
  const hit = cache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.ts > TTL_MS) { cache.delete(id); return null; }
  return { cols: hit.cols, rows: hit.rows };
}

export function clearCacheForTesting(): void {
  cache.clear();
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
    (opts.projectOrchestratorId ? getTerminalSize(opts.projectOrchestratorId) : null);

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

  cols = Math.min(MAX.cols, Math.max(MIN.cols, cols));
  rows = Math.min(MAX.rows, Math.max(MIN.rows, rows));
  return { cols, rows };
}