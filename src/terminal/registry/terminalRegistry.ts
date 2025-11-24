import { logger } from '../../utils/logger';
import { XtermTerminal } from '../xterm/XtermTerminal';
import { disposeGpuRenderer } from '../gpu/gpuRendererRegistry';
import { sessionTerminalBaseVariants, sanitizeSessionName } from '../../common/terminalIdentity';
import { terminalOutputManager } from '../stream/terminalOutputManager';

export interface TerminalInstanceRecord {
  id: string;
  xterm: XtermTerminal;
  refCount: number;
  lastSeq: number | null;
  initialized: boolean;
  attached: boolean;
  streamRegistered: boolean;
  streamListener?: (chunk: string) => void;
  pendingChunks?: string[];
  rafScheduled?: boolean;
  rafHandle?: number;
  perf?: TerminalPerfStats;
}

export interface AcquireTerminalResult {
  record: TerminalInstanceRecord;
  isNew: boolean;
}

type TerminalInstanceFactory = () => XtermTerminal;

interface TerminalPerfStats {
  firstFlushAt: number | null;
  lastLogAt: number | null;
  lastFlushAt: number | null;
  flushes: number;
  bytes: number;
  sinceLogFlushes: number;
  sinceLogBytes: number;
}

class TerminalInstanceRegistry {
  private instances = new Map<string, TerminalInstanceRecord>();
  private static readonly PERF_LOG_INTERVAL_MS = 10_000;
  private static readonly PERF_LOW_FPS_THRESHOLD = 45;
  private static readonly FLUSH_BYTE_BUDGET = 4_096;
  private static readonly BACKPRESSURE_HIGH_WATERMARK = 64_000;
  private static readonly BACKPRESSURE_TIGHT_BUDGET = 2_048;

  acquire(id: string, factory: TerminalInstanceFactory): AcquireTerminalResult {
    const existing = this.instances.get(id);
    if (existing) {
      existing.attached = true;
      this.ensureStream(existing);
      logger.debug(`[Registry] Reusing existing terminal ${id}`);
      return { record: existing, isNew: false };
    }

    const created = factory();

    const record: TerminalInstanceRecord = {
      id,
      xterm: created,
      refCount: 1,
      lastSeq: null,
      initialized: false,
      attached: true,
      streamRegistered: false,
      perf: {
        firstFlushAt: null,
        lastLogAt: null,
        lastFlushAt: null,
        flushes: 0,
        bytes: 0,
        sinceLogFlushes: 0,
        sinceLogBytes: 0,
      },
    };

    this.instances.set(id, record);
    logger.debug(`[Registry] Created new terminal ${id}, refCount: 1`);
    this.ensureStream(record);
    return { record, isNew: true };
  }

  release(id: string): void {
    const record = this.instances.get(id);
    if (!record) {
      logger.debug(`[Registry] Release called for non-existent terminal ${id}`);
      return;
    }

    record.refCount -= 1;
    logger.debug(`[Registry] Released terminal ${id}, refCount: ${record.refCount}`);

    if (record.refCount <= 0) {
      record.attached = false;
      this.teardownStream(record);
      try {
        record.xterm.detach();
      } catch (error) {
        logger.debug(`[Registry] Error detaching terminal ${id} during release:`, error);
      }
      disposeGpuRenderer(id, 'registry-release');
      this.instances.delete(id);
      record.xterm.dispose();
      logger.debug(`[Registry] Disposed terminal ${id} (refCount reached 0)`);
    }
  }

  attach(id: string, container: HTMLElement): void {
    const record = this.instances.get(id);
    if (!record) {
      logger.debug(`[Registry] Attach called for non-existent terminal ${id}`);
      return;
    }

    record.xterm.attach(container);
    record.attached = true;
    logger.debug(`[Registry] Attached terminal ${id} to container`);
  }

  detach(id: string): void {
    const record = this.instances.get(id);
    if (!record) {
      logger.debug(`[Registry] Detach called for non-existent terminal ${id}`);
      return;
    }

    record.xterm.detach();
    record.attached = false;
    logger.debug(`[Registry] Detached terminal ${id} from DOM`);
  }

