import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { logger } from '../../utils/logger';

export interface TerminalInstanceRecord {
  id: string;
  terminal: XTerm;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  wrapper: HTMLDivElement;
  refCount: number;
  lastSeq: number | null;
  initialized: boolean;
}

export interface AcquireTerminalResult {
  record: TerminalInstanceRecord;
  isNew: boolean;
}

type TerminalInstanceFactory = () => {
  terminal: XTerm;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  wrapper: HTMLDivElement;
};

class TerminalInstanceRegistry {
  private instances = new Map<string, TerminalInstanceRecord>();

  acquire(id: string, factory: TerminalInstanceFactory): AcquireTerminalResult {
    const existing = this.instances.get(id);
    if (existing) {
      existing.refCount += 1;
      logger.debug(`[Registry] Acquired existing terminal ${id}, refCount: ${existing.refCount}`);
      return { record: existing, isNew: false };
    }

    const created = factory();
    created.wrapper.style.width = '100%';
    created.wrapper.style.height = '100%';
    created.wrapper.style.display = 'flex';
    created.wrapper.style.flexDirection = 'column';
    created.wrapper.style.flex = '1 1 auto';
    created.wrapper.style.alignItems = 'stretch';
    created.wrapper.style.justifyContent = 'stretch';
    created.wrapper.style.overflow = 'hidden';

    const record: TerminalInstanceRecord = {
      id,
      terminal: created.terminal,
      fitAddon: created.fitAddon,
      searchAddon: created.searchAddon,
      wrapper: created.wrapper,
      refCount: 1,
      lastSeq: null,
      initialized: false,
    };

    this.instances.set(id, record);
    logger.debug(`[Registry] Created new terminal ${id}, refCount: 1`);
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
      this.instances.delete(id);
      record.terminal.dispose();
      logger.debug(`[Registry] Disposed terminal ${id} (refCount reached 0)`);
    }
  }

  attach(id: string, container: HTMLElement): void {
    const record = this.instances.get(id);
    if (!record) {
      logger.debug(`[Registry] Attach called for non-existent terminal ${id}`);
      return;
    }

    if (!record.wrapper.isConnected) {
      container.appendChild(record.wrapper);
      logger.debug(`[Registry] Attached terminal ${id} to container`);
    } else if (record.wrapper.parentElement !== container) {
      record.wrapper.remove();
      container.appendChild(record.wrapper);
      logger.debug(`[Registry] Moved terminal ${id} to new container`);
    }
  }

  detach(id: string): void {
    const record = this.instances.get(id);
    if (!record) {
      logger.debug(`[Registry] Detach called for non-existent terminal ${id}`);
      return;
    }

    if (record.wrapper.parentElement) {
      record.wrapper.parentElement.removeChild(record.wrapper);
      logger.debug(`[Registry] Detached terminal ${id} from DOM`);
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

  clear(): void {
    for (const [id, record] of this.instances) {
      try {
        record.terminal.dispose();
        logger.debug(`[Registry] Cleared terminal ${id}`);
      } catch (error) {
        logger.debug(`[Registry] Error disposing terminal ${id} during clear:`, error);
      }
    }
    this.instances.clear();
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
