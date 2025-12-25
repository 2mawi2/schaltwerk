import { logger } from '../../utils/logger';
import { XtermTerminal } from '../xterm/XtermTerminal';
import { disposeGpuRenderer } from '../gpu/gpuRendererRegistry';
import { sessionTerminalBaseVariants, sanitizeSessionName } from '../../common/terminalIdentity';
import { terminalOutputManager } from '../stream/terminalOutputManager';

const ESC = '\x1b';
const CLEAR_SCROLLBACK_SEQ = `${ESC}[3J`;
const BRACKETED_PASTE_ENABLE_SEQ = `${ESC}[?2004h`;
const BRACKETED_PASTE_DISABLE_SEQ = `${ESC}[?2004l`;
const SYNC_OUTPUT_ENABLE_SEQ = `${ESC}[?2026h`;
const SYNC_OUTPUT_DISABLE_SEQ = `${ESC}[?2026l`;
const ALT_SCREEN_ENABLE_1049 = `${ESC}[?1049h`;
const ALT_SCREEN_DISABLE_1049 = `${ESC}[?1049l`;
const ALT_SCREEN_ENABLE_47 = `${ESC}[?47h`;
const ALT_SCREEN_DISABLE_47 = `${ESC}[?47l`;
const ALT_SCREEN_ENABLE_1047 = `${ESC}[?1047h`;
const ALT_SCREEN_DISABLE_1047 = `${ESC}[?1047l`;
const CONTROL_SEQUENCE_TAIL_MAX = 32;
const MAX_PENDING_CHARS_WHILE_DETACHED = 512 * 1024;

function stripAnsiSequences(text: string): string {
  // Minimal ANSI strip to detect "boundary-only" chunks without using control-character regexes.
  let output = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code !== 0x1b) {
      output += text[i];
      continue;
    }

    const next = text.charCodeAt(i + 1);
    // CSI
    if (next === 0x5b) {
      i += 2;
      while (i < text.length) {
        const c = text.charCodeAt(i);
        // final byte
        if (c >= 0x40 && c <= 0x7e) {
          break;
        }
        i += 1;
      }
      continue;
    }
    // OSC
    if (next === 0x5d) {
      i += 2;
      while (i < text.length) {
        const c = text.charCodeAt(i);
        // BEL
        if (c === 0x07) {
          break;
        }
        // ESC \
        if (c === 0x1b && text.charCodeAt(i + 1) === 0x5c) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Other single-character escape sequences (e.g. ESC c)
    i += 1;
  }
  return output.trim();
}

function isLikelyRedrawBoundaryOnlyChunk(text: string): boolean {
  return stripAnsiSequences(text).length === 0;
}

