import { logger } from '../../utils/logger';

type DisposableRenderer = { dispose?: () => void };

const gpuRenderers = new Map<string, DisposableRenderer>();

export function disposeGpuRenderer(id: string, reason: string): void {
  const renderer = gpuRenderers.get(id);
  if (!renderer) {
    return;
  }
  try {
    renderer.dispose?.();
  } catch (error) {
    logger.debug(`[GPU] Failed to dispose renderer for ${id} (${reason})`, error);
  } finally {
    gpuRenderers.delete(id);
  }
}
