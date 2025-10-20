import { useEffect, useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback, useMemo, memo } from 'react';
import { TauriCommands } from '../../common/tauriCommands'
import { SchaltEvent, listenEvent } from '../../common/eventSystem'
import { UiEvent, emitUiEvent, listenUiEvent, hasBackgroundStart, clearBackgroundStarts } from '../../common/uiEvents'
import { recordTerminalSize } from '../../common/terminalSizeCache'
import { Terminal as XTerm, type IDisposable } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import { invoke } from '@tauri-apps/api/core'
import { startOrchestratorTop, startSessionTop, AGENT_START_TIMEOUT_MESSAGE } from '../../common/agentSpawn'
import { schedulePtyResize } from '../../common/ptyResizeScheduler'
import { sessionTerminalBase, stableSessionTerminalId } from '../../common/terminalIdentity'
import { clearInflights } from '../../utils/singleflight'
import { UnlistenFn } from '@tauri-apps/api/event';
import { useFontSize } from '../../contexts/FontSizeContext';
import { useCleanupRegistry } from '../../hooks/useCleanupRegistry';
import { theme } from '../../common/theme';
import '@xterm/xterm/css/xterm.css';
import { logger } from '../../utils/logger'
import { useModal } from '../../contexts/ModalContext'
import { safeTerminalFocus, safeTerminalFocusImmediate } from '../../utils/safeFocus'
import { buildTerminalFontFamily } from '../../utils/terminalFonts'
import { TerminalLoadingOverlay } from './TerminalLoadingOverlay'
import { TerminalSearchPanel } from './TerminalSearchPanel'
import { detectPlatformSafe } from '../../keyboardShortcuts/helpers'
import { writeTerminalBackend } from '../../terminal/transport/backend'
import {
    acquireTerminalInstance,
    detachTerminalInstance,
    releaseTerminalInstance,
} from '../../terminal/registry/terminalRegistry'
import { XtermTerminal } from '../../terminal/xterm/XtermTerminal'
import { useTerminalGpu } from '../../hooks/useTerminalGpu'
import { terminalOutputManager } from '../../terminal/stream/terminalOutputManager'
import { TerminalResizeCoordinator } from './resize/TerminalResizeCoordinator'

const DEFAULT_SCROLLBACK_LINES = 10000
const BACKGROUND_SCROLLBACK_LINES = 5000
const AGENT_SCROLLBACK_LINES = 20000
const RIGHT_EDGE_GUARD_COLUMNS = 2
const CLAUDE_SHIFT_ENTER_SEQUENCE = '\\'
// Track last effective size we told the PTY (after guard), for SIGWINCH nudging
const lastEffectiveRefInit = { cols: 80, rows: 24 }

const RESIZE_PIXEL_EPSILON = 0.75

// Xterm/WebGL rounds minimumContrastRatio to one decimal place; use a single shared value
const ATLAS_CONTRAST_BASE = 1.1;

// Global guard to avoid starting Claude multiple times for the same terminal id across remounts
const startedGlobal = new Set<string>();

// Export function to clear started tracking for specific terminals
export function clearTerminalStartedTracking(terminalIds: string[]) {
    terminalIds.forEach(id => startedGlobal.delete(id));
    clearInflights(terminalIds);
    clearBackgroundStarts(terminalIds);
}

interface TerminalProps {
    terminalId: string;
    className?: string;
    sessionName?: string;
    isCommander?: boolean;
    agentType?: string;
    readOnly?: boolean;
    onTerminalClick?: () => void;
    isBackground?: boolean;
    onReady?: () => void;
    inputFilter?: (data: string) => boolean;
}

export interface TerminalHandle {
    focus: () => void;
    showSearch: () => void;
    scrollToBottom: () => void;
}

