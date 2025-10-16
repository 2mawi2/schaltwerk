import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebGLTerminalRenderer } from '../gpu/webglRenderer';
import { logger } from '../../utils/logger';

export interface TerminalInstanceRecord {
  id: string;
  terminal: XTerm;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  wrapper: HTMLDivElement;
  gpuRenderer?: WebGLTerminalRenderer;
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
    return { record, isNew: true };
  }

  attach(id: string, container: HTMLElement): void {
    const record = this.instances.get(id);
    if (!record) return;
    if (!record.wrapper.isConnected) {
      container.appendChild(record.wrapper);
    } else if (record.wrapper.parentElement !== container) {
      record.wrapper.remove();
      container.appendChild(record.wrapper);
    }
  }

  detach(id: string): void {
    const record = this.instances.get(id);
    if (!record) return;
    if (record.wrapper.parentElement) {
      record.wrapper.parentElement.removeChild(record.wrapper);
    }
  }

  updateLastSeq(id: string, seq: number | null): void {
    const record = this.instances.get(id);
    if (!record) return;
    record.lastSeq = seq;
  }

  getLastSeq(id: string): number | null {
    return this.instances.get(id)?.lastSeq ?? null;
  }

  markInitialized(id: string): void {
    const record = this.instances.get(id);
    if (!record) return;
    record.initialized = true;
  }

  release(id: string): void {
    const record = this.instances.get(id);
    if (!record) return;
    record.refCount = Math.max(0, record.refCount - 1);
    if (record.refCount > 0) {
      return;
    }

    try {
      record.terminal.dispose();
    } catch (error) {
      logger.warn('[terminalRegistry] terminal dispose failed', error);
    }
    try {
      record.fitAddon.dispose?.();
    } catch (error) {
      logger.warn('[terminalRegistry] fit addon dispose failed', error);
    }
    try {
      record.searchAddon.dispose?.();
    } catch (error) {
      logger.warn('[terminalRegistry] search addon dispose failed', error);
    }
    if (record.gpuRenderer) {
      try {
        record.gpuRenderer.dispose();
      } catch (error) {
        logger.warn('[terminalRegistry] gpu renderer dispose failed during release', error);
      } finally {
        record.gpuRenderer = undefined;
      }
    }
    this.detach(id);
    this.instances.delete(id);
  }

}

const registry = new TerminalInstanceRegistry();

export function acquireTerminalInstance(
  id: string,
  factory: TerminalInstanceFactory,
): AcquireTerminalResult {
  return registry.acquire(id, factory);
}

export function attachTerminalInstance(
  id: string,
  container: HTMLElement,
): void {
  registry.attach(id, container);
}

export function detachTerminalInstance(id: string): void {
  registry.detach(id);
}

export function updateTerminalInstanceLastSeq(
  id: string,
  seq: number | null,
): void {
  registry.updateLastSeq(id, seq);
}

export function getTerminalInstanceLastSeq(id: string): number | null {
  return registry.getLastSeq(id);
}

export function markTerminalInstanceInitialized(id: string): void {
  registry.markInitialized(id);
}

export function releaseTerminalInstance(id: string): void {
  registry.release(id);
}

export function ensureGpuRenderer(
  record: TerminalInstanceRecord,
  terminalId: string,
  onContextLoss: () => void,
): WebGLTerminalRenderer {
  if (!record.gpuRenderer) {
    record.gpuRenderer = new WebGLTerminalRenderer(record.terminal, terminalId);
    record.gpuRenderer.onContextLost(onContextLoss);
  }
  return record.gpuRenderer;
}

export function disposeRecordGpuRenderer(
  record: TerminalInstanceRecord,
  reason: string,
): void {
  if (!record.gpuRenderer) {
    return;
  }
  try {
    record.gpuRenderer.dispose();
  } catch (error) {
    logger.warn(`[terminalRegistry] gpu renderer dispose failed (${reason})`, error);
  } finally {
    record.gpuRenderer = undefined;
  }
}
