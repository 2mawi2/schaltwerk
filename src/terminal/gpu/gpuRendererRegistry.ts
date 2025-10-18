import { WebGLTerminalRenderer } from './webglRenderer';
import { logger } from '../../utils/logger';

const gpuRenderers = new Map<string, WebGLTerminalRenderer>();

export function getGpuRenderer(id: string): WebGLTerminalRenderer | undefined {
  return gpuRenderers.get(id);
}

export function setGpuRenderer(id: string, renderer: WebGLTerminalRenderer): void {
  gpuRenderers.set(id, renderer);
}

export function disposeGpuRenderer(id: string, reason: string): void {
  const renderer = gpuRenderers.get(id);
  if (!renderer) {
    return;
  }
  try {
    renderer.dispose();
  } catch (error) {
    logger.debug(`[GPU] Failed to dispose renderer for ${id} (${reason})`, error);
  } finally {
    gpuRenderers.delete(id);
  }
}

export function clearGpuRendererRegistry(): void {
  for (const [id, renderer] of gpuRenderers) {
    try {
      renderer.dispose();
    } catch (error) {
      logger.debug(`[GPU] Failed to dispose renderer during clear (${id})`, error);
    }
  }
  gpuRenderers.clear();
}
