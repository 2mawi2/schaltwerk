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
import {
  shouldAttemptWebgl,
  resetSuggestedRendererType,
  markWebglFailedGlobally,
  type GpuAccelerationPreference,
} from '../terminal/gpu/gpuFallbackState';
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
  handleFontPreferenceChange: () => Promise<void>;
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
  const lastRendererTypeRef = useRef<'none' | 'canvas' | 'webgl'>('none');
  const [webglEnabled, setWebglEnabled] = useState<boolean>(true);
  const letterSpacingIssueLogged = useRef<'missing' | 'failure' | null>(null);

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

      if (rendererState.type !== 'webgl') {
        // WebGL not ready yet; keep the refresh queued so ensureRenderer can retry once the addon loads.
        state.refreshing = false;
        state.queued = true;
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
      const helper =
        typeof applyTerminalLetterSpacing === 'function' ? applyTerminalLetterSpacing : null;
      if (!helper) {
        if (letterSpacingIssueLogged.current !== 'missing') {
          letterSpacingIssueLogged.current = 'missing';
          logger.warn(
            `[Terminal ${terminalId}] Letter spacing helper unavailable; skipping adjustments`,
          );
        }
        return;
      }

      try {
        helper({
          terminal: terminalRef.current,
          renderer: gpuRenderer.current,
          relaxed: useRelaxedSpacing,
          terminalId,
          onWebglRefresh: refreshGpuFontRendering,
        });
        letterSpacingIssueLogged.current = null;
      } catch (error) {
        if (letterSpacingIssueLogged.current !== 'failure') {
          letterSpacingIssueLogged.current = 'failure';
          logger.error(
            `[Terminal ${terminalId}] Failed to adjust terminal letter spacing:`,
            error,
          );
        }
      }
    },
    [refreshGpuFontRendering, terminalId, terminalRef, gpuRenderer],
  );

  const handleContextLost = useCallback(() => {
    markWebglFailedGlobally('context-loss');
    logger.info(`[Terminal ${terminalId}] WebGL context lost, falling back to DOM renderer globally`);
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

    const preference: GpuAccelerationPreference = webglEnabled ? 'auto' : 'off';
    if (!shouldAttemptWebgl(preference)) {
      logger.info(
        `[Terminal ${terminalId}] Skipping WebGL initialization due to previous failure (DOM renderer active)`,
      );
      disposeRegisteredGpuRenderer(terminalId, 'global-fallback');
      gpuRenderer.current = null;
      applyLetterSpacing(false);
      return;
    }

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
    const previousRendererType = lastRendererTypeRef.current;
    lastRendererTypeRef.current = state.type;
    if (state.type === 'webgl') {
      if (!gpuRefreshState.current.refreshing && !gpuRefreshState.current.queued) {
        // Keep xterm.js' WebGL atlas intact on renderer reuse; only refresh when transitioning
        // from a non-WebGL renderer (mirrors VS Code's behaviour and prevents atlas corruption).
        if (previousRendererType !== 'webgl') {
          refreshGpuFontRendering();
        }
      }
      applyLetterSpacing(true);
    } else {
      if (preference !== 'off') {
        logger.warn(
          `[Terminal ${terminalId}] WebGL renderer unavailable, continuing with DOM renderer`,
        );
      }
      applyLetterSpacing(false);
    }
  }, [
    terminalId,
    terminalRef,
    handleContextLost,
    refreshGpuFontRendering,
    applyLetterSpacing,
    webglEnabled,
  ]);

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
      setWebglEnabled(prev => {
        if (prev !== newWebglEnabled) {
          resetSuggestedRendererType();
          logger.info(
            `[Terminal ${terminalId}] GPU acceleration setting changed, clearing fallback state`,
          );
        }
        return newWebglEnabled;
      });

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

  const handleFontPreferenceChange = useCallback(async () => {
    if (!gpuEnabledForTerminal) {
      return;
    }

    const renderer = gpuRenderer.current;
    if (!renderer) {
      resetSuggestedRendererType();
      try {
        await ensureRenderer();
      } catch (error) {
        logger.warn(
          `[Terminal ${terminalId}] Failed to initialize GPU renderer after font change`,
          error,
        );
      }
      return;
    }

    cancelGpuRefreshWork();

    try {
      renderer.disposeIfLoaded();
      renderer.resetAttempt();
    } catch (error) {
      logger.debug(
        `[Terminal ${terminalId}] Failed to recycle GPU renderer for font update`,
        error,
      );
    }

    try {
      resetSuggestedRendererType();
      await ensureRenderer();
    } catch (error) {
      logger.warn(
        `[Terminal ${terminalId}] Failed to reinitialize GPU renderer after font change`,
        error,
      );
    }
  }, [cancelGpuRefreshWork, ensureRenderer, gpuEnabledForTerminal, terminalId]);

  return {
    gpuRenderer,
    gpuEnabledForTerminal,
    refreshGpuFontRendering,
    applyLetterSpacing,
    cancelGpuRefreshWork,
    ensureRenderer,
    handleFontPreferenceChange,
  };
}
