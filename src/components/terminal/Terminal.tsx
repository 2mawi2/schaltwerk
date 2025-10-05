import { useEffect, useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback, useMemo, memo } from 'react';
import { TauriCommands } from '../../common/tauriCommands'
import { SchaltEvent, listenEvent, listenTerminalOutput } from '../../common/eventSystem'
import { UiEvent, emitUiEvent, listenUiEvent, hasBackgroundStart, clearBackgroundStarts } from '../../common/uiEvents'
import { recordTerminalSize } from '../../common/terminalSizeCache'
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { invoke } from '@tauri-apps/api/core'
import { startOrchestratorTop, startSessionTop } from '../../common/agentSpawn'
import { schedulePtyResize } from '../../common/ptyResizeScheduler'
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
import { ActiveBufferLike, readScrollState, restoreScrollState, pinBottomDefinitive, type XTermLike } from '../../utils/termScroll'
import { makeAgentQueueConfig, makeDefaultQueueConfig } from '../../utils/terminalQueue'
import { useTerminalWriteQueue } from '../../hooks/useTerminalWriteQueue'
import { TerminalLoadingOverlay } from './TerminalLoadingOverlay'
import { TerminalSearchPanel } from './TerminalSearchPanel'
import {
    writeTerminalBackend,
    resizeTerminalBackend,
    subscribeTerminalBackend,
    ackTerminalBackend,
    isPluginTerminal,
} from '../../terminal/transport/backend'

const DEFAULT_SCROLLBACK_LINES = 10000
const BACKGROUND_SCROLLBACK_LINES = 5000
const AGENT_SCROLLBACK_LINES = 200000
const FAST_HYDRATION_REVEAL_THRESHOLD = 512 * 1024
const RIGHT_EDGE_GUARD_COLUMNS = 2
const CLAUDE_SHIFT_ENTER_SEQUENCE = '\\'
// Track last effective size we told the PTY (after guard), for SIGWINCH nudging
const lastEffectiveRefInit = { cols: 80, rows: 24 }

// Global guard to avoid starting Claude multiple times for the same terminal id across remounts
const startedGlobal = new Set<string>();

// Export function to clear started tracking for specific terminals
export function clearTerminalStartedTracking(terminalIds: string[]) {
    terminalIds.forEach(id => startedGlobal.delete(id));
    clearInflights(terminalIds);
    clearBackgroundStarts(terminalIds);
}

interface TerminalBufferResponse {
    seq: number
    startSeq: number
    data: string
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
    const terminal = useRef<XTerm | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    // Removed initial-fit retry machinery after consolidating fit guards
    const searchAddon = useRef<SearchAddon | null>(null);
    const lastSize = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
    const lastEffectiveRef = useRef<{ cols: number; rows: number }>(lastEffectiveRefInit);
    const [hydrated, setHydrated] = useState(false);
    const [agentLoading, setAgentLoading] = useState(false);
    const [agentStopped, setAgentStopped] = useState(false);
    const terminalEverStartedRef = useRef<boolean>(false);
    const hydratedRef = useRef<boolean>(false);
    const pendingOutput = useRef<string[]>([]);
    const snapshotCursorRef = useRef<number | null>(null);
    const rehydrateScrollRef = useRef<{ atBottom: boolean; y: number } | null>(null);
    const rehydrateSkipAutoScrollRef = useRef<boolean>(false);
    const rehydrateInProgressRef = useRef<boolean>(false);
    const rehydrateHandledRef = useRef<boolean>(false);
    const wasSuspendedRef = useRef<boolean>(false);
    // Tracks user-initiated SIGINT (Ctrl+C) to distinguish from startup/other exits.
    const lastSigintAtRef = useRef<number | null>(null);
    const [overflowEpoch, setOverflowEpoch] = useState(0);
    const overflowNoticesRef = useRef<number[]>([]);
    const overflowReplayNeededRef = useRef<boolean>(false);
    const rehydrateByReasonRef = useRef<((reason: 'resume' | 'overflow') => Promise<'completed' | 'deferred' | 'failed'>) | null>(null);
    const overflowQueuedRef = useRef<boolean>(false);
    const overflowProcessingRef = useRef<boolean>(false);
    const rehydrateInFlightRef = useRef<boolean>(false);
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
    const seqRef = useRef<number>(0);
    const [pluginTransportActive, setPluginTransportActive] = useState(() => isPluginTerminal(terminalId));
    const pluginAckRef = useRef<{ lastSeq: number }>({ lastSeq: 0 });
    const textDecoderRef = useRef<TextDecoder | null>(null);
    const textEncoderRef = useRef<TextEncoder | null>(null);
    const termDebug = () => (typeof window !== 'undefined' && localStorage.getItem('TERMINAL_DEBUG') === '1');
    // No timer-based retries; gate on renderer readiness and microtasks/RAFs
    const unlistenRef = useRef<UnlistenFn | null>(null);
    const resumeUnlistenRef = useRef<UnlistenFn | null>(null);
    const unlistenPromiseRef = useRef<Promise<UnlistenFn> | null>(null);
    const mountedRef = useRef<boolean>(false);
    const startingTerminals = useRef<Map<string, boolean>>(new Map());
    const previousTerminalId = useRef<string>(terminalId);
    const listenerAgentRef = useRef<string | undefined>(agentType);
    const rendererReadyRef = useRef<boolean>(false); // Canvas renderer readiness flag
    const [resolvedFontFamily, setResolvedFontFamily] = useState<string | null>(null);
    // Drag-selection suppression for run terminals
    const suppressNextClickRef = useRef<boolean>(false);
    const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
    const dragSelectingRef = useRef<boolean>(false);
    const selectionActiveRef = useRef<boolean>(false);
    const skipNextFocusCallbackRef = useRef<boolean>(false);

