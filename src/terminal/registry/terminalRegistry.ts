import { logger } from '../../utils/logger';
import { XtermTerminal } from '../xterm/XtermTerminal';
import { disposeGpuRenderer } from '../gpu/gpuRendererRegistry';
import { sessionTerminalBaseVariants, sanitizeSessionName } from '../../common/terminalIdentity';
import { terminalOutputManager } from '../stream/terminalOutputManager';

const ESC = '\x1b';
const CLEAR_SCROLLBACK_SEQ = `${ESC}[3J`;
const BRACKETED_PASTE_ENABLE_SEQ = `${ESC}[?2004h`;
const BRACKETED_PASTE_DISABLE_SEQ = `${ESC}[?2004l`;
const CONTROL_SEQUENCE_TAIL_MAX = 32;

export interface TerminalInstanceRecord {
  id: string;
  xterm: XtermTerminal;
  refCount: number;
  lastSeq: number | null;
  initialized: boolean;
  attached: boolean;
  streamRegistered: boolean;
  bracketedPasteEnabled: boolean;
  controlSequenceTail: string;
  streamListener?: (chunk: string) => void;
  pendingChunks?: string[];
  rafScheduled?: boolean;
  rafHandle?: number;
  lastChunkTime?: number;
  outputCallbacks?: Set<() => void>;
  clearCallbacks?: Set<() => void>;
  hadClearInBatch?: boolean;
  // VS Code-style dual-timestamp tracking for write synchronization
  latestWriteId: number;
  latestParseId: number;
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
      bracketedPasteEnabled: false,
      controlSequenceTail: '',
      latestWriteId: 0,
      latestParseId: 0,
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

  isBracketedPasteEnabled(id: string): boolean {
    return this.instances.get(id)?.bracketedPasteEnabled ?? false;
  }

  /**
   * Check if all written data has been parsed by xterm.
   * VS Code pattern: latestWriteId === latestParseId means all data processed.
   */
  isFullyParsed(id: string): boolean {
    const record = this.instances.get(id);
    if (!record) return true;
    return record.latestWriteId === record.latestParseId;
  }

  /**
   * Check if terminal is actively streaming (has unparsed data).
   */
  isStreaming(id: string): boolean {
    const record = this.instances.get(id);
    if (!record) return false;
    return record.latestWriteId !== record.latestParseId;
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

  addClearCallback(id: string, callback: () => void): void {
    const record = this.instances.get(id);
    if (!record) return;
    if (!record.clearCallbacks) {
      record.clearCallbacks = new Set();
    }
    record.clearCallbacks.add(callback);
  }

  removeClearCallback(id: string, callback: () => void): void {
    const record = this.instances.get(id);
    if (!record?.clearCallbacks) return;
    record.clearCallbacks.delete(callback);
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

  private notifyClearCallbacks(record: TerminalInstanceRecord): void {
    if (!record.clearCallbacks) return;
    for (const cb of record.clearCallbacks) {
      try {
        cb();
      } catch (error) {
        logger.debug(`[Registry] Clear callback error for ${record.id}`, error);
      }
    }
  }

  private ensureStream(record: TerminalInstanceRecord): void {
    if (record.streamRegistered) {
      return;
    }

    record.pendingChunks = [];
    record.rafScheduled = false;
    record.hadClearInBatch = false;

    const flushChunks = () => {
      record.rafScheduled = false;
      record.rafHandle = undefined;

      if (!record.pendingChunks || record.pendingChunks.length === 0) {
        return;
      }

      const combined = record.pendingChunks.join('');
      record.pendingChunks = [];
      const hadClear = record.hadClearInBatch ?? false;
      record.hadClearInBatch = false;

      // VS Code-style dual-timestamp tracking: increment write ID before write,
      // update parse ID in callback when xterm finishes parsing.
      // This allows checking if all buffered data has been processed.
      const writeId = ++record.latestWriteId;

      try {
        record.xterm.raw.write(combined, () => {
          // Mark this write as fully parsed by xterm
          record.latestParseId = writeId;

          if (hadClear) {
            this.notifyClearCallbacks(record);
          }
          this.notifyOutputCallbacks(record);
        });
      } catch (error) {
        logger.debug(`[Registry] Failed to write batch for ${record.id}`, error);
      }
    };

    const listener = (chunk: string) => {
      if (!record.pendingChunks) {
        record.pendingChunks = [];
      }

      // The backend stream can split control sequences across chunks (e.g. "\x1b[?20" + "04h").
      // Keep a short tail so we can still detect bracketed paste mode transitions reliably.
      const combinedControl = `${record.controlSequenceTail}${chunk}`;
      const enableIdx = combinedControl.lastIndexOf(BRACKETED_PASTE_ENABLE_SEQ);
      const disableIdx = combinedControl.lastIndexOf(BRACKETED_PASTE_DISABLE_SEQ);
      if (enableIdx !== -1 || disableIdx !== -1) {
        // We care about the most recent toggle in the combined window; whichever sequence appears
        // last wins (enable after disable => enabled, disable after enable => disabled).
        record.bracketedPasteEnabled = enableIdx > disableIdx;
      }
      record.controlSequenceTail = combinedControl.slice(
        Math.max(0, combinedControl.length - CONTROL_SEQUENCE_TAIL_MAX),
      );

      // Handle clear scrollback sequence (\x1b[3J).
      // For TUI terminals (Kilocode/Ink, Claude Code), this sequence causes viewport jumps because
      // xterm.js resets baseY/viewportY when clearing scrollback. TUI apps don't need scrollback
      // so we strip it out entirely. For standard terminals, we keep existing behavior.
      let processedChunk = chunk;
      if (chunk.includes(CLEAR_SCROLLBACK_SEQ)) {
        if (record.xterm.isTuiMode()) {
          processedChunk = chunk.split(CLEAR_SCROLLBACK_SEQ).join('');
          logger.debug(`[Registry ${record.id}] Stripped CLEAR_SCROLLBACK_SEQ for TUI terminal`);
        } else {
          logger.debug(`[Registry ${record.id}] CLEAR_SCROLLBACK_SEQ detected`);
          record.pendingChunks = [];
          record.hadClearInBatch = true;
        }
      }

      if (processedChunk.length > 0) {
        record.pendingChunks.push(processedChunk);
      }

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
    record.hadClearInBatch = false;
    record.clearCallbacks = undefined;

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

export function isTerminalBracketedPasteEnabled(id: string): boolean {
  return registry.isBracketedPasteEnabled(id);
}

export function addTerminalOutputCallback(id: string, callback: () => void): void {
  registry.addOutputCallback(id, callback);
}

export function removeTerminalOutputCallback(id: string, callback: () => void): void {
  registry.removeOutputCallback(id, callback);
}