  updateLastSeq(id: string, seq: number | null): void {
    const record = this.instances.get(id);
    if (!record) return;
    record.lastSeq = seq;
  }

  getLastSeq(id: string): number | null {
    const record = this.instances.get(id);
    return record?.lastSeq ?? null;
  }

  markInitialized(id: string): void {
    const record = this.instances.get(id);
    if (!record) return;
    record.initialized = true;
    logger.debug(`[Registry] Marked terminal ${id} as initialized`);
  }

  isInitialized(id: string): boolean {
    const record = this.instances.get(id);
    return record?.initialized ?? false;
  }

  has(id: string): boolean {
    return this.instances.has(id);
  }

  clear(): void {
    for (const [id, record] of this.instances) {
      try {
        record.xterm.detach();
        record.xterm.dispose();
        logger.debug(`[Registry] Cleared terminal ${id}`);
      } catch (error) {
        logger.debug(`[Registry] Error disposing terminal ${id} during clear:`, error);
      }
      this.teardownStream(record);
      disposeGpuRenderer(id, 'registry-clear');
    }
    this.instances.clear();
  }

  releaseByPredicate(predicate: (id: string) => boolean): void {
    const idsToRelease: string[] = [];
    for (const id of this.instances.keys()) {
      if (predicate(id)) {
        idsToRelease.push(id);
      }
    }
    for (const id of idsToRelease) {
      this.release(id);
    }
  }

  forceRemove(id: string): void {
    const record = this.instances.get(id);
    if (record) {
      record.refCount = 0;
      this.release(id);
    }
  }

  private ensureStream(record: TerminalInstanceRecord): void {
    if (record.streamRegistered) {
      return;
    }

    record.pendingChunks = [];
    record.rafScheduled = false;

    const flushChunks = () => {
      record.rafScheduled = false;
      record.rafHandle = undefined;

      if (!record.pendingChunks || record.pendingChunks.length === 0) {
        return;
      }

      const combined = record.pendingChunks.join('');
      record.pendingChunks = [];

      const now = performance.now();

      // Soft-flow-control: only flush up to a byte budget per frame to avoid single
      // large bursts tanking perceived FPS for TUIs (e.g., OpenCode).
      const backlogBytes = combined.length + (record.pendingChunks?.reduce((acc, c) => acc + c.length, 0) ?? 0);
      const budget = backlogBytes > TerminalInstanceRegistry.BACKPRESSURE_HIGH_WATERMARK
        ? TerminalInstanceRegistry.BACKPRESSURE_TIGHT_BUDGET
        : TerminalInstanceRegistry.FLUSH_BYTE_BUDGET;
      const batch = combined.length > budget ? combined.slice(0, budget) : combined;
      const remainder = combined.length > budget ? combined.slice(budget) : '';

      if (remainder.length > 0) {
        record.pendingChunks.push(remainder);
        record.rafScheduled = true;
        record.rafHandle = requestAnimationFrame(flushChunks);
      }

      const pendingBytes = batch.length;

      try {
        record.xterm.raw.write(batch);
      } catch (error) {
        logger.debug(`[Registry] Failed to write batch for ${record.id}`, error);
      }

      // Lightweight per-frame throughput instrumentation (once every 10s or on low FPS)
      if (!record.perf) {
        record.perf = {
          firstFlushAt: now,
          lastLogAt: now,
          lastFlushAt: now,
          flushes: 0,
          bytes: 0,
          sinceLogFlushes: 0,
          sinceLogBytes: 0,
        };
      }

      const perf = record.perf;
      const gapMs = perf.lastFlushAt !== null ? now - perf.lastFlushAt : 0;

      // Reset the active window after long idle gaps so FPS reflects active bursts
      if (gapMs > 2_000) {
        perf.firstFlushAt = now;
        perf.flushes = 0;
        perf.bytes = 0;
        perf.sinceLogFlushes = 0;
        perf.sinceLogBytes = 0;
      }

      perf.lastFlushAt = now;
      perf.flushes += 1;
      perf.bytes += pendingBytes;
      perf.sinceLogFlushes += 1;
      perf.sinceLogBytes += pendingBytes;

      const elapsedMs = perf.firstFlushAt !== null ? now - perf.firstFlushAt : 0;
      const windowMs = perf.lastLogAt !== null ? now - perf.lastLogAt : Number.POSITIVE_INFINITY;

      if (elapsedMs >= 500 && windowMs >= TerminalInstanceRegistry.PERF_LOG_INTERVAL_MS && perf.sinceLogFlushes > 0) {
        const windowFps = perf.sinceLogFlushes / (windowMs / 1000);
        const windowKbPerSec = (perf.sinceLogBytes / 1024) / (windowMs / 1000);
        const avgChunk = perf.sinceLogBytes / perf.sinceLogFlushes;

        const logworthy = windowFps < TerminalInstanceRegistry.PERF_LOW_FPS_THRESHOLD || windowKbPerSec >= 4;

        if (logworthy) {
          logger.info('[Registry] Terminal stream perf', {
            id: record.id,
            windowFps: Number(windowFps.toFixed(1)),
            windowThroughputKBps: Number(windowKbPerSec.toFixed(1)),
            windowAvgChunk: Math.round(avgChunk),
            windowElapsedMs: Math.round(windowMs),
            flushes: perf.flushes,
            totalElapsedMs: Math.round(elapsedMs),
          });
        }

        perf.lastLogAt = now;
        perf.sinceLogFlushes = 0;
        perf.sinceLogBytes = 0;
      }
    };

    const listener = (chunk: string) => {
      if (!record.pendingChunks) {
        record.pendingChunks = [];
      }

      record.pendingChunks.push(chunk);

      if (!record.rafScheduled) {
        record.rafScheduled = true;
        record.rafHandle = requestAnimationFrame(flushChunks);
      }
    };

    record.streamListener = listener;
    terminalOutputManager.addListener(record.id, listener);
    record.streamRegistered = true;
    void terminalOutputManager.ensureStarted(record.id).catch(error => {
      logger.debug(`[Registry] ensureStarted failed for ${record.id}`, error);
    });
  }