const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(({ terminalId, className = '', sessionName, isCommander = false, agentType, readOnly = false, onTerminalClick, isBackground = false, onReady, inputFilter }, ref) => {
    const { terminalFontSize } = useFontSize();
    const { addEventListener, addResizeObserver } = useCleanupRegistry();
    const { isAnyModalOpen } = useModal();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const searchContainerRef = useRef<HTMLDivElement | null>(null);
    const focusSearchInput = useCallback(() => {
        if (!searchContainerRef.current) return false;
        const input = searchContainerRef.current.querySelector('input');
        if (input instanceof HTMLInputElement) {
            input.focus();
            return true;
        }
        return false;
    }, []);
    const termRef = useRef<HTMLDivElement>(null);
    const lastMeasuredDimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
    const readDimensions = useCallback(() => {
        const el = termRef.current;
        if (!el || !el.isConnected) {
            return null;
        }
        return {
            width: el.clientWidth,
            height: el.clientHeight,
        };
    }, [termRef]);
    const rememberDimensions = useCallback(() => {
        const dims = readDimensions();
        if (dims) {
            lastMeasuredDimensionsRef.current = dims;
        }
        return dims;
    }, [readDimensions]);
    const xtermWrapperRef = useRef<XtermTerminal | null>(null);
    const terminal = useRef<XTerm | null>(null);
    const onDataDisposableRef = useRef<IDisposable | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    const searchAddon = useRef<SearchAddon | null>(null);
    const lastSize = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
    const lastEffectiveRef = useRef<{ cols: number; rows: number }>(lastEffectiveRefInit);
    const resizeCoordinatorRef = useRef<TerminalResizeCoordinator | null>(null);
    const [hydrated, setHydrated] = useState(false);
    const hydratedRef = useRef<boolean>(false);
    const [agentLoading, setAgentLoading] = useState(false);
    const [agentStopped, setAgentStopped] = useState(false);
    const terminalEverStartedRef = useRef<boolean>(false);
    const hydratedOnceRef = useRef<boolean>(false);
    // Tracks user-initiated interrupt signal to distinguish from startup/other exits.
    const lastSigintAtRef = useRef<number | null>(null);
    const [isSearchVisible, setIsSearchVisible] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const handleSearchTermChange = useCallback((value: string) => {
        setSearchTerm(value);
    }, []);
    const handleFindNext = useCallback(() => {
        if (searchAddon.current && terminal.current) {
            searchAddon.current.findNext(searchTerm);
        }
    }, [searchTerm]);
    const handleFindPrevious = useCallback(() => {
        if (searchAddon.current && terminal.current) {
            searchAddon.current.findPrevious(searchTerm);
        }
    }, [searchTerm]);
    const handleCloseSearch = useCallback(() => {
        setIsSearchVisible(false);
        setSearchTerm('');
    }, []);
    const termDebug = () => (typeof window !== 'undefined' && localStorage.getItem('TERMINAL_DEBUG') === '1');
    const mountedRef = useRef<boolean>(false);
    const startingTerminals = useRef<Map<string, boolean>>(new Map());
    const previousTerminalId = useRef<string>(terminalId);
    const rendererReadyRef = useRef<boolean>(false); // Canvas renderer readiness flag
    const [resolvedFontFamily, setResolvedFontFamily] = useState<string | null>(null);
    const [customFontFamily, setCustomFontFamily] = useState<string | null>(null);
    const [fontsFullyLoaded, setFontsFullyLoaded] = useState(false);
    const fontsLoadedRef = useRef(false);
    // Agent conversation terminal detection reused across sizing logic and scrollback config
    const isAgentTopTerminal = useMemo(() => (
        terminalId.endsWith('-top') && (terminalId.startsWith('session-') || terminalId.startsWith('orchestrator-'))
    ), [terminalId]);
    // Drag-selection suppression for run terminals
    const suppressNextClickRef = useRef<boolean>(false);
    const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
    const dragSelectingRef = useRef<boolean>(false);
    const selectionActiveRef = useRef<boolean>(false);
    const skipNextFocusCallbackRef = useRef<boolean>(false);
    const shiftEnterPrefixRef = useRef<Promise<void> | null>(null);

    const beginClaudeShiftEnter = useCallback(() => {
        const prefixWrite = writeTerminalBackend(terminalId, CLAUDE_SHIFT_ENTER_SEQUENCE)
            .catch(err => {
                logger.debug('[Terminal] quick-escape prefix ignored (backend not ready yet)', err);
                throw err;
            });
        shiftEnterPrefixRef.current = prefixWrite;
    }, [terminalId]);

    const finalizeClaudeShiftEnter = useCallback((char: string): boolean => {
        if (char !== '\r' && char !== '\n') return false;
        const prefixPromise = shiftEnterPrefixRef.current;
        if (!prefixPromise) return false;
        shiftEnterPrefixRef.current = null;
        void (async () => {
            try {
                await prefixPromise.catch(() => undefined);
            } finally {
                await writeTerminalBackend(terminalId, char).catch(err => logger.debug('[Terminal] newline ignored (backend not ready yet)', err));
            }
        })();
        return true;
    }, [terminalId]);

     // Initialize agentStopped state from sessionStorage (only for agent top terminals)
     useEffect(() => {
         if (!isAgentTopTerminal) return;
         const key = `schaltwerk:agent-stopped:${terminalId}`;
         setAgentStopped(sessionStorage.getItem(key) === 'true');
     }, [isAgentTopTerminal, terminalId]);

    const applySizeUpdate = useCallback((cols: number, rows: number, reason: string, force = false) => {
        const MIN_DIMENSION = 2;
        if (!terminal.current) return false;
        // Step 1: only apply resize thrash suppression (no right-edge margin yet)
        if (cols < MIN_DIMENSION || rows < MIN_DIMENSION) {
            logger.debug(`[Terminal ${terminalId}] Skipping ${reason} resize due to tiny dimensions ${cols}x${rows}`);
            const prevCols = lastSize.current.cols;
            const prevRows = lastSize.current.rows;
            if (prevCols >= MIN_DIMENSION && prevRows >= MIN_DIMENSION) {
                requestAnimationFrame(() => {
                    try {
                        terminal.current?.resize(prevCols, prevRows);
                    } catch (error) {
                        logger.debug(`[Terminal ${terminalId}] Failed to restore previous size after tiny resize`, error);
                    }
                });
            }
            return false;
        }

        const dragging = document.body.classList.contains('is-split-dragging');
        // Suppress resize thrash: ignore tiny oscillations (<2 total delta) unless forced or dragging
        if (!force && !dragging) {
            const dCols = Math.abs(cols - lastSize.current.cols);
            const dRows = Math.abs(rows - lastSize.current.rows);
            if (dCols + dRows < 2) return false;
        }

        const effectiveCols = Math.max(cols - RIGHT_EDGE_GUARD_COLUMNS, MIN_DIMENSION);

        const measuredChanged = (cols !== lastSize.current.cols) || (rows !== lastSize.current.rows);
        lastSize.current = { cols, rows };

        let wasAtBottom = false;
        let bufferLinesBefore = 0;
        try {
            const buf = terminal.current.buffer.active;
            wasAtBottom = buf.viewportY === buf.baseY;
            bufferLinesBefore = buf.length;
            if (termDebug()) {
                logger.debug(`[Terminal ${terminalId}] BEFORE resize: buffer.length=${buf.length}, viewportY=${buf.viewportY}, baseY=${buf.baseY}, wasAtBottom=${wasAtBottom}`);
            }
        } catch (_e) {
            wasAtBottom = true;
        }

        // Align frontend grid to effective size first, then repaint
        try {
            terminal.current.resize(effectiveCols, rows);
            (terminal.current as unknown as { refresh?: (start: number, end: number) => void })?.refresh?.(0, Math.max(0, rows - 1));

            if (termDebug()) {
                try {
                    const buf = terminal.current.buffer.active;
                    logger.debug(`[Terminal ${terminalId}] AFTER resize: buffer.length=${buf.length}, viewportY=${buf.viewportY}, baseY=${buf.baseY}, linesLost=${bufferLinesBefore - buf.length}`);
                } catch (_e) {
                    logger.debug(`[Terminal ${terminalId}] Could not read buffer after resize`);
                }
            }

            if (wasAtBottom) {
                requestAnimationFrame(() => {
                    try {
                        if (!terminal.current) return;
                        const buf = terminal.current.buffer.active;
                        const linesToScroll = buf.baseY - buf.viewportY;
                        if (linesToScroll !== 0) {
                            terminal.current.scrollLines(linesToScroll);
                        }
                    } catch (e) {
                        logger.debug(`[Terminal ${terminalId}] Failed to scroll to bottom after resize`, e);
                    }
                });
            }
        } catch (e) {
            logger.debug(`[Terminal ${terminalId}] Failed to apply frontend resize to ${effectiveCols}x${rows}`, e);
        }

        // If the container changed but the effective cols stayed the same, TUIs may not reflow (no SIGWINCH).
        const sameEffective = (effectiveCols === lastEffectiveRef.current.cols) && (rows === lastEffectiveRef.current.rows);
        // Nudge top agent terminals when not dragging to guarantee reflow
        if (!dragging && isAgentTopTerminal && measuredChanged && sameEffective) {
            const nudgeCols = Math.max(effectiveCols - 1, MIN_DIMENSION);
            try {
                terminal.current.resize(nudgeCols, rows);
                (terminal.current as unknown as { refresh?: (start: number, end: number) => void })?.refresh?.(0, Math.max(0, rows - 1));
            } catch (e) {
                logger.debug(`[Terminal ${terminalId}] frontend nudge resize failed`, e);
            }
            recordTerminalSize(terminalId, nudgeCols, rows);
            schedulePtyResize(terminalId, { cols: nudgeCols, rows }, { force: true });
            try {
                terminal.current?.resize(effectiveCols, rows);
                (terminal.current as unknown as { refresh?: (start: number, end: number) => void })?.refresh?.(0, Math.max(0, rows - 1));
            } catch (e) {
                logger.debug(`[Terminal ${terminalId}] final resize after nudge failed`, e);
            }
            recordTerminalSize(terminalId, effectiveCols, rows);
            schedulePtyResize(terminalId, { cols: effectiveCols, rows }, { force: true });
            lastEffectiveRef.current = { cols: effectiveCols, rows };
            rememberDimensions();
            return true;
        }

        recordTerminalSize(terminalId, effectiveCols, rows);
        schedulePtyResize(terminalId, { cols: effectiveCols, rows });
        lastEffectiveRef.current = { cols: effectiveCols, rows };
        rememberDimensions();
        return true;
    }, [terminalId, isAgentTopTerminal, rememberDimensions]);

    useEffect(() => {
        const coordinator = new TerminalResizeCoordinator({
            getBufferLength: () => {
                try {
                    return terminal.current?.buffer.active.length ?? 0;
                } catch {
                    return 0;
                }
            },
            isVisible: () => {
                const el = containerRef.current;
                if (!el || !el.isConnected) {
                    return false;
                }
                if (typeof el.offsetParent === 'object') {
                    return el.offsetParent !== null;
                }
                return el.getClientRects().length > 0;
            },
            applyResize: (cols, rows, context) => {
                applySizeUpdate(cols, rows, context.reason, context.force);
            },
            applyRows: (cols, rows, context) => {
                applySizeUpdate(cols, rows, context.reason, context.force);
            },
        });
        resizeCoordinatorRef.current = coordinator;
        return () => {
            coordinator.dispose();
            resizeCoordinatorRef.current = null;
        };
    }, [applySizeUpdate]);

    const {
        gpuRenderer,
        gpuEnabledForTerminal,
        refreshGpuFontRendering,
        applyLetterSpacing,
        cancelGpuRefreshWork,
        ensureRenderer,
        handleFontPreferenceChange,
    } = useTerminalGpu({
        terminalId,
        terminalRef: terminal,
        fitAddonRef: fitAddon,
        isBackground,
        applySizeUpdate,
    });

    const ensureRendererRef = useRef(ensureRenderer);
    useEffect(() => {
        ensureRendererRef.current = ensureRenderer;
    }, [ensureRenderer]);

    const cancelGpuRefreshWorkRef = useRef(cancelGpuRefreshWork);
    useEffect(() => {
        cancelGpuRefreshWorkRef.current = cancelGpuRefreshWork;
    }, [cancelGpuRefreshWork]);

    const requestResize = useCallback((reason: string, options?: { immediate?: boolean; force?: boolean }) => {
        if (!fitAddon.current || !terminal.current) {
            return;
        }

        const measured = readDimensions();
        if (!measured) {
            return;
        }

        if (!options?.force) {
            const prev = lastMeasuredDimensionsRef.current;
            const deltaWidth = Math.abs(measured.width - prev.width);
            const deltaHeight = Math.abs(measured.height - prev.height);
            if (!options?.immediate && deltaWidth < RESIZE_PIXEL_EPSILON && deltaHeight < RESIZE_PIXEL_EPSILON) {
                return;
            }
        }
        lastMeasuredDimensionsRef.current = measured;

        const proposer = fitAddon.current as unknown as { proposeDimensions?: () => { cols: number; rows: number } | undefined };
        const proposed = proposer.proposeDimensions?.();
        if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows) || proposed.cols <= 0 || proposed.rows <= 0) {
            return;
        }

        resizeCoordinatorRef.current?.resize({
            cols: proposed.cols,
            rows: proposed.rows,
            reason,
            immediate: options?.immediate ?? false,
        });
    }, [readDimensions]);

    // Selection-aware autoscroll helpers (run terminal: avoid jumping while user selects text)
    const isUserSelectingInTerminal = useCallback((): boolean => {
        try {
            if (terminal.current && typeof terminal.current.hasSelection === 'function') {
                if (terminal.current.hasSelection()) return true;
            }
            const sel = typeof window !== 'undefined' ? window.getSelection() : null;
            if (!sel || sel.isCollapsed) return false;
            const anchor = sel.anchorNode;
            const focus = sel.focusNode;
            const el = termRef.current;
            if (!el) return false;
            return (!!anchor && el.contains(anchor)) || (!!focus && el.contains(focus));
        } catch {
            return false;
        }
    }, []);

    const scrollToBottomInstant = useCallback(() => {
        terminal.current?.scrollToBottom();
    }, []);

    const restartAgent = useCallback(async () => {
        if (!isAgentTopTerminal) return;
        setAgentLoading(true);
        sessionStorage.removeItem(`schaltwerk:agent-stopped:${terminalId}`);
        clearTerminalStartedTracking([terminalId]); // clears startedGlobal + inflights/background marks

             try {
                 // Provide initial size to avoid early overflow (apply guard)
                 let measured: { cols?: number; rows?: number } | undefined;
                 try {
                     if (fitAddon.current && terminal.current) {
                         fitAddon.current.fit();
                         const MIN_DIM = 2;
                         const mCols = Math.max(terminal.current.cols - RIGHT_EDGE_GUARD_COLUMNS, MIN_DIM);
                         measured = { cols: mCols, rows: terminal.current.rows };
                     }
                 } catch (e) {
                     logger.warn(`[Terminal ${terminalId}] Failed to measure before restart:`, e);
                 }

             if (isCommander || (terminalId.includes('orchestrator') && terminalId.endsWith('-top'))) {
                 await startOrchestratorTop({ terminalId, measured });
             } else if (sessionName) {
                 await startSessionTop({ sessionName, topId: terminalId, measured, agentType });
             }
             setAgentStopped(false);
         } catch (e) {
             logger.error(`[Terminal ${terminalId}] Restart failed:`, e);
             // Keep banner up so user can retry
             setAgentStopped(true);
         } finally {
             setAgentLoading(false);
         }
     }, [agentType, isAgentTopTerminal, isCommander, sessionName, terminalId]);

    useImperativeHandle(ref, () => ({
        focus: () => {
            if (isSearchVisible && focusSearchInput()) {
                return;
            }
            safeTerminalFocusImmediate(() => {
                terminal.current?.focus();
            }, isAnyModalOpen);
        },
        showSearch: () => {
            setIsSearchVisible(true);
        },
        scrollToBottom: scrollToBottomInstant
    }), [isAnyModalOpen, isSearchVisible, focusSearchInput, scrollToBottomInstant]);

    useEffect(() => {
        hydratedRef.current = hydrated;
    }, [hydrated]);


    useEffect(() => {
        if (!onTerminalClick) return;
        const node = containerRef.current;
        if (!node) return;

        const handleFocusIn = (event: FocusEvent) => {
            if (skipNextFocusCallbackRef.current) {
                skipNextFocusCallbackRef.current = false;
                return;
            }
            const target = event.target as Node | null;
            if (target instanceof Element) {
                if (target.closest('[data-terminal-search="true"]')) {
                    return;
                }
            }
            if (target && searchContainerRef.current && searchContainerRef.current.contains(target)) {
                return;
            }
            onTerminalClick();
        };

        node.addEventListener('focusin', handleFocusIn);
        return () => {
            node.removeEventListener('focusin', handleFocusIn);
        };
    }, [onTerminalClick]);

    useEffect(() => {
        let mounted = true
        const load = async () => {
            try {
                const settings = await invoke<{ fontFamily?: string | null }>(TauriCommands.GetTerminalSettings)
                const custom = settings?.fontFamily ?? null
                const chain = buildTerminalFontFamily(custom)
                if (mounted) {
                    setCustomFontFamily(custom)
                    setResolvedFontFamily(chain)
                }
            } catch (err) {
                logger.warn('[Terminal] Failed to load terminal settings for font family', err)
                const chain = buildTerminalFontFamily(null)
                if (mounted) {
                    setCustomFontFamily(null)
                    setResolvedFontFamily(chain)
                }
            }
        }
        load()
        return () => { mounted = false }
    }, [])

    useEffect(() => {
        const cleanup = listenUiEvent(UiEvent.TerminalFontUpdated, detail => {
            const custom = detail.fontFamily ?? null
            const chain = buildTerminalFontFamily(custom)
            setCustomFontFamily(custom)
            setResolvedFontFamily(chain)
        })
        return cleanup
    }, [])

     // Listen for unified agent-start events to prevent double-starting
     useEffect(() => {
         let unlistenAgentStarted: UnlistenFn | null = null;

         const setupListener = async () => {
             try {
                 unlistenAgentStarted = await listenEvent(SchaltEvent.TerminalAgentStarted, (payload) => {
                     logger.info(`[Terminal] Received terminal-agent-started event for ${payload.terminal_id}`);

                     startedGlobal.add(payload.terminal_id);

                     if (payload?.terminal_id === terminalId) {
                         sessionStorage.removeItem(`schaltwerk:agent-stopped:${terminalId}`);
                         setAgentStopped(false);
                         terminalEverStartedRef.current = true;
                     }
                 });
             } catch (e) {
                 logger.error('[Terminal] Failed to set up terminal-agent-started listener:', e);
             }
         };

         setupListener();

         return () => {
             if (unlistenAgentStarted) {
                 unlistenAgentStarted();
             }
         };
      }, [terminalId]);

      // Listen for TerminalClosed events to detect when agent terminals are killed
      useEffect(() => {
          if (!isAgentTopTerminal) return;
          let unlisten: UnlistenFn | null = null;
          (async () => {
              try {
                  unlisten = await listenEvent(SchaltEvent.TerminalClosed, (payload) => {
                      if (payload?.terminal_id !== terminalId) return;
                      
                      // Only show banner if there's a recent interrupt signal and terminal has actually started
                      const now = Date.now();
                      const sigintTime = lastSigintAtRef.current;
                      const timeSinceSigint = sigintTime ? now - sigintTime : Infinity;
                      const RECENT_SIGINT_WINDOW_MS = 2000; // 2 seconds
                      
                      if (terminalEverStartedRef.current && sigintTime && timeSinceSigint < RECENT_SIGINT_WINDOW_MS) {
                          // Respect the user's ^C: mark stopped and persist
                          setAgentLoading(false);
                          setAgentStopped(true);
                          sessionStorage.setItem(`schaltwerk:agent-stopped:${terminalId}`, 'true');
                          // Allow future manual restarts
                          clearTerminalStartedTracking([terminalId]);
                          logger.info(`[Terminal ${terminalId}] Agent stopped by user (SIGINT detected ${timeSinceSigint}ms ago)`);
                      } else {
                          logger.debug(`[Terminal ${terminalId}] Terminal closed but no recent SIGINT or not started yet (sigint: ${sigintTime}, timeSince: ${timeSinceSigint}ms, started: ${terminalEverStartedRef.current})`);
                      }
                  });
              } catch (e) {
                  logger.warn(`[Terminal ${terminalId}] Failed to attach TerminalClosed listener`, e);
              }
          })();
          return () => { try { unlisten?.(); } catch (e) { logger.debug(`[Terminal ${terminalId}] Failed to cleanup TerminalClosed listener:`, e); } };
      }, [isAgentTopTerminal, terminalId]);

    // Listen for force scroll events (e.g., after review comment paste)
    useEffect(() => {
        let unlistenForceScroll: UnlistenFn | null = null;
        
        const setupForceScrollListener = async () => {
            try {
                unlistenForceScroll = await listenEvent(SchaltEvent.TerminalForceScroll, (payload) => {
                    if (payload.terminal_id === terminalId) {
                        logger.info(`[Terminal] Force scrolling terminal ${terminalId} to bottom`);
                        scrollToBottomInstant();
                    }
                });
            } catch (e) {
                logger.error('[Terminal] Failed to set up force scroll listener:', e);
            }
        };
        
        setupForceScrollListener();
        
        return () => {
            if (unlistenForceScroll) {
                unlistenForceScroll();
            }
        };
    }, [terminalId, scrollToBottomInstant]);

    // Workaround: force-fit and send PTY resize when session search runs for OpenCode
    useEffect(() => {
        const handleSearchResize = (detail?: { kind?: 'session' | 'orchestrator'; sessionId?: string }) => {
            if (agentType !== 'opencode' || isBackground) return;
            if (!termRef.current) return;
            const el = termRef.current;
            if (!el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;

            if (detail?.kind) {
                if (detail.kind === 'session') {
                    if (!sessionName || detail.sessionId !== sessionName) return;
                } else if (detail.kind === 'orchestrator') {
                    if (!isCommander) return;
                }
            }

            const doFitAndNotify = () => {
                try {
                    requestResize('opencode-search', { immediate: true, force: true });
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] OpenCode search-resize failed:`, e);
                }
            };

            // Two-phase fit: layout can change width first then height (or vice versa)
            // Run once now, once on the next frame to capture both axes after reflow/scrollbar changes
            doFitAndNotify();
            requestAnimationFrame(() => {
                // Guard again in case the component unmounted between frames
                if (!fitAddon.current || !terminal.current || !termRef.current) return;
                if (!termRef.current.isConnected) return;
                doFitAndNotify();
            });
        };
        const cleanup = listenUiEvent(UiEvent.OpencodeSearchResize, handleSearchResize)
        return cleanup
        // Deliberately depend on agentType/isBackground to keep logic accurate per mount
    }, [agentType, isBackground, terminalId, sessionName, isCommander, requestResize]);

    // Listen for session-switching animation completion for OpenCode
    useEffect(() => {
        const handleSessionSwitchAnimationEnd = () => {
            if (agentType !== 'opencode' || isBackground) return;

            // Check if session-switching class was removed (animation finished)
            if (!document.body.classList.contains('session-switching')) {
                const doFitAndNotify = () => {
                    try {
                        if (!termRef.current) return;
                        const el = termRef.current;
                        if (!el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;

                        requestResize('opencode-session-switch', { immediate: true, force: true });
                    } catch (e) {
                        logger.warn(`[Terminal ${terminalId}] OpenCode session-switch resize failed:`, e);
                    }
                };

                // Two-phase fit to ensure both axes settle after layout changes
                doFitAndNotify();
                requestAnimationFrame(() => doFitAndNotify());
            }
        };

        // Use MutationObserver to watch for class changes on document.body
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    handleSessionSwitchAnimationEnd();
                }
            });
        });

        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

        return () => observer.disconnect();
    }, [agentType, isBackground, terminalId, requestResize]);

    // Deterministic refit on session switch specifically for OpenCode
    useEffect(() => {
        const handleSelectionResize = (detail?: { kind?: 'session' | 'orchestrator'; sessionId?: string }) => {
            if (agentType !== 'opencode' || isBackground) return;
            if (detail?.kind === 'session') {
                if (!sessionName || detail.sessionId !== sessionName) return;
            } else if (detail?.kind === 'orchestrator') {
                if (!isCommander) return;
            }

            if (!termRef.current || !termRef.current.isConnected) return;

            const run = () => {
                try {
                    requestResize('opencode-selection', { immediate: true, force: true });
                } catch (error) {
                    logger.warn(`[Terminal ${terminalId}] Selection resize fit failed:`, error);
                }
            };

            // Two RAFs to ensure both axes settle after layout toggle
            requestAnimationFrame(() => {
                run();
                requestAnimationFrame(() => run());
            });
        };
        const cleanup = listenUiEvent(UiEvent.OpencodeSelectionResize, handleSelectionResize)
        return cleanup
    }, [agentType, isBackground, terminalId, sessionName, isCommander, requestResize]);

    // Generic, agent-agnostic terminal resize request listener (delegates to requestResize with two-pass fit)
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ target: 'session' | 'orchestrator' | 'all'; sessionId?: string }>).detail
            // Determine if this terminal should react
            let shouldHandle = false
            if (!detail || detail.target === 'all') {
                shouldHandle = true
            } else if (detail.target === 'orchestrator') {
                shouldHandle = terminalId.startsWith('orchestrator-')
            } else if (detail.target === 'session') {
                if (detail.sessionId) {
                    const prefix = `${sessionTerminalBase(detail.sessionId)}-`
                    shouldHandle = terminalId.startsWith(prefix)
                }
            }

            if (!shouldHandle) return
            // Avoid hammering while the user drags splitters
            if (document.body.classList.contains('is-split-dragging')) return

            try {
                if (!termRef.current || !termRef.current.isConnected) return
                requestResize('generic-resize-request:raf1', { immediate: true, force: true })
                requestAnimationFrame(() => {
                    try {
                        if (!termRef.current || !termRef.current.isConnected) return
                        requestResize('generic-resize-request:raf2', { immediate: true, force: true })
                    } catch (err) {
                        logger.debug('[Terminal] second-pass generic fit failed', err)
                    }
                })
            } catch (e) {
                logger.warn(`[Terminal ${terminalId}] Generic resize request failed:`, e)
            }
        }
        window.addEventListener(String(UiEvent.TerminalResizeRequest), handler as EventListener)
        return () => window.removeEventListener(String(UiEvent.TerminalResizeRequest), handler as EventListener)
    }, [terminalId, requestResize])

    useEffect(() => {
        mountedRef.current = true;
        let cancelled = false;
        // track mounted lifecycle only; no timer-based logic tied to mount time
        if (!termRef.current) {
            logger.error(`[Terminal ${terminalId}] No ref available!`);
            return;
        }

        setHydrated(false);
        hydratedRef.current = false;
        hydratedOnceRef.current = false;

        // Revert: Always show a visible terminal cursor.
        // Prior logic adjusted/hid the xterm cursor for TUI agents which led to
        // "no cursor" reports in bottom terminals (e.g., Neovim/Neogrim). We now
        // unconditionally enable a blinking block cursor for all terminals.
        // Agent conversation terminals (session/orchestrator top) need deeper scrollback to preserve history
        // Background terminals use reduced scrollback to save memory
        let scrollbackLines = DEFAULT_SCROLLBACK_LINES; // Default for bottom terminals
        if (isBackground) {
            scrollbackLines = BACKGROUND_SCROLLBACK_LINES; // Reduced for background terminals
        } else if (isAgentTopTerminal) {
            scrollbackLines = AGENT_SCROLLBACK_LINES; // Deep history for agent conversation terminals
        }

        const atlasContrast = ATLAS_CONTRAST_BASE;

        const { record, isNew } = acquireTerminalInstance(terminalId, () => new XtermTerminal({
            terminalId,
            config: {
                scrollback: scrollbackLines,
                fontSize: terminalFontSize,
                fontFamily: resolvedFontFamily || 'Menlo, Monaco, ui-monospace, SFMono-Regular, monospace',
                readOnly,
                minimumContrastRatio: atlasContrast,
            },
        }));
        const instance = record.xterm;
        if (!isNew) {
            instance.applyConfig({
                scrollback: scrollbackLines,
                fontSize: terminalFontSize,
                fontFamily: resolvedFontFamily || 'Menlo, Monaco, ui-monospace, SFMono-Regular, monospace',
                readOnly,
                minimumContrastRatio: atlasContrast,
            });
        }
        xtermWrapperRef.current = instance;
        terminal.current = instance.raw;
        fitAddon.current = instance.fitAddon;
        searchAddon.current = instance.searchAddon;
        
        if (termRef.current) {
            instance.attach(termRef.current);
        }
        applyLetterSpacing(gpuEnabledForTerminal);
        // Allow streaming immediately; proper fits will still run later
        rendererReadyRef.current = true;

        // Ensure proper initial fit after terminal is opened
        // CRITICAL: Wait for container dimensions before fitting - essential for xterm.js 5.x cursor positioning
        const performInitialFit = () => {
            if (!fitAddon.current || !termRef.current || !terminal.current) return;

            const containerWidth = termRef.current.clientWidth;
            const containerHeight = termRef.current.clientHeight;

            // Only fit if container has proper dimensions; otherwise defer and let observers retry
            if (containerWidth <= 0 || containerHeight <= 0) {
                logger.debug(`[Terminal ${terminalId}] Deferring initial fit until container is measurable (${containerWidth}x${containerHeight})`);
                return;
            }

            try {
                fitAddon.current.fit();
                requestResize('initial-fit', { immediate: true, force: true });
                const { cols, rows } = terminal.current;
                logger.info(`[Terminal ${terminalId}] Initial fit: ${cols}x${rows} (container: ${containerWidth}x${containerHeight})`);
            } catch (e) {
                logger.warn(`[Terminal ${terminalId}] Initial fit failed:`, e);
            }
        };

        performInitialFit();

        // Ensure scrollbar thumb reflects the current buffer position when the terminal is attached.
        requestAnimationFrame(() => {
            terminal.current?.scrollToBottom();
        });
        let rendererInitialized = false;
        const initializeRenderer = async () => {
            if (rendererInitialized || cancelled || !terminal.current || !termRef.current) {
                return;
            }

            if (termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
                rendererInitialized = true;
                try {
                    if (fitAddon.current && terminal.current) {
                        fitAddon.current.fit();
                        try {
                            requestResize('renderer-init', { immediate: true, force: true });
                        } catch (e) {
                            logger.warn(`[Terminal ${terminalId}] Early initial resize failed:`, e);
                        }
                    }

                    if (gpuEnabledForTerminal) {
                        await ensureRendererRef.current?.();
                    }

                    rendererReadyRef.current = true;

                    requestAnimationFrame(() => {
                        if (fitAddon.current && terminal.current) {
                            try {
                                fitAddon.current.fit();
                                requestResize('post-init', { immediate: true, force: true });
                            } catch (e) {
                                logger.warn(`[Terminal ${terminalId}] Post-init fit failed:`, e);
                            }
                        }
                    });
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Renderer initialization failed:`, e);
                    rendererReadyRef.current = true;
                }
            }
        };
        
        // Skip resize observers for background terminals to save resources
        let rendererObserver: ResizeObserver | null = null;
        if (!isBackground) {
            // Use ResizeObserver to deterministically initialize renderer when container is ready
            // This avoids polling and ensures we initialize exactly once when dimensions are available
            rendererObserver = new ResizeObserver((entries?: ResizeObserverEntry[]) => {
                if (rendererInitialized) return;
                try {
                    const entry = entries && entries[0];
                    const w = entry?.contentRect?.width ?? termRef.current?.clientWidth ?? 0;
                    const h = entry?.contentRect?.height ?? termRef.current?.clientHeight ?? 0;
                    if (w > 0 && h > 0) {
                        // Container now has dimensions, initialize renderer
                        // Disconnect immediately after first successful observation to prevent interference
                        rendererObserver?.disconnect();
                        requestAnimationFrame(() => {
                            initializeRenderer();
                        });
                    }
                } catch (e) {
                    logger.debug('ResizeObserver error during terminal initialization', e)
                    // Fallback: try immediate initialization based on current element size
                    if (termRef.current && termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
                        try { rendererObserver?.disconnect(); } catch {
                            // Intentionally ignore observer disconnect errors
                        }
                        requestAnimationFrame(() => initializeRenderer());
                    }
                }
            });
            
            // Start observing the terminal container
            rendererObserver.observe(termRef.current);
        } else {
            // For background terminals, initialize immediately with default size
            requestAnimationFrame(() => {
                initializeRenderer();
            });
        }

        // Use IntersectionObserver to catch hidden->visible transitions (e.g., collapsed panels)
        // and trigger a definitive fit+resize when the terminal becomes visible.
        // Skip for background terminals since they're always hidden
        let visibilityObserver: IntersectionObserver | null = null;
        if (!isBackground && typeof IntersectionObserver !== 'undefined' && termRef.current) {
            visibilityObserver = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (!entry || !entry.isIntersecting) return;
                if (!fitAddon.current || !terminal.current || !termRef.current) return;
                const el = termRef.current;
                if (!el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;
                try {
                    fitAddon.current.fit();
                } catch (e) {
                    logger.debug(`[Terminal ${terminalId}] Visibility pre-fit failure`, e);
                }
                resizeCoordinatorRef.current?.flush('visibility');
                try {
                    requestResize('visibility', { immediate: true, force: true });
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Visibility fit failed:`, e);
                }
            }, { threshold: 0.01 });
            visibilityObserver.observe(termRef.current);
        }
        
        // Also try immediate initialization in case container already has dimensions
        requestAnimationFrame(() => {
            if (termRef.current && termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
                // If we already have dimensions, disconnect the observer and initialize
                rendererObserver?.disconnect();
                initializeRenderer();
            }
        });

        // Intercept global shortcuts before xterm.js processes them
        terminal.current.attachCustomKeyEventHandler((event: KeyboardEvent) => {
            const isMac = navigator.userAgent.includes('Mac')
            const modifierKey = isMac ? event.metaKey : event.ctrlKey
            const shouldHandleClaudeShiftEnter = (
                agentType === 'claude' &&
                isAgentTopTerminal &&
                event.key === 'Enter' &&
                event.type === 'keydown' &&
                event.shiftKey &&
                !modifierKey &&
                !event.altKey &&
                !readOnly
            )

            if (shouldHandleClaudeShiftEnter) {
                beginClaudeShiftEnter();
                return true
            }
            
            // Modifier+Enter for new line (like Claude Code)
            if (modifierKey && event.key === 'Enter' && event.type === 'keydown') {
                // Send a newline character without submitting the command
                // This allows multiline input in shells that support it
                writeTerminalBackend(terminalId, '\n').catch(err => logger.debug('[Terminal] newline ignored (backend not ready yet)', err));
                return false; // Prevent default Enter behavior
            }
            // Prefer Shift+Modifier+N as "New spec"
            if (modifierKey && event.shiftKey && (event.key === 'n' || event.key === 'N')) {
                emitUiEvent(UiEvent.NewSpecRequest)
                return false
            }
            // Plain Modifier+N opens the regular new session modal
            if (modifierKey && !event.shiftKey && (event.key === 'n' || event.key === 'N')) {
                emitUiEvent(UiEvent.GlobalNewSessionShortcut)
                return false // Prevent xterm.js from processing this event
            }
            if (modifierKey && (event.key === 'r' || event.key === 'R')) {
                emitUiEvent(UiEvent.GlobalMarkReadyShortcut)
                return false
            }
            if (modifierKey && (event.key === 'f' || event.key === 'F')) {
                // Show search UI
                setIsSearchVisible(true);
                return false; // Prevent xterm.js from processing this event
            }
            
            return true // Allow xterm.js to process other events
        })
        
        // Helper to ensure element is laid out before fitting
        const isReadyForFit = () => {
            const el = termRef.current;
            return !!el && el.isConnected && el.clientWidth > 0 && el.clientHeight > 0;
        };

        // Do an initial fit via RAF once container is measurable
        const scheduleInitialFit = () => {
            requestAnimationFrame(() => {
                if (!isReadyForFit() || !fitAddon.current || !terminal.current) return;
                try {
                    fitAddon.current.fit();
                    requestResize('initial-raf', { immediate: true, force: true });
                } catch {
                    // ignore single-shot fit error; RO will retry
                }
            });
        };
        if (isReadyForFit()) {
            scheduleInitialFit();
        }

        // Terminal streaming is handled by the terminal registry.
        const outputDisposables: IDisposable[] = [];

        if (terminal.current) {
            const renderHandler = (terminal.current as unknown as { onRender?: (cb: () => void) => { dispose?: () => void } | void }).onRender;
            if (typeof renderHandler === 'function') {
                const disposable = renderHandler.call(terminal.current, () => {
                    if (!hydratedRef.current) {
                        hydratedRef.current = true;
                        if (!hydratedOnceRef.current) {
                            hydratedOnceRef.current = true;
                            setHydrated(true);
                            if (onReady) {
                                onReady();
                            }
                        }
                    }

                });
                if (disposable && typeof disposable === 'object' && typeof (disposable as { dispose?: () => void }).dispose === 'function') {
                    outputDisposables.push(disposable as IDisposable);
                }
            }
        }

        void terminalOutputManager.ensureStarted(terminalId).catch(error => {
            logger.warn(`[Terminal ${terminalId}] Failed to ensure terminal stream`, error);
        });

        // Handle font size changes with better debouncing
        let fontSizeRafPending = false;
        const handleFontSizeChange = (ev: Event) => {
            if (!terminal.current) return;

            const detail = (ev as CustomEvent<{ terminalFontSize: number; uiFontSize: number }>).detail;
            const newTerminalFontSize = detail?.terminalFontSize;
            if (typeof newTerminalFontSize === 'number') {
                xtermWrapperRef.current?.updateOptions({ fontSize: newTerminalFontSize });
            }

            if (fontsLoadedRef.current) {
                applyLetterSpacing(gpuEnabledForTerminal);
                refreshGpuFontRendering();
                if (gpuEnabledForTerminal) {
                    void handleFontPreferenceChange();
                }
            } else {
                applyLetterSpacing(false);
            }

            if (fontSizeRafPending) return;
            fontSizeRafPending = true;
            requestAnimationFrame(() => {
                fontSizeRafPending = false;
                if (!fitAddon.current || !terminal.current || !mountedRef.current) return;

                try {
                    fitAddon.current.fit();
                    requestResize('font-size-change', { immediate: true, force: true });
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Font size change fit failed:`, e);
                }
            });
        };

        addEventListener(window, 'font-size-changed', handleFontSizeChange);

     // Send input to backend (disabled for readOnly terminals)
        if (!readOnly) {
            if (onDataDisposableRef.current) {
                try {
                    onDataDisposableRef.current.dispose();
                } catch (error) {
                    logger.debug(`[Terminal ${terminalId}] Failed to dispose previous onData listener`, error);
                }
                onDataDisposableRef.current = null;
            }

            onDataDisposableRef.current = terminal.current.onData((data) => {
                if (finalizeClaudeShiftEnter(data)) {
                    return;
                }
             if (inputFilter && !inputFilter(data)) {
                 if (termDebug()) {
                     logger.debug(`[Terminal ${terminalId}] blocked input: ${JSON.stringify(data)}`);
                 }
                 return;
             }
             
             // Track interrupt signal for agent stop detection
             if (isAgentTopTerminal && data === '\u0003') {
                 lastSigintAtRef.current = Date.now();
                 const platform = detectPlatformSafe()
                 const keyCombo = platform === 'mac' ? 'Cmd+C' : 'Ctrl+C'
                 logger.debug(`[Terminal ${terminalId}] Interrupt signal detected (${keyCombo})`);
             }
             
            writeTerminalBackend(terminalId, data).catch(err => logger.debug('[Terminal] write ignored (backend not ready yet)', err));
            });
        }
        
        // Send initialization sequence to ensure proper terminal mode
        // This helps with arrow key handling in some shells
        requestAnimationFrame(() => {
            if (terminal.current) {
                writeTerminalBackend(terminalId, '').catch(err => logger.debug('[Terminal] init write ignored (backend not ready yet)', err));
            }
        });

        // Handle terminal resize - only send if size actually changed
        const handleResize = () => {
            if (!fitAddon.current || !terminal.current) return;

            const dragging = document.body.classList.contains('is-split-dragging');
            try {
                requestResize('resize-observer', { force: dragging });
            } catch (e) {
                logger.warn(`[Terminal ${terminalId}] resize-observer measurement failed; skipping this tick`, e);
            }
        };

        // Use ResizeObserver with more stable debouncing to prevent jitter
        let roRafPending = false;
        
        addResizeObserver(termRef.current, () => {
            if (roRafPending) return;
            roRafPending = true;
            requestAnimationFrame(() => {
                roRafPending = false;
                handleResize();
            });
        });
        
        // Initial fit: fonts ready + RAF
        (async () => {
            try {
                const fontsReady = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
                if (fontsReady) {
                    await fontsReady;
                }
            } catch (e) {
                logger.debug('[Terminal] fonts.ready unavailable', e);
            } finally {
                requestAnimationFrame(() => handleResize());
            }
        })();

        // After split drag ends, perform a strong fit + resize
        const doFinalFit = () => {
            // After drag ends, run a strong fit on next frame
            try {
                if (fitAddon.current && terminal.current && termRef.current) {
                    requestAnimationFrame(() => {
                        if (!fitAddon.current || !terminal.current) return;

                        try {
                            fitAddon.current.fit();
                        } catch (err) {
                            logger.debug(`[Terminal ${terminalId}] Split-final pre-fit failed`, err);
                        }
                        resizeCoordinatorRef.current?.flush('split-final');
                        requestResize('split-final', { immediate: true, force: true });
                    });
                }
            } catch (error) {
                logger.error(`[Terminal ${terminalId}] Final fit error:`, error);
            }
        };
        addEventListener(window, 'terminal-split-drag-end', doFinalFit);
        addEventListener(window, 'right-panel-split-drag-end', doFinalFit);

        // Cleanup - dispose UI but keep terminal process running
        // Terminal processes will be cleaned up when the app exits
        return () => {
            mountedRef.current = false;
            cancelled = true;
            rendererReadyRef.current = false;

            outputDisposables.forEach(disposable => {
                try {
                    disposable.dispose();
                } catch (error) {
                    logger.debug(`[Terminal ${terminalId}] output disposable cleanup error:`, error);
                }
            });

            try {
                rendererObserver?.disconnect();
            } catch (e) {
                // Already disconnected during initialization, this is expected
                logger.debug(`[Terminal ${terminalId}] Renderer observer already disconnected:`, e);
            }
            try { visibilityObserver?.disconnect(); } catch { /* ignore */ }

            cancelGpuRefreshWorkRef.current?.();

            if (onDataDisposableRef.current) {
                try {
                    onDataDisposableRef.current.dispose();
                } catch (error) {
                    logger.debug(`[Terminal ${terminalId}] onData listener cleanup error:`, error);
                }
                onDataDisposableRef.current = null;
            }

            const isRunTerminal = terminalId.startsWith('run-terminal');
            if (isRunTerminal) {
                releaseTerminalInstance(terminalId);
            } else {
                detachTerminalInstance(terminalId);
            }
            xtermWrapperRef.current = null;
            gpuRenderer.current = null;
            terminal.current = null;
            setHydrated(false);
            hydratedRef.current = false;
            // Note: We intentionally don't close terminals here to allow switching between sessions
            // All terminals are cleaned up when the app exits via the backend cleanup handler
            // useCleanupRegistry handles other cleanup automatically
        };
    }, [
        terminalId,
        addEventListener,
        addResizeObserver,
        agentType,
        isBackground,
        terminalFontSize,
        onReady,
        resolvedFontFamily,
        readOnly,
        requestResize,
        inputFilter,
        isAgentTopTerminal,
        beginClaudeShiftEnter,
        finalizeClaudeShiftEnter,
        refreshGpuFontRendering,
        gpuEnabledForTerminal,
        applyLetterSpacing,
        gpuRenderer,
        handleFontPreferenceChange,
    ]);


     // Automatically start Claude for top terminals when hydrated and first ready
     useEffect(() => {
         if (!hydrated) return;
         if (!terminalId.endsWith('-top')) return;
         if (startedGlobal.has(terminalId)) return;
         if (agentStopped) return;

        const start = async () => {
            if (startingTerminals.current.get(terminalId)) {
                return;
            }
            startingTerminals.current.set(terminalId, true);
            setAgentLoading(true);
            try {
                // Avoid duplicate start if a background-start mark exists for this terminal.
                // IMPORTANT: also CONSUME the mark to prevent the global registry from leaking ids.
                if (hasBackgroundStart(terminalId)) {
                    setAgentLoading(false);
                    startingTerminals.current.set(terminalId, false);
                    try {
                        clearBackgroundStarts([terminalId]);
                        logger.debug(`[Terminal ${terminalId}] Consumed background-start mark.`);
                    } catch (ce) {
                        logger.warn(`[Terminal ${terminalId}] Failed to clear background-start mark:`, ce);
                    }
                    return;
                }
                if (isCommander || (terminalId.includes('orchestrator') && terminalId.endsWith('-top'))) {
                    // OPTIMIZATION: Skip terminal_exists check - trust that hydrated terminals are ready
                     // Mark as started BEFORE invoking to prevent overlaps
                     startedGlobal.add(terminalId);
                      try {
                            // Provide initial size at spawn to avoid early overflow in TUI apps
                            let measured: { cols?: number; rows?: number } | undefined
                            try {
                                if (fitAddon.current && terminal.current) {
                                    fitAddon.current.fit();
                                    const MIN_DIM = 2;
                                    const mCols = Math.max(terminal.current.cols - RIGHT_EDGE_GUARD_COLUMNS, MIN_DIM);
                                    measured = { cols: mCols, rows: terminal.current.rows };
                                }
                            } catch (e) {
                                logger.warn(`[Terminal ${terminalId}] Failed to measure size before orchestrator start:`, e);
                            }
                            logger.info(`[Terminal ${terminalId}] Auto-starting Claude orchestrator at ${new Date().toISOString()}`);
                            await startOrchestratorTop({ terminalId, measured });
                            // Mark that this terminal has been started at least once
                            terminalEverStartedRef.current = true;
                            // OPTIMIZATION: Immediate focus and loading state update (modal-safe)
                            safeTerminalFocusImmediate(() => {
                                terminal.current?.focus();
                            }, isAnyModalOpen);
                            setAgentLoading(false);
                      } catch (e) {
                         // Roll back start flags on failure to allow retry
                         startedGlobal.delete(terminalId);
                         logger.error(`[Terminal ${terminalId}] Failed to start Claude:`, e);
                        
                        // Check if it's a permission error and dispatch event
                        const errorMessage = String(e);
                        if (errorMessage.includes('No project is currently open')) {
                            logger.error(`[Terminal ${terminalId}] No project open:`, errorMessage);
                            emitUiEvent(UiEvent.NoProjectError, { error: errorMessage, terminalId });
                        } else if (errorMessage.includes('Permission required for folder:')) {
                            emitUiEvent(UiEvent.PermissionError, { error: errorMessage });
                        } else if (errorMessage.includes('Failed to spawn command')) {
                            logger.error(`[Terminal ${terminalId}] Spawn failure details:`, errorMessage);
                            emitUiEvent(UiEvent.SpawnError, { error: errorMessage, terminalId });
                        } else if (errorMessage.includes(AGENT_START_TIMEOUT_MESSAGE)) {
                            emitUiEvent(UiEvent.SpawnError, { error: errorMessage, terminalId });
                         } else if (errorMessage.includes('not a git repository')) {
                             logger.error(`[Terminal ${terminalId}] Not a git repository:`, errorMessage);
                             emitUiEvent(UiEvent.NotGitError, { error: errorMessage, terminalId });
                         }
                         throw e;
                     }
                     // OPTIMIZATION: Immediate state reset
                     setAgentLoading(false);
                     startingTerminals.current.set(terminalId, false);
                } else {
                    if (!sessionName) {
                        startingTerminals.current.set(terminalId, false);
                        return;
                    }
                    const expectedId = stableSessionTerminalId(sessionName, 'top');
                    if (expectedId !== terminalId) {
                        startingTerminals.current.set(terminalId, false);
                        setAgentLoading(false);
                        return;
                    }
                    // OPTIMIZATION: Skip session terminal_exists check too
                     // Mark as started BEFORE invoking to prevent overlaps
                     startedGlobal.add(terminalId);
                     try {
                           // Provide initial size for session terminals as well
                           let measured: { cols?: number; rows?: number } | undefined
                           try {
                               if (fitAddon.current && terminal.current) {
                                   fitAddon.current.fit();
                                   const MIN_DIM = 2;
                                   const mCols = Math.max(terminal.current.cols - RIGHT_EDGE_GUARD_COLUMNS, MIN_DIM);
                                   measured = { cols: mCols, rows: terminal.current.rows };
                               }
                           } catch (e) {
                               logger.warn(`[Terminal ${terminalId}] Failed to measure size before session start:`, e);
                           }
                            logger.info(`[Terminal ${terminalId}] Auto-starting Claude (session=${sessionName}) at ${new Date().toISOString()}`);
                            await startSessionTop({ sessionName, topId: terminalId, measured, agentType });
                            // Mark that this terminal has been started at least once
                            terminalEverStartedRef.current = true;
                            // Focus the terminal after Claude starts successfully (modal-safe)
                            requestAnimationFrame(() => {
                                safeTerminalFocus(() => {
                                    terminal.current?.focus();
                                }, isAnyModalOpen)
                            });
                            // Ensure terminal is fully ready before showing it
                            requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                    setAgentLoading(false);
                                });
                            });
                      } catch (e) {
                         // Roll back start flags on failure to allow retry
                         startedGlobal.delete(terminalId);
                         logger.error(`[Terminal ${terminalId}] Failed to start Claude for session ${sessionName}:`, e);
                        
                        // Check if it's a permission error and dispatch event
                        const errorMessage = String(e);
                        if (errorMessage.includes('Permission required for folder:')) {
                            emitUiEvent(UiEvent.PermissionError, { error: errorMessage });
                        } else if (errorMessage.includes(AGENT_START_TIMEOUT_MESSAGE)) {
                            emitUiEvent(UiEvent.SpawnError, { error: errorMessage, terminalId });
                         }
                         throw e;
                     }
                     // OPTIMIZATION: Immediate state reset
                     setAgentLoading(false);
                     startingTerminals.current.set(terminalId, false);
                 }
              } catch (error) {
                  logger.error(`[Terminal ${terminalId}] Failed to auto-start Claude:`, error);
                  // Ensure terminal state is properly reset
                  requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                          setAgentLoading(false);
                      });
                  });
                  startingTerminals.current.set(terminalId, false);
              }
        };

        // Delay a tick to ensure xterm is laid out
        let cancelled = false;
        requestAnimationFrame(() => { if (!cancelled) start(); });
         return () => {
             cancelled = true;
         };
     }, [agentType, hydrated, terminalId, isCommander, sessionName, isAnyModalOpen, agentStopped]);

    useEffect(() => {
        if (!terminal.current || !resolvedFontFamily) {
            return
        }

        if (!fontsFullyLoaded) {
            return;
        }
        try {
            if (terminal.current.options.fontFamily !== resolvedFontFamily) {
                xtermWrapperRef.current?.updateOptions({ fontFamily: resolvedFontFamily })
                if (fitAddon.current) {
                    fitAddon.current.fit()
                    requestResize('font-family', { immediate: true, force: true })
                }
                refreshGpuFontRendering()
            }
        } catch (e) {
            logger.warn(`[Terminal ${terminalId}] Failed to apply font family`, e)
        }
    }, [resolvedFontFamily, terminalId, requestResize, refreshGpuFontRendering, fontsFullyLoaded])

    useEffect(() => {
        if (!resolvedFontFamily) {
            fontsLoadedRef.current = false;
            setFontsFullyLoaded(false);
            applyLetterSpacing(false);
            return;
        }

        fontsLoadedRef.current = false;
        setFontsFullyLoaded(false);
        applyLetterSpacing(false);

        const finalizeFontUpdate = () => {
            fontsLoadedRef.current = true;
            setFontsFullyLoaded(true);
            applyLetterSpacing(gpuEnabledForTerminal);
            if (fontsLoadedRef.current) {
                refreshGpuFontRendering();
                if (gpuEnabledForTerminal) {
                    void handleFontPreferenceChange();
                }
            }
        };

        if (typeof document === 'undefined' || typeof (document as { fonts?: FontFaceSet }).fonts === 'undefined') {
            finalizeFontUpdate()
            return
        }

        let cancelled = false
        const fontsApi = (document as { fonts: FontFaceSet }).fonts
        const loadFonts = async () => {
            const targets: string[] = []
            if (customFontFamily && customFontFamily.trim().length > 0) {
                targets.push(customFontFamily)
            }

            if (targets.length === 0) {
                finalizeFontUpdate()
                return
            }

            const sampleSize = Math.max(terminalFontSize, 12)

            try {
                await Promise.allSettled(
                    targets.map(fontName => {
                        const trimmed = fontName.trim().replace(/"/g, '')
                        const descriptor = `${sampleSize}px "${trimmed}"`
                        return fontsApi.load(descriptor)
                    })
                )
                await fontsApi.ready
            } catch (error) {
                logger.debug(`[Terminal ${terminalId}] Font preload failed for WebGL renderer:`, error)
            } finally {
                if (!cancelled) {
                    finalizeFontUpdate()
                }
            }
        }

        void loadFonts()
        return () => {
            cancelled = true
        }
    }, [
        resolvedFontFamily,
        customFontFamily,
        terminalFontSize,
        refreshGpuFontRendering,
        terminalId,
        gpuEnabledForTerminal,
        applyLetterSpacing,
        handleFontPreferenceChange,
    ])

    useLayoutEffect(() => {
        if (previousTerminalId.current === terminalId) {
            return
        }

    previousTerminalId.current = terminalId
    hydratedOnceRef.current = false
    setHydrated(false)
    hydratedRef.current = false
}, [terminalId]);


    const handleTerminalClick = (event?: React.MouseEvent<HTMLDivElement>) => {
        if (isSearchVisible) {
            const target = event?.target as Node | null;
            if (target instanceof Element && target.closest('[data-terminal-search="true"]')) {
                return;
            }
        }
        // If user is selecting text inside the run terminal, do not steal focus (prevents jump-to-bottom)
        if (agentType === 'run' && (isUserSelectingInTerminal() || suppressNextClickRef.current)) {
            // Reset suppression after consuming it
            suppressNextClickRef.current = false;
            return;
        }
        // Focus the terminal when clicked (modal-safe)
        safeTerminalFocusImmediate(() => {
            terminal.current?.focus()
        }, isAnyModalOpen)
        // Also notify parent about the click to update focus context
        if (onTerminalClick) {
            skipNextFocusCallbackRef.current = true;
            onTerminalClick()
            if (typeof window !== 'undefined') {
                requestAnimationFrame(() => {
                    skipNextFocusCallbackRef.current = false;
                });
            }
        }
    }

    const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
        suppressNextClickRef.current = false;
        dragSelectingRef.current = false;
    };
    const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!mouseDownPosRef.current) return;
        const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
        const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);
        if (dx + dy > 3) {
            suppressNextClickRef.current = true;
            dragSelectingRef.current = true;
        }
    };
    const onMouseUp = () => {
        // Keep suppressNextClickRef until click handler runs; then it resets there
        mouseDownPosRef.current = null;
        requestAnimationFrame(() => {
            selectionActiveRef.current = isUserSelectingInTerminal();
            if (!selectionActiveRef.current) {
                dragSelectingRef.current = false;
            }
        });
    };
    useEffect(() => {
        const handleSelectionChange = () => {
            selectionActiveRef.current = isUserSelectingInTerminal();
            if (!selectionActiveRef.current) {
                dragSelectingRef.current = false;
            }
        };
        document.addEventListener('selectionchange', handleSelectionChange);
        return () => document.removeEventListener('selectionchange', handleSelectionChange);
    }, [isUserSelectingInTerminal]);

    return (
        <div
            ref={containerRef}
            className={`h-full w-full relative overflow-hidden ${className}`}
            onClick={handleTerminalClick}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            data-smartdash-exempt="true"
        >
             <div
                 ref={termRef}
                 className={`h-full w-full overflow-hidden transition-opacity duration-150 ${!hydrated ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
             />
              {isAgentTopTerminal && agentStopped && hydrated && terminalEverStartedRef.current && (
                 <div className="absolute inset-0 flex items-center justify-center z-30">
                     <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700 rounded px-3 py-2 shadow-lg">
                         <span className="text-sm text-slate-300">Agent stopped</span>
                          <button
                              onClick={(e) => { e.stopPropagation(); restartAgent(); }}
                              className="text-sm px-3 py-1 rounded text-white font-medium"
                              style={{
                                  backgroundColor: theme.colors.accent.blue.dark,
                              }}
                              onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = theme.colors.accent.blue.DEFAULT;
                              }}
                              onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = theme.colors.accent.blue.dark;
                              }}
                          >
                             Restart
                         </button>
                     </div>
                 </div>
             )}
             <TerminalLoadingOverlay visible={!hydrated || agentLoading} />
            {/* Search UI opens via keyboard shortcut only (Modifier+F) */}
            {isSearchVisible && (
                <TerminalSearchPanel
                    ref={searchContainerRef}
                    searchTerm={searchTerm}
                    onSearchTermChange={handleSearchTermChange}
                    onFindNext={handleFindNext}
                    onFindPrevious={handleFindPrevious}
                    onClose={handleCloseSearch}
                />
            )}
        </div>
    );
});

TerminalComponent.displayName = 'Terminal';

export const Terminal = memo(TerminalComponent);

Terminal.displayName = 'Terminal';
