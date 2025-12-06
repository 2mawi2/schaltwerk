import { logger } from '../../utils/logger';
import { XtermTerminal } from '../xterm/XtermTerminal';
import { disposeGpuRenderer } from '../gpu/gpuRendererRegistry';
import { sessionTerminalBaseVariants, sanitizeSessionName } from '../../common/terminalIdentity';
import { terminalOutputManager } from '../stream/terminalOutputManager';

const ESC = '\x1b';
const CLEAR_SCROLLBACK_SEQ = `${ESC}[3J`;

function filterScrollbackClear(output: string): string {
  if (!output.includes(CLEAR_SCROLLBACK_SEQ)) return output;
  return output.split(CLEAR_SCROLLBACK_SEQ).join('');
}

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
  lastChunkTime?: number;
  outputCallbacks?: Set<() => void>;
}

export interface AcquireTerminalResult {
  record: TerminalInstanceRecord;
  isNew: boolean;
}

type TerminalInstanceFactory = () => XtermTerminal;

class TerminalInstanceRegistry {
  private instances = new Map<string, TerminalInstanceRecord>();

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

  addOutputCallback(id: string, callback: () => void): void {
    const record = this.instances.get(id);
    if (!record) return;
    if (!record.outputCallbacks) {
      record.outputCallbacks = new Set();
    }
    record.outputCallbacks.add(callback);
  }

  removeOutputCallback(id: string, callback: () => void): void {
    const record = this.instances.get(id);
    if (!record?.outputCallbacks) return;
    record.outputCallbacks.delete(callback);
  }

  private notifyOutputCallbacks(record: TerminalInstanceRecord): void {
    if (!record.outputCallbacks) return;
    for (const cb of record.outputCallbacks) {
      try {
        cb();
      } catch (error) {
        logger.debug(`[Registry] Output callback error for ${record.id}`, error);
      }
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

      this.notifyOutputCallbacks(record);

      try {
        record.xterm.raw.write(combined);
      } catch (error) {
        logger.debug(`[Registry] Failed to write batch for ${record.id}`, error);
      }
    };

    const listener = (chunk: string) => {
      if (!record.pendingChunks) {
        record.pendingChunks = [];
      }

      const filtered = filterScrollbackClear(chunk);
      if (!filtered) return;

      record.pendingChunks.push(filtered);

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
    record.lastChunkTime = undefined;

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

export function addTerminalOutputCallback(id: string, callback: () => void): void {
  registry.addOutputCallback(id, callback);
}

export function removeTerminalOutputCallback(id: string, callback: () => void): void {
  registry.removeOutputCallback(id, callback);
}