function containsCupSequence(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) !== 0x1b || text.charCodeAt(i + 1) !== 0x5b) {
      continue;
    }

    i += 2;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c >= 0x40 && c <= 0x7e) {
        return text[i] === 'H';
      }
      i += 1;
    }
  }
  return false;
}

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
  pendingByteLength: number;
  tuiHoldRedraw?: boolean;
  flushAfterParse?: boolean;
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
      const buffer = existing.xterm.raw.buffer?.active;
      logger.debug(`[Registry] Reusing existing terminal ${id}: isTUI=${existing.xterm.isTuiMode()}, attached=${existing.attached}, baseY=${buffer?.baseY}, viewportY=${buffer?.viewportY}`);
      // Don't set attached=true here - wait for actual attach() call.
      // This ensures TUI terminals skip accumulating content until truly attached.
      this.ensureStream(existing);
      return { record: existing, isNew: false };
    }

    const created = factory();

    const record: TerminalInstanceRecord = {
      id,
      xterm: created,
      refCount: 1,
      lastSeq: null,
      initialized: false,
      attached: false,
      streamRegistered: false,
      bracketedPasteEnabled: false,
      controlSequenceTail: '',
      pendingByteLength: 0,
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

    const bufBefore = record.xterm.raw.buffer?.active;
    logger.debug(`[Registry] Attaching terminal ${id}: isTUI=${record.xterm.isTuiMode()}, wasAttached=${record.attached}, pendingChunks=${record.pendingChunks?.length ?? 0}, baseY=${bufBefore?.baseY}, viewportY=${bufBefore?.viewportY}`);

    record.xterm.attach(container);
    record.attached = true;
    this.scheduleFlush(record, 'attach');

    const bufAfter = record.xterm.raw.buffer?.active;
    logger.debug(`[Registry] Attached terminal ${id}: baseY=${bufAfter?.baseY}, viewportY=${bufAfter?.viewportY}`);
  }

  detach(id: string): void {
    const record = this.instances.get(id);
    if (!record) {
      logger.debug(`[Registry] Detach called for non-existent terminal ${id}`);
      return;
    }

    const buffer = record.xterm.raw.buffer?.active;
    logger.debug(`[Registry] Detaching terminal ${id}: isTUI=${record.xterm.isTuiMode()}, baseY=${buffer?.baseY}, viewportY=${buffer?.viewportY}`);

    record.xterm.detach();
    record.attached = false;

    if (record.rafHandle !== undefined) {
      try {
        cancelAnimationFrame(record.rafHandle);
      } catch (error) {
        logger.debug(`[Registry] Failed to cancel RAF for ${record.id} during detach`, error);
      }
      record.rafHandle = undefined;
      record.rafScheduled = false;
    }
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

  selectAll(id: string): boolean {
    const record = this.instances.get(id);
    if (!record) {
      logger.debug(`[Registry] selectAll called for non-existent terminal ${id}`);
      return false;
    }

    try {
      record.xterm.raw.selectAll();
      return true;
    } catch (error) {
      logger.debug(`[Registry] Failed to select all for terminal ${id}`, error);
      return false;
    }
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

  private scheduleFlush(record: TerminalInstanceRecord, reason: string): void {
    if (!record.attached && record.xterm.isTuiMode()) {
      return;
    }
    if (record.rafScheduled) {
      return;
    }
    if (!record.pendingChunks || record.pendingChunks.length === 0) {
      return;
    }

    record.rafScheduled = true;
    record.rafHandle = requestAnimationFrame(() => {
      this.flushChunks(record, reason);
    });
  }

  private flushChunks(record: TerminalInstanceRecord, _reason: string): void {
    record.rafScheduled = false;
    record.rafHandle = undefined;

    if (!record.attached && record.xterm.isTuiMode()) {
      return;
    }

    if (!record.pendingChunks || record.pendingChunks.length === 0) {
      return;
    }

    if (record.xterm.isTuiMode()) {
      if (record.tuiHoldRedraw) {
        return;
      }
      const parsingInFlight = record.latestWriteId !== record.latestParseId;
      if (parsingInFlight) {
        record.flushAfterParse = true;
        return;
      }
    }

    const combined = record.pendingChunks.join('');
    record.pendingChunks = [];
    record.pendingByteLength = 0;
    const hadClear = record.hadClearInBatch ?? false;
    record.hadClearInBatch = false;

    const hasFullScreenRedrawControl =
      record.xterm.isTuiMode()
      && (
        combined.includes('\x1b[2J')
        || containsCupSequence(combined)
        || combined.includes(ALT_SCREEN_ENABLE_1049)
        || combined.includes(ALT_SCREEN_DISABLE_1049)
        || combined.includes(ALT_SCREEN_ENABLE_47)
        || combined.includes(ALT_SCREEN_DISABLE_47)
        || combined.includes(ALT_SCREEN_ENABLE_1047)
        || combined.includes(ALT_SCREEN_DISABLE_1047)
      );

    const shouldUseSynchronizedOutput =
      hasFullScreenRedrawControl
      && !combined.includes(SYNC_OUTPUT_ENABLE_SEQ)
      && !combined.includes(SYNC_OUTPUT_DISABLE_SEQ);

    const payload = shouldUseSynchronizedOutput
      ? `${SYNC_OUTPUT_ENABLE_SEQ}${combined}${SYNC_OUTPUT_DISABLE_SEQ}`
      : combined;

    // VS Code-style dual-timestamp tracking: increment write ID before write,
    // update parse ID in callback when xterm finishes parsing.
    // This allows checking if all buffered data has been processed.
    const writeId = ++record.latestWriteId;

    const bufBefore = record.xterm.raw.buffer?.active;
    const baseYBefore = bufBefore?.baseY;
    const viewportYBefore = bufBefore?.viewportY;

    try {
      const rawWithWriteSync = record.xterm.raw as unknown as { writeSync?: (data: string) => void };
      if (record.xterm.isTuiMode() && hasFullScreenRedrawControl && typeof rawWithWriteSync.writeSync === 'function') {
        if (typeof window !== 'undefined' && localStorage.getItem('TERMINAL_DEBUG') === '1') {
          logger.debug(`[Registry ${record.id}] Using writeSync for full-frame TUI batch (chars=${payload.length})`);
        }
        rawWithWriteSync.writeSync(payload);
        record.latestParseId = writeId;

        const bufAfter = record.xterm.raw.buffer?.active;
        if (bufAfter && (bufAfter.baseY !== baseYBefore || bufAfter.viewportY !== viewportYBefore)) {
          logger.debug(`[Registry ${record.id}] Viewport changed after write: baseY ${baseYBefore}→${bufAfter.baseY}, viewportY ${viewportYBefore}→${bufAfter.viewportY}`);
        }

        if (hadClear) {
          this.notifyClearCallbacks(record);
        }
        this.notifyOutputCallbacks(record);

        if (record.flushAfterParse && record.pendingChunks && record.pendingChunks.length > 0 && !record.tuiHoldRedraw) {
          record.flushAfterParse = false;
          this.scheduleFlush(record, 'after-parse');
        }
        return;
      }

      record.xterm.raw.write(payload, () => {
        // Mark this write as fully parsed by xterm
        record.latestParseId = writeId;

        const bufAfter = record.xterm.raw.buffer?.active;
        if (bufAfter && (bufAfter.baseY !== baseYBefore || bufAfter.viewportY !== viewportYBefore)) {
          logger.debug(`[Registry ${record.id}] Viewport changed after write: baseY ${baseYBefore}→${bufAfter.baseY}, viewportY ${viewportYBefore}→${bufAfter.viewportY}`);
        }

        if (hadClear) {
          this.notifyClearCallbacks(record);
        }
        this.notifyOutputCallbacks(record);

        if (record.flushAfterParse && record.pendingChunks && record.pendingChunks.length > 0 && !record.tuiHoldRedraw) {
          record.flushAfterParse = false;
          this.scheduleFlush(record, 'after-parse');
        }
      });
    } catch (error) {
      record.flushAfterParse = false;
      logger.debug(`[Registry] Failed to write batch for ${record.id}`, error);
    }
  }

  private ensureStream(record: TerminalInstanceRecord): void {
    if (record.streamRegistered) {
      return;
    }

    record.pendingChunks = [];
    record.rafScheduled = false;
    record.hadClearInBatch = false;
    record.pendingByteLength = 0;
    record.tuiHoldRedraw = false;
    record.flushAfterParse = false;

    const listener = (chunk: string) => {
      if (!record.pendingChunks) {
        record.pendingChunks = [];
        record.pendingByteLength = 0;
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

      const syncEnableIdx = combinedControl.lastIndexOf(SYNC_OUTPUT_ENABLE_SEQ);
      const syncDisableIdx = combinedControl.lastIndexOf(SYNC_OUTPUT_DISABLE_SEQ);
      if (syncEnableIdx !== -1 || syncDisableIdx !== -1) {
        logger.debug(
          `[Registry ${record.id}] Synchronized output mode toggle detected: enableIdx=${syncEnableIdx}, disableIdx=${syncDisableIdx}`,
        );
      }

      const alt1049EnableIdx = combinedControl.lastIndexOf(ALT_SCREEN_ENABLE_1049);
      const alt1049DisableIdx = combinedControl.lastIndexOf(ALT_SCREEN_DISABLE_1049);
      const alt47EnableIdx = combinedControl.lastIndexOf(ALT_SCREEN_ENABLE_47);
      const alt47DisableIdx = combinedControl.lastIndexOf(ALT_SCREEN_DISABLE_47);
      const alt1047EnableIdx = combinedControl.lastIndexOf(ALT_SCREEN_ENABLE_1047);
      const alt1047DisableIdx = combinedControl.lastIndexOf(ALT_SCREEN_DISABLE_1047);
      if (
        alt1049EnableIdx !== -1 ||
        alt1049DisableIdx !== -1 ||
        alt47EnableIdx !== -1 ||
        alt47DisableIdx !== -1 ||
        alt1047EnableIdx !== -1 ||
        alt1047DisableIdx !== -1
      ) {
        logger.debug(
          `[Registry ${record.id}] Alternate screen toggle detected: 1049(e=${alt1049EnableIdx},d=${alt1049DisableIdx}) 47(e=${alt47EnableIdx},d=${alt47DisableIdx}) 1047(e=${alt1047EnableIdx},d=${alt1047DisableIdx})`,
        );
      }
      record.controlSequenceTail = combinedControl.slice(
        Math.max(0, combinedControl.length - CONTROL_SEQUENCE_TAIL_MAX),
      );

      // Handle clear scrollback sequence (\x1b[3J).
      // For TUI terminals (Kilocode/Ink, Claude Code), this sequence causes viewport jumps because
      // xterm.js resets baseY/viewportY when clearing scrollback. TUI apps don't need scrollback
      // so we strip it out entirely. For standard terminals, we keep existing behavior.
      let processedChunk = chunk;
      const has3J = chunk.includes(CLEAR_SCROLLBACK_SEQ);
      const has2J = chunk.includes('\x1b[2J');
      const hasH = containsCupSequence(chunk);

      if (has3J || has2J || hasH) {
        const buffer = record.xterm.raw.buffer?.active;
        logger.debug(`[Registry ${record.id}] Control sequences: 3J=${has3J}, 2J=${has2J}, H=${hasH}, isTUI=${record.xterm.isTuiMode()}, baseY=${buffer?.baseY}, viewportY=${buffer?.viewportY}`);
      }

      if (has3J) {
        if (record.xterm.isTuiMode()) {
          processedChunk = chunk.split(CLEAR_SCROLLBACK_SEQ).join('');
          logger.debug(`[Registry ${record.id}] Stripped CLEAR_SCROLLBACK_SEQ for TUI terminal`);
        } else {
          logger.debug(`[Registry ${record.id}] CLEAR_SCROLLBACK_SEQ detected - clearing pending chunks`);
          record.pendingChunks = [];
          record.pendingByteLength = 0;
          record.hadClearInBatch = true;
        }
      }

      const isTui = record.xterm.isTuiMode();
      const hasAltScreenToggle =
        chunk.includes(ALT_SCREEN_ENABLE_1049)
        || chunk.includes(ALT_SCREEN_DISABLE_1049)
        || chunk.includes(ALT_SCREEN_ENABLE_47)
        || chunk.includes(ALT_SCREEN_DISABLE_47)
        || chunk.includes(ALT_SCREEN_ENABLE_1047)
        || chunk.includes(ALT_SCREEN_DISABLE_1047);
      const hasRedrawBoundary = has2J || hasH || hasAltScreenToggle;
      const boundaryOnly = isTui && hasRedrawBoundary && isLikelyRedrawBoundaryOnlyChunk(processedChunk);

      if (processedChunk.length > 0) {
        record.pendingChunks.push(processedChunk);
        record.pendingByteLength += processedChunk.length;

        if (!record.attached && record.pendingByteLength > MAX_PENDING_CHARS_WHILE_DETACHED) {
          while (record.pendingChunks.length > 1 && record.pendingByteLength > MAX_PENDING_CHARS_WHILE_DETACHED) {
            const dropped = record.pendingChunks.shift();
            if (!dropped) break;
            record.pendingByteLength -= dropped.length;
          }

          if (record.pendingByteLength > MAX_PENDING_CHARS_WHILE_DETACHED && record.pendingChunks.length === 1) {
            const kept = record.pendingChunks[0];
            const sliceStart = Math.max(0, kept.length - MAX_PENDING_CHARS_WHILE_DETACHED);
            record.pendingChunks[0] = kept.slice(sliceStart);
            record.pendingByteLength = record.pendingChunks[0].length;
          }
        }
      }

      if (isTui) {
        if (boundaryOnly) {
          record.tuiHoldRedraw = true;
          return;
        }

        if (record.tuiHoldRedraw) {
          record.tuiHoldRedraw = false;
        }

        const parsingInFlight = record.latestWriteId !== record.latestParseId;
        if (parsingInFlight) {
          record.flushAfterParse = true;
          return;
        }
      }

      this.scheduleFlush(record, 'stream');
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
      record.pendingByteLength = 0;
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
    record.pendingByteLength = 0;
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

export function attachTerminalInstance(id: string, container: HTMLElement): void {
  registry.attach(id, container);
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

export function selectAllTerminal(id: string): boolean {
  return registry.selectAll(id);
}

export function addTerminalOutputCallback(id: string, callback: () => void): void {
  registry.addOutputCallback(id, callback);
}

export function removeTerminalOutputCallback(id: string, callback: () => void): void {
  registry.removeOutputCallback(id, callback);
}
