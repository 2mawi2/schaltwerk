import { useCallback, useMemo, useRef, type MutableRefObject } from 'react';
import type { Terminal, FitAddon } from 'ghostty-web';

/**
 * ghostty-web renders via CanvasRenderer and does not currently expose a WebGL
 * renderer addon compatible with Schaltwerk's previous xterm.js WebGL pipeline.
 *
 * Keep the hook API stable so the rest of the terminal UI can remain unchanged,
 * but treat GPU acceleration as unavailable for now.
 */

interface UseTerminalGpuParams {
  terminalId: string;
  terminalRef: MutableRefObject<Terminal | null>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  applySizeUpdate: (cols: number, rows: number, reason: string, force?: boolean) => boolean;
}

interface UseTerminalGpuResult {
  gpuRenderer: MutableRefObject<null>;
  gpuEnabledForTerminal: boolean;
  refreshGpuFontRendering: () => void;
  applyLetterSpacing: (useRelaxedSpacing: boolean) => void;
  cancelGpuRefreshWork: () => void;
  ensureRenderer: () => Promise<void>;
  handleFontPreferenceChange: () => Promise<void>;
  webglRendererActive: boolean;
}

export function useTerminalGpu(_params: UseTerminalGpuParams): UseTerminalGpuResult {
  const gpuRenderer = useRef<null>(null);

  const refreshGpuFontRendering = useCallback(() => {}, []);
  const applyLetterSpacing = useCallback((_useRelaxedSpacing: boolean) => {}, []);
  const cancelGpuRefreshWork = useCallback(() => {}, []);
  const ensureRenderer = useCallback(async () => {}, []);
  const handleFontPreferenceChange = useCallback(async () => {}, []);

  const gpuEnabledForTerminal = useMemo(() => false, []);

  return {
    gpuRenderer,
    gpuEnabledForTerminal,
    refreshGpuFontRendering,
    applyLetterSpacing,
    cancelGpuRefreshWork,
    ensureRenderer,
    handleFontPreferenceChange,
    webglRendererActive: false,
  };
}
