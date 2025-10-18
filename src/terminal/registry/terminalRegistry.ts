import { logger } from '../../utils/logger';
import { XtermTerminal } from '../xterm/XtermTerminal';
import { disposeGpuRenderer } from '../gpu/gpuRendererRegistry';
import { sessionTerminalGroup } from '../../common/terminalIdentity';
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

  private ensureStream(record: TerminalInstanceRecord): void {
    if (record.streamRegistered) {
      return;
    }
    const listener = (chunk: string) => {
      try {
        record.xterm.raw.write(chunk);
      } catch (error) {
        logger.debug(`[Registry] Failed to write chunk for ${record.id}`, error);
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
    if (record.streamListener) {
      terminalOutputManager.removeListener(record.id, record.streamListener);
      record.streamListener = undefined;
    }
    record.streamRegistered = false;
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

export function attachTerminalInstance(id: string, container: HTMLElement): void {
  registry.attach(id, container);
}

export function detachTerminalInstance(id: string): void {
  registry.detach(id);
}

export function updateTerminalInstanceLastSeq(id: string, seq: number | null): void {
  registry.updateLastSeq(id, seq);
}

export function getTerminalInstanceLastSeq(id: string): number | null {
  return registry.getLastSeq(id);
}

export function markTerminalInstanceInitialized(id: string): void {
  registry.markInitialized(id);
}

export function isTerminalInstanceInitialized(id: string): boolean {
  return registry.isInitialized(id);
}

export function hasTerminalInstance(id: string): boolean {
  return registry.has(id);
}

export function clearTerminalRegistry(): void {
  registry.clear();
}

export function releaseTerminalFamilyByPrefix(prefix: string): void {
  registry.releaseByPredicate((id) => id === prefix || id.startsWith(`${prefix}-`));
}

export function releaseSessionTerminals(sessionName: string): void {
  const group = sessionTerminalGroup(sessionName);
  registry.releaseByPredicate((id) => id === group.base || id.startsWith(`${group.base}-`));
}