  private teardownStream(record: TerminalInstanceRecord): void {
    if (!record.streamRegistered) {
      return;
    }

    if (record.rafHandle !== undefined) {
      try {
        cancelAnimationFrame(record.rafHandle);
      } catch (error) {
        logger.debug(`[Registry] Failed to cancel RAF for ${record.id}`, error);
      }
      record.rafHandle = undefined;
    }

    if (record.pendingChunks && record.pendingChunks.length > 0) {
      const combined = record.pendingChunks.join('');
      record.pendingChunks = [];
      try {
        record.xterm.raw.write(combined);
      } catch (error) {
        logger.debug(`[Registry] Failed to flush pending chunks for ${record.id}`, error);
      }
    }

    if (record.streamListener) {
      terminalOutputManager.removeListener(record.id, record.streamListener);
      record.streamListener = undefined;
    }

    record.streamRegistered = false;
    record.rafScheduled = false;
    record.pendingChunks = undefined;

    void terminalOutputManager.dispose(record.id).catch(error => {
      logger.debug(`[Registry] dispose stream failed for ${record.id}`, error);
    });
  }
}

const registry = new TerminalInstanceRegistry();

export function acquireTerminalInstance(id: string, factory: TerminalInstanceFactory): AcquireTerminalResult {
  return registry.acquire(id, factory);
}

export function releaseTerminalInstance(id: string): void {
  registry.release(id);
}

export function removeTerminalInstance(id: string): void {
  registry.forceRemove(id);
}

export function detachTerminalInstance(id: string): void {
  registry.detach(id);
}

export function releaseSessionTerminals(sessionName: string): void {
  const bases = sessionTerminalBaseVariants(sessionName);
  const runCandidateIds = new Set<string>();
  if (sessionName) {
    runCandidateIds.add(`run-terminal-${sessionName}`);
    const sanitized = sanitizeSessionName(sessionName);
    runCandidateIds.add(`run-terminal-${sanitized}`);
  }
  registry.releaseByPredicate(id => {
    for (const base of bases) {
      if (id === base || id.startsWith(`${base}-`)) {
        return true;
      }
    }
    if (runCandidateIds.has(id)) {
      return true;
    }
    return false;
  });
}

export function hasTerminalInstance(id: string): boolean {
  return registry.has(id);
}