    useEffect(() => {
        const el = termRef.current;
        if (!el) return;

        const handlePaste = (event: ClipboardEvent) => {
            if (readOnly) {
                event.preventDefault();
                return;
            }

            const clipboard = event.clipboardData;
            if (!clipboard) return;

            const items = Array.from(clipboard.items ?? []);
            const hasBinaryPayload = items.some(item => item.kind === 'file' || (item.type && !item.type.startsWith('text/')));
            const plainText = clipboard.getData('text/plain') ?? '';
            const hasHtmlOnly = !plainText && clipboard.types.includes('text/html');

            if (!hasBinaryPayload && !hasHtmlOnly) {
                return;
            }

            event.preventDefault();
            if (!plainText || !terminal.current) {
                return;
            }

            terminal.current.paste(plainText);
        };

        addEventListener(el, 'paste', handlePaste as EventListener, { capture: true });
    }, [addEventListener, readOnly]);

    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            const active = isPluginTerminal(terminalId);
            if (!cancelled) {
                setPluginTransportActive(active);
                if (!active) {
                    pluginAckRef.current.lastSeq = 0;
                }
            }
        };
        refresh();
        let timer: number | undefined;
        if (typeof window !== 'undefined') {
            timer = window.setTimeout(refresh, 0);
        }
        return () => {
            cancelled = true;
            if (typeof window !== 'undefined' && timer !== undefined) {
                window.clearTimeout(timer);
            }
        };
    }, [terminalId]);

    const acknowledgeChunk = useCallback((chunk: string) => {
        if (!pluginTransportActive) return;
        if (typeof TextEncoder === 'undefined') return;
        if (!chunk || chunk.length === 0) return;
        const encoder = textEncoderRef.current ?? new TextEncoder();
        textEncoderRef.current = encoder;
        const bytes = encoder.encode(chunk).length;
        if (bytes === 0) return;
        const seq = pluginAckRef.current.lastSeq;
        ackTerminalBackend(terminalId, seq, bytes).catch(error => {
            logger.debug(`[Terminal ${terminalId}] ack failed`, error);
        });
    }, [pluginTransportActive, terminalId]);

    const scrollToBottomInstant = useCallback(() => {
        if (!terminal.current) return;
        pinBottomDefinitive(terminal.current as unknown as XTermLike);
    }, []);

     // Agent conversation terminal detection reused across sizing logic and scrollback config
     const isAgentTopTerminal = useMemo(() => (
         terminalId.endsWith('-top') && (terminalId.startsWith('session-') || terminalId.startsWith('orchestrator-'))
     ), [terminalId])

     // Initialize agentStopped state from sessionStorage (only for agent top terminals)
     useEffect(() => {
         if (!isAgentTopTerminal) return;
         const key = `schaltwerk:agent-stopped:${terminalId}`;
         setAgentStopped(sessionStorage.getItem(key) === 'true');
     }, [isAgentTopTerminal, terminalId]);

    // Write queue helpers shared across effects (agent terminals get larger buffers)
    const queueCfg = useMemo(() => (
        agentType ? makeAgentQueueConfig() : makeDefaultQueueConfig()
    ), [agentType]);

    const handleOverflow = useCallback((info: { droppedBytes: number }) => {
        overflowNoticesRef.current.push(info.droppedBytes);
        setOverflowEpoch((tick) => tick + 1);
        logger.warn(`[Terminal ${terminalId}] Write queue overflow dropped ${info.droppedBytes}B`);
    }, [terminalId]);

    const {
        enqueue: enqueueQueue,
        flushPending: flushQueuePending,
        reset: resetQueue,
        stats: getQueueStats,
    } = useTerminalWriteQueue({
        queueConfig: queueCfg,
        logger,
        onOverflow: handleOverflow,
        debugTag: terminalId,
    });

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
            return true;
        }

        recordTerminalSize(terminalId, effectiveCols, rows);
        schedulePtyResize(terminalId, { cols: effectiveCols, rows });
        lastEffectiveRef.current = { cols: effectiveCols, rows };
        return true;
    }, [terminalId, isAgentTopTerminal]);

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

    const shouldAutoScroll = useCallback((wasAtBottom: boolean) => {
        if (rehydrateSkipAutoScrollRef.current) {
            if (wasAtBottom) {
                rehydrateSkipAutoScrollRef.current = false;
            } else {
                return false;
            }
        }
        if (!wasAtBottom) return false;
        if (rehydrateScrollRef.current && !rehydrateScrollRef.current.atBottom) return false;
        if (isUserSelectingInTerminal()) return false;
        return true;
    }, [isUserSelectingInTerminal]);

    const applyPostHydrationScroll = useCallback((phase: 'success' | 'failure') => {
        if (!terminal.current) {
            rehydrateScrollRef.current = null;
            return;
        }

        const saved = rehydrateScrollRef.current;
        rehydrateScrollRef.current = null;

        if (rehydrateInProgressRef.current && !saved) {
            rehydrateInProgressRef.current = false;
            return;
        }

        if (!saved && rehydrateHandledRef.current) {
            rehydrateHandledRef.current = false;
            return;
        }

        try {
            if (!saved || saved.atBottom) {
                pinBottomDefinitive(terminal.current as unknown as XTermLike);
                rehydrateSkipAutoScrollRef.current = false;
            } else {
                restoreScrollState(terminal.current as unknown as XTermLike, saved);
                rehydrateSkipAutoScrollRef.current = true;
            }
        } catch (error) {
            logger.warn(`[Terminal ${terminalId}] Failed to apply scroll after hydration ${phase}:`, error);
        }

        rehydrateHandledRef.current = Boolean(saved);
        rehydrateInProgressRef.current = false;
    }, [terminalId]);

    const enqueueWrite = useCallback((data: string) => {
        if (data.length === 0) return;
        enqueueQueue(data);
        if (termDebug()) {
            const { queueLength } = getQueueStats();
            logger.debug(`[Terminal ${terminalId}] enqueue +${data.length}B qlen=${queueLength}`);
        }
    }, [enqueueQueue, getQueueStats, terminalId]);

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
                 await startSessionTop({ sessionName, topId: terminalId, measured });
             }
             setAgentStopped(false);
         } catch (e) {
             logger.error(`[Terminal ${terminalId}] Restart failed:`, e);
             // Keep banner up so user can retry
             setAgentStopped(true);
         } finally {
             setAgentLoading(false);
         }
     }, [isAgentTopTerminal, isCommander, sessionName, terminalId]);

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

    // Keep hydratedRef in sync so listeners see the latest state
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
                const chain = buildTerminalFontFamily(settings?.fontFamily ?? null)
                if (mounted) setResolvedFontFamily(chain)
            } catch (err) {
                logger.warn('[Terminal] Failed to load terminal settings for font family', err)
                const chain = buildTerminalFontFamily(null)
                if (mounted) setResolvedFontFamily(chain)
            }
        }
        load()
        return () => { mounted = false }
    }, [])

    useEffect(() => {
        const cleanup = listenUiEvent(UiEvent.TerminalFontUpdated, detail => {
            const custom = detail.fontFamily ?? null
            const chain = buildTerminalFontFamily(custom)
            setResolvedFontFamily(chain)
        })
        return cleanup
    }, [])

     // Listen for Claude auto-start events to prevent double-starting
     useEffect(() => {
         let unlistenClaudeStarted: UnlistenFn | null = null;

         const setupListener = async () => {
             try {
                 unlistenClaudeStarted = await listenEvent(SchaltEvent.ClaudeStarted, (payload) => {
                     logger.info(`[Terminal] Received claude-started event for ${payload.terminal_id}`);

                     // Mark the terminal as started globally to prevent auto-start
                     startedGlobal.add(payload.terminal_id);

                      // Clear stopped flag if agent started by any means
                      if (payload?.terminal_id === terminalId) {
                          sessionStorage.removeItem(`schaltwerk:agent-stopped:${terminalId}`);
                          setAgentStopped(false);
                          terminalEverStartedRef.current = true;
                      }
                 });
             } catch (e) {
                 logger.error('[Terminal] Failed to set up claude-started listener:', e);
             }
         };

         setupListener();

         return () => {
             if (unlistenClaudeStarted) {
                 unlistenClaudeStarted();
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
                      
                      // Only show banner if there's a recent SIGINT (user Ctrl+C) and terminal has actually started
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
            if (!fitAddon.current || !terminal.current || !termRef.current) return;
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
                    fitAddon.current!.fit();
                    const { cols, rows } = terminal.current!;
                    // Always notify PTY to nudge the TUI even if equal (OpenCode can need explicit resize)
                    applySizeUpdate(cols, rows, 'opencode-search', true);
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
    }, [agentType, isBackground, terminalId, sessionName, isCommander, applySizeUpdate]);

    // Listen for session-switching animation completion for OpenCode
    useEffect(() => {
        const handleSessionSwitchAnimationEnd = () => {
            if (agentType !== 'opencode' || isBackground) return;

            // Check if session-switching class was removed (animation finished)
            if (!document.body.classList.contains('session-switching')) {
                const doFitAndNotify = () => {
                    try {
                        if (!fitAddon.current || !terminal.current || !termRef.current) return;
                        const el = termRef.current;
                        if (!el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;

                        fitAddon.current!.fit();
                        const { cols, rows } = terminal.current!;
                        applySizeUpdate(cols, rows, 'opencode-session-switch', true);
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
    }, [agentType, isBackground, terminalId, applySizeUpdate]);

    // Deterministic refit on session switch specifically for OpenCode
    useEffect(() => {
        const handleSelectionResize = (detail?: { kind?: 'session' | 'orchestrator'; sessionId?: string }) => {
            if (agentType !== 'opencode' || isBackground) return;
            if (detail?.kind === 'session') {
                if (!sessionName || detail.sessionId !== sessionName) return;
            } else if (detail?.kind === 'orchestrator') {
                if (!isCommander) return;
            }

            if (!fitAddon.current || !terminal.current || !termRef.current) return;
            if (!termRef.current.isConnected) return;

            const run = () => {
                try {
                    if (!fitAddon.current || !terminal.current || !termRef.current) return;
                    fitAddon.current.fit();
                    const { cols, rows } = terminal.current;
                    // Use strong recompute to mirror initialization
                    // Force=true to bypass thrash guards on selection events
                    const MIN_DIM = 2;
                    const effectiveCols = Math.max(cols - RIGHT_EDGE_GUARD_COLUMNS, MIN_DIM);
                    try { terminal.current.resize(effectiveCols, rows); } catch (e) { logger.debug(`[Terminal ${terminalId}] frontend resize failed during opencode-selection`, e) }
                    recordTerminalSize(terminalId, effectiveCols, rows);
                    resizeTerminalBackend(terminalId, effectiveCols, rows).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
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
    }, [agentType, isBackground, terminalId, sessionName, isCommander, applySizeUpdate]);

    // Generic, agent-agnostic terminal resize request listener (reuse applySizeUpdate; two-pass fit)
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ target: 'session' | 'orchestrator' | 'all'; sessionId?: string }>).detail
            const sanitize = (s?: string) => (s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')
            // Determine if this terminal should react
            let shouldHandle = false
            if (!detail || detail.target === 'all') {
                shouldHandle = true
            } else if (detail.target === 'orchestrator') {
                shouldHandle = terminalId.startsWith('orchestrator-')
            } else if (detail.target === 'session') {
                if (detail.sessionId) {
                    const prefix = `session-${sanitize(detail.sessionId)}-`
                    shouldHandle = terminalId.startsWith(prefix)
                }
            }

            if (!shouldHandle) return
            // Avoid hammering while the user drags splitters
            if (document.body.classList.contains('is-split-dragging')) return

            try {
                if (!fitAddon.current || !terminal.current || !termRef.current) return
                if (!termRef.current.isConnected) return
                // Pass 1: fit now
                fitAddon.current.fit()
                let { cols, rows } = terminal.current
                applySizeUpdate(cols, rows, 'generic-resize-request:raf1', true)
                // Pass 2: fit again on next frame (layout/scrollbar settles)
                requestAnimationFrame(() => {
                    try {
                        if (!fitAddon.current || !terminal.current || !termRef.current || !termRef.current.isConnected) return
                        fitAddon.current.fit()
                        const m = terminal.current
                        applySizeUpdate(m.cols, m.rows, 'generic-resize-request:raf2', true)
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
    }, [terminalId, applySizeUpdate])

    useEffect(() => {
        mountedRef.current = true;
        let cancelled = false;
        const ackState = pluginAckRef.current;
        // track mounted lifecycle only; no timer-based logic tied to mount time
        if (!termRef.current) {
            logger.error(`[Terminal ${terminalId}] No ref available!`);
            return;
        }

        setHydrated(false);
        hydratedRef.current = false;
        pendingOutput.current = [];
        resetQueue();

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

        terminal.current = new XTerm({
            theme: {
                background: theme.colors.background.secondary,
                foreground: theme.colors.text.primary,
                cursor: theme.colors.text.primary,
                cursorAccent: theme.colors.background.secondary,
                black: theme.colors.background.elevated,
                red: theme.colors.accent.red.DEFAULT,
                green: theme.colors.accent.green.DEFAULT,
                yellow: theme.colors.accent.yellow.DEFAULT,
                blue: theme.colors.accent.blue.DEFAULT,
                magenta: theme.colors.accent.purple.DEFAULT,
                cyan: theme.colors.accent.cyan.DEFAULT,
                white: theme.colors.text.primary,
                brightBlack: theme.colors.background.hover,
                brightRed: theme.colors.accent.red.light,
                brightGreen: theme.colors.accent.green.light,
                brightYellow: theme.colors.accent.yellow.light,
                brightBlue: theme.colors.accent.blue.light,
                brightMagenta: theme.colors.accent.purple.light,
                brightCyan: theme.colors.accent.cyan.light,
                brightWhite: theme.colors.text.primary,
            },
            fontFamily: resolvedFontFamily || 'Menlo, Monaco, ui-monospace, SFMono-Regular, monospace',
            fontSize: terminalFontSize,
            cursorBlink: true,
            cursorStyle: 'block',
            cursorInactiveStyle: 'outline',
            scrollback: scrollbackLines,
            smoothScrollDuration: 0,
            // Important: Keep TUI control sequences intact (e.g., emitted by agent CLIs)
            // Converting EOLs breaks carriage-return based updates and causes visual jumping
            convertEol: false,
            disableStdin: readOnly,
        });

        // Add fit addon for proper sizing
        fitAddon.current = new FitAddon();
        terminal.current.loadAddon(fitAddon.current);
        
        // Add search addon
        searchAddon.current = new SearchAddon();
        terminal.current.loadAddon(searchAddon.current);
        
        // Open terminal to DOM first
        terminal.current.open(termRef.current);
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
                const { cols, rows } = terminal.current;
                applySizeUpdate(cols, rows, 'initial-fit');
                logger.info(`[Terminal ${terminalId}] Initial fit: ${cols}x${rows} (container: ${containerWidth}x${containerHeight})`);
            } catch (e) {
                logger.warn(`[Terminal ${terminalId}] Initial fit failed:`, e);
            }
        };
        
        performInitialFit();
        
        // Add OSC handler to prevent color query responses from showing up in terminal
        terminal.current.parser.registerOscHandler(10, () => true); // foreground color
        terminal.current.parser.registerOscHandler(11, () => true); // background color
        terminal.current.parser.registerOscHandler(12, () => true); // cursor color
        terminal.current.parser.registerOscHandler(13, () => true); // mouse foreground color
        terminal.current.parser.registerOscHandler(14, () => true); // mouse background color
        terminal.current.parser.registerOscHandler(15, () => true); // Tek foreground color
        terminal.current.parser.registerOscHandler(16, () => true); // Tek background color
        terminal.current.parser.registerOscHandler(17, () => true); // highlight background color
        terminal.current.parser.registerOscHandler(19, () => true); // highlight foreground color
        
        // Initialize terminal with Canvas renderer (default xterm.js renderer)
        let rendererInitialized = false;
        const initializeRenderer = () => {
            if (rendererInitialized || cancelled || !terminal.current || !termRef.current) {
                return;
            }
            
            // Only initialize when container has proper dimensions
            if (termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
                rendererInitialized = true;
                try {
                    // Ensure terminal is properly fitted
                        if (fitAddon.current && terminal.current) {
                            fitAddon.current.fit();
                            // Immediately propagate initial size once measurable
                            try {
                                const { cols, rows } = terminal.current;
                                applySizeUpdate(cols, rows, 'renderer-init');
                            } catch (e) {
                                logger.warn(`[Terminal ${terminalId}] Early initial resize failed:`, e);
                            }
                        }
                    
                    // Mark renderer as ready immediately (Canvas renderer is always ready)
                    rendererReadyRef.current = true;
                    
                    // After initialization, trigger a proper resize to ensure correct dimensions
                    requestAnimationFrame(() => {
                        if (fitAddon.current && terminal.current) {
                            try {
                                fitAddon.current.fit();
                                const { cols, rows } = terminal.current;
                                applySizeUpdate(cols, rows, 'post-init');
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
                    const { cols, rows } = terminal.current;
                    applySizeUpdate(cols, rows, 'visibility');
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
                void writeTerminalBackend(terminalId, CLAUDE_SHIFT_ENTER_SEQUENCE)
                    .catch(err => logger.debug('[Terminal] quick-escape prefix ignored (backend not ready yet)', err));
                return true
            }
            
            // Cmd+Enter for new line (like Claude Code)
            if (modifierKey && event.key === 'Enter' && event.type === 'keydown') {
                // Send a newline character without submitting the command
                // This allows multiline input in shells that support it
                writeTerminalBackend(terminalId, '\n').catch(err => logger.debug('[Terminal] newline ignored (backend not ready yet)', err));
                return false; // Prevent default Enter behavior
            }
            // Prefer Shift+Cmd/Ctrl+N as "New spec"
            if (modifierKey && event.shiftKey && (event.key === 'n' || event.key === 'N')) {
                emitUiEvent(UiEvent.NewSpecRequest)
                return false
            }
            // Plain Cmd/Ctrl+N opens the regular new session modal
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
                    const { cols, rows } = terminal.current;
                    applySizeUpdate(cols, rows, 'initial-raf');
                } catch {
                    // ignore single-shot fit error; RO will retry
                }
            });
        };
        if (isReadyForFit()) {
            scheduleInitialFit();
        }

        // Defer initial resize until we have a real fit with measurable container


        const scheduleFlush = () => {
            if (!rendererReadyRef.current || !terminal.current) return;
            if (getQueueStats().queueLength === 0) return;

            flushQueuePending((chunk) => {
                if (!rendererReadyRef.current || !terminal.current) {
                    return false;
                }

                const buffer = terminal.current.buffer.active as unknown as ActiveBufferLike & { viewportY?: number; baseY?: number };
                const wasAtBottom = (buffer?.viewportY != null && buffer?.baseY != null)
                    ? buffer.viewportY === buffer.baseY
                    : false;

                if (termDebug()) {
                    const { queueLength } = getQueueStats();
                    logger.debug(`[Terminal ${terminalId}] flush: bytes=${chunk.length} wasAtBottom=${wasAtBottom} qlen=${queueLength}`);
                }

                try {
                    terminal.current.write(chunk, () => {
                        try {
                            if (shouldAutoScroll(wasAtBottom)) {
                                scrollToBottomInstant();
                            }
                        } catch (error) {
                            logger.debug('Scroll error during terminal output (cb)', error);
                        }

                        acknowledgeChunk(chunk);
                        if (getQueueStats().queueLength > 0) {
                            scheduleFlush();
                        }
                    });
                } catch (error) {
                    logger.debug('xterm write failed in scheduleFlush', error);
                    return false;
                }

                return true;
            });
        };

        // Immediate flush helper (no debounce), used during hydration transitions
        const flushNow = () => {
            if (!rendererReadyRef.current || !terminal.current) return;
            if (getQueueStats().queueLength === 0) return;

            flushQueuePending((chunk) => {
                if (!rendererReadyRef.current || !terminal.current) {
                    return false;
                }

                const buffer = terminal.current.buffer.active as unknown as ActiveBufferLike & { viewportY?: number; baseY?: number };
                const wasAtBottom = (buffer?.viewportY != null && buffer?.baseY != null)
                    ? buffer.viewportY === buffer.baseY
                    : false;

                if (termDebug()) {
                    logger.debug(`[Terminal ${terminalId}] flushNow: bytes=${chunk.length} wasAtBottom=${wasAtBottom}`);
                }

                try {
                    terminal.current.write(chunk, () => {
                        try {
                            if (shouldAutoScroll(wasAtBottom)) {
                                scrollToBottomInstant();
                            }
                        } catch (error) {
                            logger.debug('Scroll error during buffer flush (cb)', error);
                        } finally {
                            acknowledgeChunk(chunk);
                            if (getQueueStats().queueLength > 0) {
                                queueMicrotask(() => flushNow());
                            }
                        }
                    });
                } catch (error) {
                    logger.debug('xterm write failed in flushNow', error);
                    return false;
                }

                return true;
            }, { immediate: true });
        };

        const flushStreamingDecoder = () => {
            const decoder = textDecoderRef.current;
            if (!decoder) return;
            try {
                const tail = decoder.decode(new Uint8Array(0), { stream: false });
                if (tail && tail.length > 0) {
                    if (!hydratedRef.current) {
                        pendingOutput.current.push(tail);
                    } else {
                        enqueueWrite(tail);
                        scheduleFlush();
                    }
                }
            } catch (error) {
                logger.debug(`[Terminal ${terminalId}] decoder flush failed`, error);
            }
            textDecoderRef.current = null;
        };

        // Promise-based drain used only during initial hydration to guarantee "all content applied" before reveal
        const flushAllNowAsync = async (): Promise<void> => {
            // Loop until renderer ready, queue empty, and no pending outputs remain
            // We purposely avoid timeouts and use RAF + xterm write callbacks for determinism
            // 1) Wait for renderer
            if (!rendererReadyRef.current) {
                await new Promise<void>((resolve) => {
                    const tick = () => {
                        if (!mountedRef.current) return resolve();
                        if (rendererReadyRef.current) return resolve();
                        requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                });
            }

            // 2) Move any pendingOutput into the write queue first
            if (pendingOutput.current.length > 0) {
                for (const output of pendingOutput.current) enqueueWrite(output);
                pendingOutput.current = [];
            }

            // 3) Drain queue to empty using write callbacks
            if (!terminal.current) return;
            await new Promise<void>((resolve) => {
                const step = () => {
                    if (!mountedRef.current || !terminal.current) return resolve();
                    if (getQueueStats().queueLength === 0) {
                        // Double-check no new pending arrived mid-drain; if so, loop again
                        if (pendingOutput.current.length > 0) {
                            for (const output of pendingOutput.current) enqueueWrite(output);
                            pendingOutput.current = [];
                            // Continue draining
                        } else {
                            return resolve();
                        }
                    }

                    // Write one chunk synchronously and continue on its callback
                    let chunkProcessed = false;
                    flushQueuePending((chunk) => {
                        chunkProcessed = chunk.length > 0;
                        if (!terminal.current) {
                            return false;
                        }

                        try {
                            terminal.current.write(chunk, () => {
                                acknowledgeChunk(chunk);
                                queueMicrotask(step);
                            });
                        } catch (error) {
                            logger.debug('xterm write failed in flushAllNowAsync', error);
                            return false;
                        }

                        return true;
                    }, { immediate: true });

                    if (!chunkProcessed) {
                        // No chunk processed (e.g., queue emptied during callbacks). Re-evaluate on next tick.
                        queueMicrotask(step);
                    }
                };
                step();
            });
        };

        // Listen for terminal output from backend (buffer until hydrated)
        unlistenRef.current = null;
        const attachListener = async () => {
            if (pluginTransportActive) {
                const unsubscribe = await subscribeTerminalBackend(
                    terminalId,
                    snapshotCursorRef.current ?? 0,
                    (message) => {
                        if (cancelled) return;
                        if (!pluginTransportActive) return;

                        const decoder = textDecoderRef.current ?? (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : null);
                        if (!decoder) {
                            logger.warn('[Terminal] TextDecoder unavailable; dropping PTY chunk');
                            return;
                        }
                        textDecoderRef.current = decoder;

                        pluginAckRef.current.lastSeq = message.seq;
                        snapshotCursorRef.current = message.seq;

                        const output = decoder.decode(message.bytes, { stream: true });

                        if (output.length === 0) {
                            return;
                        }

                        if (termDebug()) {
                            const n = ++seqRef.current;
                            const { queueLength } = getQueueStats();
                            logger.debug(`[Terminal ${terminalId}] recv(plugin) #${n} +${message.bytes.length}B qlen=${queueLength}`);
                        }

                        if (!hydratedRef.current) {
                            pendingOutput.current.push(output);
                        } else {
                            enqueueWrite(output);
                            scheduleFlush();
                        }
                    },
                );

                const unlisten: UnlistenFn = () => {
                    flushStreamingDecoder();
                    try {
                        const result = unsubscribe?.() as unknown;
                        if (result instanceof Promise) {
                            (result as Promise<void>).catch((error) => logger.debug('[Terminal] plugin unsubscribe failed', error));
                        }
                    } catch (error) {
                        logger.debug('[Terminal] plugin unsubscribe failed', error);
                    }
                };
                unlistenRef.current = unlisten;
                return unlisten;
            }

            const unlisten = await listenTerminalOutput(terminalId, (output) => {
                if (termDebug()) {
                    const n = ++seqRef.current;
                    const { queueLength } = getQueueStats();
                    logger.debug(`[Terminal ${terminalId}] recv #${n} +${(output?.length ?? 0)}B qlen=${queueLength}`);
                }
                if (cancelled) return;
                if (!hydratedRef.current) {
                    pendingOutput.current.push(output);
                } else {
                    enqueueWrite(output);
                    scheduleFlush();
                }
            });
            unlistenRef.current = unlisten;
            return unlisten;
        };
        unlistenPromiseRef.current = attachListener();
        listenerAgentRef.current = agentType;

        // Hydrate from buffer
        const hydrateTerminal = async () => {
            const hydrateStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            try {
                // Ensure listener is attached before snapshot so there is zero gap
                try {
                    await unlistenPromiseRef.current;
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Listener attach awaited with error (continuing):`, e);
                }
                logger.info(`[Terminal ${terminalId}] Hydration started (plugin=${pluginTransportActive})`);
                let snapshotBytes = 0;
                if (!pluginTransportActive) {
                    const snapshot = await invoke<TerminalBufferResponse>(TauriCommands.GetTerminalBuffer, {
                        id: terminalId,
                        from_seq: snapshotCursorRef.current ?? null,
                    });

                    snapshotCursorRef.current = snapshot.seq;

                    if (snapshot.data) {
                        enqueueWrite(snapshot.data);
                        snapshotBytes = snapshot.data.length;
                    }
                }
                // Queue any pending output that arrived during hydration
                if (pendingOutput.current.length > 0) {
                    for (const output of pendingOutput.current) {
                        enqueueWrite(output);
                    }
                    pendingOutput.current = [];
                }

                const markHydrated = (reason: 'fast' | 'post-flush') => {
                    if (hydratedRef.current) return;
                    setHydrated(true);
                    hydratedRef.current = true;
                    logger.info(`[Terminal ${terminalId}] Hydration revealed via ${reason}`);
                    if (onReady) {
                        onReady();
                    }
                };

                const shouldRevealEarly = snapshotBytes >= FAST_HYDRATION_REVEAL_THRESHOLD || startedGlobal.has(terminalId);
                if (shouldRevealEarly) {
                    markHydrated('fast');
                }

                // Drain all queued content before running post-hydration sizing/scrolling work
                await flushAllNowAsync();

                if (!shouldRevealEarly) {
                    markHydrated('post-flush');
                }

                const hydrateElapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - hydrateStart;
                logger.info(
                    `[Terminal ${terminalId}] Hydration completed (snapshot=${snapshotBytes}B, early=${shouldRevealEarly}) in ${hydrateElapsed.toFixed(1)}ms`
                );
                  
                  // After hydration, ensure a definitive fit+resize once layout/fonts are ready
                  const doHydrationFit = () => {
                      if (!fitAddon.current || !terminal.current || !termRef.current) return;
                      const el = termRef.current;
                      if (!el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;
                      try {
                          fitAddon.current.fit();
                          const { cols, rows } = terminal.current;
                          applySizeUpdate(cols, rows, 'hydration');
                      } catch (e) {
                          // Non-fatal; ResizeObserver and later events will correct
                          logger.warn(`[Terminal ${terminalId}] Hydration fit failed:`, e);
                      }
                  };
                  // Run on next frame, then after fonts are ready (if supported)
                  requestAnimationFrame(() => {
                      doHydrationFit();
                      // Use Font Loading API if available to ensure accurate cell metrics
                      try {
                          const fontsReady: Promise<FontFaceSet> | undefined = (document as Document & { fonts?: { ready?: Promise<FontFaceSet> } }).fonts?.ready;
                          if (fontsReady && typeof fontsReady.then === 'function') {
                              fontsReady.then(() => {
                                  requestAnimationFrame(() => doHydrationFit());
                              }).catch(error => {
                                  logger.warn('Font readiness check failed:', error)
                              });
                          }
                      } catch (error) {
                          logger.warn('Error during terminal hydration fit:', error)
                      }
                  });

                  // Scroll to bottom after hydration to show latest content (Codex: then tighten once)
                  requestAnimationFrame(() => {
                      applyPostHydrationScroll('success');
                  });

                  // Emit terminal ready event for focus management after we've fully flushed and fitted
                  if (typeof window !== 'undefined') {
                      emitUiEvent(UiEvent.TerminalReady, { terminalId });
                 }
                
        } catch (error) {
            logger.error(`[Terminal ${terminalId}] Failed to hydrate:`, error);
            // On failure, still shift to live streaming and flush any buffered output to avoid drops
            setHydrated(true);
            hydratedRef.current = true;
                if (pendingOutput.current.length > 0) {
                    for (const output of pendingOutput.current) {
                        enqueueWrite(output);
                    }
                    pendingOutput.current = [];
                    // Flush immediately; subsequent events will be batched
                    flushNow();
                    
                    // Scroll to bottom even on hydration failure
                    requestAnimationFrame(() => {
                        applyPostHydrationScroll('failure');
                    });
                }
            }
        };


        const forceRehydrate = async (reason: 'resume' | 'overflow'): Promise<'completed' | 'deferred' | 'failed'> => {
            if (!mountedRef.current) {
                return 'deferred';
            }

            if (rehydrateInFlightRef.current) {
                logger.debug(`[Terminal ${terminalId}] Skipping ${reason} rehydrate; already in progress`);
                if (reason === 'overflow') {
                    overflowReplayNeededRef.current = true;
                }
                return 'deferred';
            }

            rehydrateInFlightRef.current = true;
            try {
                if (reason === 'resume') {
                    const sawSuspension = wasSuspendedRef.current;
                    wasSuspendedRef.current = false;
                    logger.debug(`[Terminal ${terminalId}] rehydrate(${reason}) called, previouslySuspended=${sawSuspension}`);
                    if (!sawSuspension) {
                        logger.debug(`[Terminal ${terminalId}] Proceeding with resume hydration despite missing suspend event`);
                    }
                } else {
                    logger.info(`[Terminal ${terminalId}] Rehydrating after write queue overflow`);
                }

                logger.debug(`[Terminal ${terminalId}] Starting rehydration - CLEARING TERMINAL`);
                if (reason !== 'resume' || !rehydrateScrollRef.current) {
                    if (terminal.current) {
                        rehydrateScrollRef.current = readScrollState(terminal.current as unknown as XTermLike);
                    } else {
                        rehydrateScrollRef.current = { atBottom: true, y: 0 };
                    }
                }
                const snapshotBefore = rehydrateScrollRef.current;
                rehydrateSkipAutoScrollRef.current = snapshotBefore ? !snapshotBefore.atBottom : false;
                rehydrateHandledRef.current = false;
                rehydrateInProgressRef.current = true;
                pendingOutput.current = [];
                resetQueue();
                if (terminal.current) {
                    try {
                        terminal.current.reset();
                        logger.debug(`[Terminal ${terminalId}] Terminal reset complete`);
                    } catch (error) {
                        logger.warn(`[Terminal ${terminalId}] Failed to reset terminal before ${reason}:`, error);
                    }
                }
                setHydrated(false);
                hydratedRef.current = false;
                snapshotCursorRef.current = null;
                await hydrateTerminal();
                logger.debug(`[Terminal ${terminalId}] Rehydration (${reason}) complete`);
                return 'completed';
            } catch (error) {
                logger.error(`[Terminal ${terminalId}] Failed to rehydrate after ${reason}:`, error);
                if (reason === 'overflow') {
                    overflowReplayNeededRef.current = true;
                }
                rehydrateInProgressRef.current = false;
                return 'failed';
            } finally {
                rehydrateInFlightRef.current = false;
                if (overflowReplayNeededRef.current) {
                    overflowReplayNeededRef.current = false;
                    if (overflowNoticesRef.current.length > 0) {
                        overflowQueuedRef.current = true;
                        setOverflowEpoch((tick) => tick + 1);
                    }
                }
            }
        }

        rehydrateByReasonRef.current = forceRehydrate;

        const attachResumeListener = async () => {
            try {
                const unlisten = await listenEvent(SchaltEvent.TerminalResumed, (payload) => {
                    if (payload?.terminal_id !== terminalId) return
                    forceRehydrate('resume')
                        .then((result) => {
                            if (result === 'failed') {
                                logger.warn(`[Terminal ${terminalId}] Resume rehydrate reported failure`)
                            }
                        })
                        .catch(err => logger.error(`[Terminal ${terminalId}] Resume hydration failed:`, err))
                })
                resumeUnlistenRef.current = unlisten
            } catch (error) {
                logger.warn(`[Terminal ${terminalId}] Failed to attach resume listener`, error)
            }
        }

        let suspendUnlisten: UnlistenFn | null = null
        const attachSuspendListener = async () => {
            try {
                suspendUnlisten = await listenEvent(SchaltEvent.TerminalSuspended, (payload) => {
                    if (payload?.terminal_id !== terminalId) return
                    wasSuspendedRef.current = true
                    if (!rehydrateScrollRef.current && terminal.current) {
                        rehydrateScrollRef.current = readScrollState(terminal.current as unknown as XTermLike);
                    }
                    logger.debug(`[Terminal ${terminalId}] Marked as suspended`)
                })
            } catch (error) {
                logger.warn(`[Terminal ${terminalId}] Failed to attach suspend listener`, error)
            }
        }

        attachResumeListener()
        attachSuspendListener()
        hydrateTerminal();

        // Handle font size changes with better debouncing
        let fontSizeRafPending = false;
        const handleFontSizeChange = (ev: Event) => {
            if (!terminal.current) return;

            const detail = (ev as CustomEvent<{ terminalFontSize: number; uiFontSize: number }>).detail;
            const newTerminalFontSize = detail?.terminalFontSize;
            if (typeof newTerminalFontSize === 'number') {
                terminal.current.options.fontSize = newTerminalFontSize;
            }

            if (fontSizeRafPending) return;
            fontSizeRafPending = true;
            requestAnimationFrame(() => {
                fontSizeRafPending = false;
                if (!fitAddon.current || !terminal.current || !mountedRef.current) return;

                const { atBottom } = readScrollState(terminal.current as unknown as XTermLike);

                try {
                    fitAddon.current.fit();
                    const { cols, rows } = terminal.current;

                    const isUILayoutChange = document.body.classList.contains('session-switching');
                    if (atBottom && !isUILayoutChange && !isUserSelectingInTerminal()) {
                        requestAnimationFrame(() => {
                            if (!terminal.current) return
                            pinBottomDefinitive(terminal.current as unknown as XTermLike);
                        });
                    }

                    applySizeUpdate(cols, rows, 'font-size-change');
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Font size change fit failed:`, e);
                }
            });
        };

        addEventListener(window, 'font-size-changed', handleFontSizeChange);

     // Send input to backend (disabled for readOnly terminals)
     if (!readOnly) {
         terminal.current.onData((data) => {
             if (inputFilter && !inputFilter(data)) {
                 if (termDebug()) {
                     logger.debug(`[Terminal ${terminalId}] blocked input: ${JSON.stringify(data)}`);
                 }
                 return;
             }
             
             // Track SIGINT (Ctrl+C) for agent stop detection
             if (isAgentTopTerminal && data === '\u0003') {
                 lastSigintAtRef.current = Date.now();
                 logger.debug(`[Terminal ${terminalId}] SIGINT detected (Ctrl+C)`);
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

            const el = termRef.current;
            if (!el || !el.isConnected) {
                return;
            }

            try {
                fitAddon.current.fit();
                const { cols, rows } = terminal.current;
                const dragging = document.body.classList.contains('is-split-dragging');
                applySizeUpdate(cols, rows, 'resize-observer', dragging);
            } catch (e) {
                logger.warn(`[Terminal ${terminalId}] fit() failed during resize; skipping this tick`, e);
                return;
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

                        const { atBottom } = readScrollState(terminal.current as unknown as XTermLike);

                        fitAddon.current.fit();
                        const { cols, rows } = terminal.current;

                        const isUILayoutChange = document.body.classList.contains('session-switching');
                        if (atBottom && !isUILayoutChange) {
                            requestAnimationFrame(() => {
                                if (!terminal.current) return
                                pinBottomDefinitive(terminal.current as unknown as XTermLike);
                            });
                       }

                        applySizeUpdate(cols, rows, 'split-final');
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
            rehydrateByReasonRef.current = null;
            cancelled = true;
            rendererReadyRef.current = false;
            flushStreamingDecoder();
            textDecoderRef.current = null;
            textEncoderRef.current = null;
            ackState.lastSeq = 0;
            
            // no timers to clear

            // Synchronously detach if possible to avoid races in tests
            const fn = unlistenRef.current;
            if (fn) { try { fn(); } catch (error) {
                logger.error(`[Terminal ${terminalId}] Event listener cleanup error:`, error);
            }}
            else if (unlistenPromiseRef.current) {
                // Detach once promise resolves
                unlistenPromiseRef.current.then((resolved) => { 
                    try { resolved(); } catch (error) {
                        logger.error(`[Terminal ${terminalId}] Async event listener cleanup error:`, error);
                    }
                });
            }
            if (resumeUnlistenRef.current) {
                try { resumeUnlistenRef.current(); } catch (error) {
                    logger.error(`[Terminal ${terminalId}] Resume listener cleanup error:`, error);
                }
                resumeUnlistenRef.current = null;
            }
            if (suspendUnlisten) {
                try { suspendUnlisten(); } catch (error) {
                    logger.error(`[Terminal ${terminalId}] Suspend listener cleanup error:`, error);
                }
            }
            
            // Only disconnect if not already disconnected (it disconnects itself after initialization)
            try {
                rendererObserver?.disconnect();
            } catch (e) {
                // Already disconnected during initialization, this is expected
                logger.debug(`[Terminal ${terminalId}] Renderer observer already disconnected:`, e);
            }
            try { visibilityObserver?.disconnect(); } catch { /* ignore */ }
            terminal.current?.dispose();
            terminal.current = null;
            setHydrated(false);
            pendingOutput.current = [];
            resetQueue();
            // Note: We intentionally don't close terminals here to allow switching between sessions
            // All terminals are cleaned up when the app exits via the backend cleanup handler
            // useCleanupRegistry handles other cleanup automatically
        };
    }, [terminalId, addEventListener, addResizeObserver, agentType, isBackground, terminalFontSize, onReady, resolvedFontFamily, readOnly, enqueueWrite, shouldAutoScroll, isUserSelectingInTerminal, applySizeUpdate, flushQueuePending, getQueueStats, resetQueue, inputFilter, isAgentTopTerminal, scrollToBottomInstant, pluginTransportActive, acknowledgeChunk, applyPostHydrationScroll]);

    useEffect(() => {
        if (overflowEpoch === 0) return;
        overflowQueuedRef.current = true;
        if (overflowProcessingRef.current) return;

        const processOverflow = async () => {
            while (overflowNoticesRef.current.length > 0) {
                const droppedBytes = overflowNoticesRef.current[0];
                const rehydrate = rehydrateByReasonRef.current;

                if (typeof droppedBytes !== 'number') {
                    overflowNoticesRef.current.shift();
                    continue;
                }

                if (!rehydrate) {
                    logger.debug(`[Terminal ${terminalId}] Overflow recovery skipped; rehydrate handler unavailable`);
                    break;
                }

                logger.debug(`[Terminal ${terminalId}] Processing overflow recovery (dropped ${droppedBytes}B)`);

                let outcome: 'completed' | 'deferred' | 'failed';
                try {
                    outcome = await rehydrate('overflow');
                } catch (error) {
                    logger.error(`[Terminal ${terminalId}] Overflow rehydrate threw`, error);
                    outcome = 'failed';
                }

                if (outcome === 'completed') {
                    overflowNoticesRef.current.shift();
                    continue;
                }

                if (outcome === 'deferred') {
                    overflowQueuedRef.current = true;
                    break;
                }

                logger.warn(`[Terminal ${terminalId}] Overflow rehydrate reported failure`);
                break;
            }

            if (overflowNoticesRef.current.length === 0) {
                overflowQueuedRef.current = false;
            }

            overflowProcessingRef.current = false;
        };

        overflowProcessingRef.current = true;
        processOverflow();
    }, [overflowEpoch, terminalId]);

    // Reconfigure output listener when agent type changes for the same terminal
    useEffect(() => {
        if (!terminal.current) return;
        if (listenerAgentRef.current === agentType) return;

        // Helper: minimal flush to reuse existing buffering
        const flushQueuedWritesLight = () => {
            if (!terminal.current || getQueueStats().queueLength === 0) return;

            flushQueuePending((chunk) => {
                if (!terminal.current) {
                    return false;
                }

                let wasAtBottom = false;
                try {
                    const buffer = terminal.current.buffer.active as ActiveBufferLike & { viewportY?: number; baseY?: number };
                    wasAtBottom = buffer.viewportY === buffer.baseY;
                } catch (error) {
                    logger.debug(`[Terminal ${terminalId}] Unable to read buffer before flush`, error);
                }

                try {
                    terminal.current.write(chunk);
                } catch (error) {
                    logger.warn(`[Terminal ${terminalId}] Failed to flush queued writes`, error);
                    return false;
                }

                requestAnimationFrame(() => {
                    try {
                        if (shouldAutoScroll(wasAtBottom)) {
                            scrollToBottomInstant();
                        }
                        if (getQueueStats().queueLength > 0) {
                            flushQueuedWritesLight();
                        }
                    } catch (e) {
                        logger.warn(`[Terminal ${terminalId}] Failed to scroll after flush:`, e);
                    }
                });

                return true;
            }, { immediate: true });
        };

        // Detach previous listener
        const detach = () => {
            if (unlistenRef.current) {
                try { unlistenRef.current(); } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Listener detach failed:`, e);
                }
                unlistenRef.current = null;
            }
        };
        detach();

        // Attach appropriate listener for current agent type
        let mounted = true;
        const attach = async () => {
            try {
                unlistenRef.current = await listenTerminalOutput(terminalId, (output) => {
                    if (!mounted) return;
                    if (!hydratedRef.current) {
                        pendingOutput.current.push(output);
                    } else {
                        enqueueWrite(output);
                        flushQueuedWritesLight();
                    }
                });
                listenerAgentRef.current = agentType;
            } catch (e) {
                logger.warn(`[Terminal ${terminalId}] Failed to reconfigure output listener:`, e);
            }
        };
        attach();

        return () => {
            mounted = false;
            detach();
        };
    }, [agentType, terminalId, enqueueWrite, flushQueuePending, getQueueStats, shouldAutoScroll, scrollToBottomInstant]);


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
                    const expectedId = sessionName ? `session-${sessionName}-top` : null;
                    if (!sessionName) {
                        startingTerminals.current.set(terminalId, false);
                        return;
                    }
                    if (expectedId !== terminalId) {
                        startingTerminals.current.set(terminalId, false);
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
                            await startSessionTop({ sessionName, topId: terminalId, measured });
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
     }, [hydrated, terminalId, isCommander, sessionName, isAnyModalOpen, agentStopped]);

    useEffect(() => {
        if (!terminal.current || !resolvedFontFamily) return
        try {
            if (terminal.current.options.fontFamily !== resolvedFontFamily) {
                terminal.current.options.fontFamily = resolvedFontFamily
                if (fitAddon.current) {
                    fitAddon.current.fit()
                    const { cols, rows } = terminal.current
                    applySizeUpdate(cols, rows, 'font-family');
                }
            }
        } catch (e) {
            logger.warn(`[Terminal ${terminalId}] Failed to apply font family`, e)
        }
    }, [resolvedFontFamily, terminalId, applySizeUpdate])

    useLayoutEffect(() => {
        if (previousTerminalId.current !== terminalId) {
            snapshotCursorRef.current = null
            previousTerminalId.current = terminalId;
        }
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
            {/* Search UI opens via keyboard shortcut only (Cmd/Ctrl+F) */}
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
