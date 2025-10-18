import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';

import { UiEvent, listenUiEvent } from '../common/uiEvents';
import { TauriCommands } from '../common/tauriCommands';
import { WebGLTerminalRenderer } from '../terminal/gpu/webglRenderer';
import {
  getGpuRenderer,
  setGpuRenderer,
  disposeGpuRenderer as disposeRegisteredGpuRenderer,
} from '../terminal/gpu/gpuRendererRegistry';
import { applyTerminalLetterSpacing } from '../utils/terminalLetterSpacing';
import { logger } from '../utils/logger';

interface UseTerminalGpuParams {
  terminalId: string;
  terminalRef: MutableRefObject<XTerm | null>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  isBackground: boolean;
  applySizeUpdate: (cols: number, rows: number, reason: string, force?: boolean) => boolean;
}

interface UseTerminalGpuResult {
  gpuRenderer: MutableRefObject<WebGLTerminalRenderer | null>;
  gpuEnabledForTerminal: boolean;
  refreshGpuFontRendering: () => void;
  applyLetterSpacing: (useRelaxedSpacing: boolean) => void;
  cancelGpuRefreshWork: () => void;
  ensureRenderer: () => Promise<void>;
}

export function useTerminalGpu({
  terminalId,
  terminalRef,
  fitAddonRef,
  isBackground,
  applySizeUpdate,
}: UseTerminalGpuParams): UseTerminalGpuResult {
  const gpuRenderer = useRef<WebGLTerminalRenderer | null>(null);
  const gpuRefreshState = useRef<{ refreshing: boolean; queued: boolean; redrawId: number | null }>({
    refreshing: false,
    queued: false,
    redrawId: null,
  });
  const [webglEnabled, setWebglEnabled] = useState<boolean>(true);

  const gpuEnabledForTerminal = useMemo(
    () => !isBackground && webglEnabled,
    [isBackground, webglEnabled],
  );

  const cancelGpuRefreshWork = useCallback(() => {
    const state = gpuRefreshState.current;
    if (typeof cancelAnimationFrame === 'function' && state.redrawId !== null) {
      cancelAnimationFrame(state.redrawId);
    }
    state.refreshing = false;
    state.queued = false;
    state.redrawId = null;
  }, []);

  const refreshGpuFontRendering = useCallback(() => {
    const state = gpuRefreshState.current;
    const renderer = gpuRenderer.current;
    const term = terminalRef.current;
    if (!renderer || !term) {
      state.queued = false;
      return;
    }

    state.queued = true;
    if (state.refreshing) {
      return;
    }

    const performRefresh = () => {
      const activeRenderer = gpuRenderer.current;
      const activeTerminal = terminalRef.current;
      if (!activeRenderer || !activeTerminal) {
        state.refreshing = false;
        state.queued = false;
        return;
      }

      const rendererState = activeRenderer.getState();
      try {
        activeRenderer.clearTextureAtlas();
      } catch (error) {
        logger.debug(`[Terminal ${terminalId}] Failed to clear WebGL texture atlas:`, error);
      }

      if (rendererState.type !== 'webgl') {
        state.refreshing = false;
        state.queued = false;
        return;
      }

      state.redrawId = requestAnimationFrame(() => {
        state.redrawId = null;
        const current = terminalRef.current;
        if (current) {
          try {
            const rows = Math.max(0, current.rows - 1);
            (current as unknown as { refresh?: (start: number, end: number) => void })?.refresh?.(0, rows);
          } catch (error) {
            logger.debug(`[Terminal ${terminalId}] Failed to refresh terminal after atlas clear:`, error);
          }
        }

        state.refreshing = false;
        if (state.queued) {
          state.queued = false;
          refreshGpuFontRendering();
        }
      });
    };

    state.refreshing = true;
    state.queued = false;
    performRefresh();
  }, [terminalId, terminalRef]);

  const applyLetterSpacing = useCallback(
    (useRelaxedSpacing: boolean) => {
      applyTerminalLetterSpacing({
        terminal: terminalRef.current,
        renderer: gpuRenderer.current,
        relaxed: useRelaxedSpacing,
        terminalId,
        onWebglRefresh: refreshGpuFontRendering,
      });
    },
    [refreshGpuFontRendering, terminalId, terminalRef],
  );

  const handleContextLost = useCallback(() => {
    logger.info(`[Terminal ${terminalId}] WebGL context lost, using Canvas renderer`);
    disposeRegisteredGpuRenderer(terminalId, 'context-loss');
    gpuRenderer.current = null;
    applyLetterSpacing(false);
    try {
      fitAddonRef.current?.fit();
      const terminal = terminalRef.current;
      if (terminal) {
        const { cols, rows } = terminal;
        applySizeUpdate(cols, rows, 'context-loss', true);
      }
    } catch (error) {
      logger.debug(`[Terminal ${terminalId}] fit after context loss failed`, error);
    }
  }, [terminalId, applyLetterSpacing, applySizeUpdate, fitAddonRef, terminalRef]);

  const ensureRenderer = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    let renderer = getGpuRenderer(terminalId);
    if (!renderer) {
      renderer = new WebGLTerminalRenderer(terminal, terminalId);
      setGpuRenderer(terminalId, renderer);
    }
    gpuRenderer.current = renderer;
    renderer.setCallbacks({
      onContextLost: handleContextLost,
    });

    const state = await renderer.ensureLoaded();
    if (state.type === 'webgl') {
      refreshGpuFontRendering();
      applyLetterSpacing(true);
    } else {
      applyLetterSpacing(false);
    }
  }, [terminalId, terminalRef, handleContextLost, refreshGpuFontRendering, applyLetterSpacing]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const settings = await invoke<{ webglEnabled?: boolean }>(TauriCommands.GetTerminalSettings);
        if (mounted) {
          setWebglEnabled(settings?.webglEnabled ?? true);
        }
      } catch (err) {
        logger.warn('[Terminal] Failed to load terminal settings for WebGL', err);
        if (mounted) setWebglEnabled(true);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.TerminalRendererUpdated, async detail => {
      const newWebglEnabled = detail.webglEnabled;
      setWebglEnabled(newWebglEnabled);

      if (!terminalRef.current) return;

      const allowWebgl = !isBackground && newWebglEnabled;
      if (allowWebgl) {
        try {
          await ensureRenderer();
        } catch (error) {
          logger.warn(`[Terminal ${terminalId}] Renderer initialization failed during toggle`, error);
        }
      } else {
        disposeRegisteredGpuRenderer(terminalId, 'while toggling WebGL');
        gpuRenderer.current = null;
        applyLetterSpacing(false);
      }
    });

    return cleanup;
  }, [applyLetterSpacing, ensureRenderer, isBackground, terminalId, terminalRef]);

  useEffect(() => {
    if (!gpuEnabledForTerminal) {
      disposeRegisteredGpuRenderer(terminalId, 'feature-toggle');
      gpuRenderer.current = null;
      cancelGpuRefreshWork();
    }
  }, [gpuEnabledForTerminal, terminalId, cancelGpuRefreshWork]);

  useEffect(() => {
    applyLetterSpacing(gpuEnabledForTerminal);
  }, [applyLetterSpacing, gpuEnabledForTerminal]);

  return {
    gpuRenderer,
    gpuEnabledForTerminal,
    refreshGpuFontRendering,
    applyLetterSpacing,
    cancelGpuRefreshWork,
    ensureRenderer,
  };
}
