import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import { TauriCommands } from '../../common/tauriCommands'
import { SchaltEvent, listenEvent, listenTerminalOutput } from '../../common/eventSystem'
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { invoke } from '@tauri-apps/api/core';
import { UnlistenFn } from '@tauri-apps/api/event';
import { useFontSize } from '../../contexts/FontSizeContext';
import { useCleanupRegistry } from '../../hooks/useCleanupRegistry';
import { theme } from '../../common/theme';
import { AnimatedText } from '../common/AnimatedText';
import '@xterm/xterm/css/xterm.css';
import { logger } from '../../utils/logger'
import { useModal } from '../../contexts/ModalContext'
import { safeTerminalFocus, safeTerminalFocusImmediate } from '../../utils/safeFocus'
import { buildTerminalFontFamily } from '../../utils/terminalFonts'
import { countTrailingBlankLines, ActiveBufferLike } from '../../utils/termScroll'
import { applyEnqueuePolicy, makeAgentQueueConfig, makeDefaultQueueConfig } from '../../utils/terminalQueue'

// Global guard to avoid starting Claude multiple times for the same terminal id across remounts
const startedGlobal = new Set<string>();
const MAX_INITIAL_FIT_ATTEMPTS = 6;

// Export function to clear started tracking for specific terminals
export function clearTerminalStartedTracking(terminalIds: string[]) {
    terminalIds.forEach(id => startedGlobal.delete(id));
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

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(({ terminalId, className = '', sessionName, isCommander = false, agentType, readOnly = false, onTerminalClick, isBackground = false, onReady, inputFilter }, ref) => {
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
    const initialFitAttemptsRef = useRef(0);
    const initialFitRetryHandleRef = useRef<number | null>(null);
    const scheduleInitialFitRetry = useCallback((cb: () => void) => {
        if (initialFitRetryHandleRef.current != null) {
            cancelAnimationFrame(initialFitRetryHandleRef.current);
        }
        initialFitRetryHandleRef.current = requestAnimationFrame(cb);
    }, []);
    const searchAddon = useRef<SearchAddon | null>(null);
    const lastSize = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
    const [hydrated, setHydrated] = useState(false);
    const [agentLoading, setAgentLoading] = useState(false);
    const hydratedRef = useRef<boolean>(false);
    const pendingOutput = useRef<string[]>([]);
    const [isSearchVisible, setIsSearchVisible] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    // Batch terminal writes to reduce xterm parse/render overhead
    const writeQueueRef = useRef<string[]>([]);
    const queueBytesRef = useRef(0);
    const droppedBytesRef = useRef(0);
    const overflowActiveRef = useRef(false);
    const rafIdRef = useRef<number | null>(null);
    const pendingFlushRef = useRef<boolean>(false);
    const seqRef = useRef<number>(0);
    const termDebug = () => (typeof window !== 'undefined' && localStorage.getItem('TERMINAL_DEBUG') === '1');
    // No timer-based retries; gate on renderer readiness and microtasks/RAFs
    const unlistenRef = useRef<UnlistenFn | null>(null);
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

    // Write queue helpers shared across effects (agent terminals get larger buffers)
    const queueCfg = useMemo(() => (
        agentType ? makeAgentQueueConfig() : makeDefaultQueueConfig()
    ), [agentType]);
    const MAX_WRITE_CHUNK = queueCfg.maxWriteChunk;

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
        if (!wasAtBottom) return false;
        if (agentType === 'run') {
            if (dragSelectingRef.current) return false;
            if (selectionActiveRef.current) return false;
            if (isUserSelectingInTerminal()) return false;
        }
        return true;
    }, [agentType, isUserSelectingInTerminal]);

    const enqueueWrite = useCallback((data: string) => {
        const next = applyEnqueuePolicy(
            {
                queue: writeQueueRef.current,
                queuedBytes: queueBytesRef.current,
                droppedBytes: droppedBytesRef.current,
                overflowActive: overflowActiveRef.current,
            },
            data,
            queueCfg
        )

        writeQueueRef.current = next.queue
        queueBytesRef.current = next.queuedBytes
        droppedBytesRef.current = next.droppedBytes

        // Emit a single notice per overflow episode to avoid spam
        if (!overflowActiveRef.current && next.overflowActive) {
            const droppedKB = Math.max(1, Math.round(next.droppedBytes / 1024))
            // Do NOT unshift; append so the message appears in order while catching up
            const note = `\r\n[schaltwerk] high-volume output; ${droppedKB}KB skipped in UI to stay responsive. Full content preserved in transcript for agent terminals.\r\n`
            writeQueueRef.current.push(note)
            queueBytesRef.current += note.length
        }
        overflowActiveRef.current = next.overflowActive
    }, [queueCfg]);

    const dequeueChunk = (limit: number) => {
        let taken = 0;
        const pieces: string[] = [];
        while (writeQueueRef.current.length > 0 && taken < limit) {
            const next = writeQueueRef.current[0];
            const room = limit - taken;
            if (next.length <= room) {
                pieces.push(next);
                writeQueueRef.current.shift();
                queueBytesRef.current -= next.length;
                taken += next.length;
            } else {
                pieces.push(next.slice(0, room));
                writeQueueRef.current[0] = next.slice(room);
                queueBytesRef.current -= room;
                taken += room;
            }
        }
        return pieces.join('');
    };

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
        scrollToBottom: () => {
            if (terminal.current) {
                terminal.current.scrollToBottom();
            }
        }
    }), [isAnyModalOpen, isSearchVisible, focusSearchInput]);

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
            if (target instanceof Element && target.closest('[data-terminal-search="true"]')) {
                return;
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
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { fontFamily?: string | null } | undefined
            const custom = detail?.fontFamily ?? null
            const chain = buildTerminalFontFamily(custom)
            setResolvedFontFamily(chain)
        }
        window.addEventListener('schaltwerk:terminal-font-updated', handler as EventListener)
        return () => window.removeEventListener('schaltwerk:terminal-font-updated', handler as EventListener)
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
    }, []);

    // Listen for force scroll events (e.g., after review comment paste)
    useEffect(() => {
        let unlistenForceScroll: UnlistenFn | null = null;
        
        const setupForceScrollListener = async () => {
            try {
                unlistenForceScroll = await listenEvent(SchaltEvent.TerminalForceScroll, (payload) => {
                    // Only handle events for this specific terminal
                    if (payload.terminal_id === terminalId && terminal.current) {
                        logger.info(`[Terminal] Force scrolling terminal ${terminalId} to bottom`);
                        try {
                            terminal.current.scrollToBottom();
                        } catch (error) {
                            logger.warn(`[Terminal ${terminalId}] Failed to force scroll to bottom:`, error);
                        }
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
    }, [terminalId]);

    // Workaround: force-fit and send PTY resize when session search runs for OpenCode
    useEffect(() => {
        const handleSearchResize = (e: Event) => {
            // Only affect visible, non-background OpenCode terminals
            if (agentType !== 'opencode' || isBackground) return;
            if (!fitAddon.current || !terminal.current || !termRef.current) return;
            const el = termRef.current;
            if (!el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;

            // Scope to the intended target: current session or orchestrator
            const detail = (e as CustomEvent).detail as { kind?: 'session' | 'orchestrator'; sessionId?: string } | undefined
            if (detail && detail.kind) {
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
                    lastSize.current = { cols, rows };
                    invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
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
        window.addEventListener('schaltwerk:opencode-search-resize', handleSearchResize as EventListener);
        return () => window.removeEventListener('schaltwerk:opencode-search-resize', handleSearchResize as EventListener);
        // Deliberately depend on agentType/isBackground to keep logic accurate per mount
    }, [agentType, isBackground, terminalId, sessionName, isCommander]);

    // Deterministic refit on session switch specifically for OpenCode
    useEffect(() => {
        const handleSelectionResize = (e: Event) => {
            if (agentType !== 'opencode' || isBackground) return;
            const detail = (e as CustomEvent<{ kind?: 'session' | 'orchestrator'; sessionId?: string }>).detail;
            if (detail?.kind === 'session') {
                if (!sessionName || detail.sessionId !== sessionName) return;
            } else if (detail?.kind === 'orchestrator') {
                if (!isCommander) return;
            }

            if (!fitAddon.current || !terminal.current || !termRef.current) return;
            if (!termRef.current.isConnected) return;

            const run = () => {
                try {
                    fitAddon.current!.fit();
                    const { cols, rows } = terminal.current!;
                    lastSize.current = { cols, rows };
                    invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
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
        window.addEventListener('schaltwerk:opencode-selection-resize', handleSelectionResize as EventListener);
        return () => window.removeEventListener('schaltwerk:opencode-selection-resize', handleSelectionResize as EventListener);
    }, [agentType, isBackground, terminalId, sessionName, isCommander]);

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
        pendingOutput.current = [];
        writeQueueRef.current = [];
        queueBytesRef.current = 0;
        droppedBytesRef.current = 0;
        if (rafIdRef.current != null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
        pendingFlushRef.current = false;

        // Revert: Always show a visible terminal cursor.
        // Prior logic adjusted/hid the xterm cursor for TUI agents which led to
        // "no cursor" reports in bottom terminals (e.g., Neovim/Neogrim). We now
        // unconditionally enable a blinking block cursor for all terminals.
        // Agent conversation terminals (session/orchestrator top) need deeper scrollback to preserve history
        // Background terminals use reduced scrollback to save memory
        const isAgentTopTerminal = (terminalId.endsWith('-top') && (terminalId.startsWith('session-') || terminalId.startsWith('orchestrator-')))
        
        let scrollbackLines = 10000; // Default for bottom terminals
        if (isBackground) {
            scrollbackLines = 5000; // Reduced for background terminals
        } else if (isAgentTopTerminal) {
            scrollbackLines = 50000; // Full history for active agent terminals
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

            // Only fit if container has proper dimensions
            if (containerWidth > 0 && containerHeight > 0) {
                initialFitAttemptsRef.current = 0;
                if (initialFitRetryHandleRef.current != null) {
                    cancelAnimationFrame(initialFitRetryHandleRef.current);
                    initialFitRetryHandleRef.current = null;
                }
                try {
                    fitAddon.current.fit();
                    const { cols, rows } = terminal.current;
                    // Only send resize if dimensions actually changed
                    if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                        lastSize.current = { cols, rows };
                        invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
                    }
                    logger.info(`[Terminal ${terminalId}] Initial fit: ${cols}x${rows} (container: ${containerWidth}x${containerHeight})`);
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Initial fit failed:`, e);
                }
            } else {
                const attempt = ++initialFitAttemptsRef.current;
                if (attempt <= MAX_INITIAL_FIT_ATTEMPTS) {
                    logger.debug(`[Terminal ${terminalId}] Initial fit deferred; container not measurable yet (${containerWidth}x${containerHeight}) [attempt ${attempt}/${MAX_INITIAL_FIT_ATTEMPTS}]`);
                    scheduleInitialFitRetry(() => {
                        if (!cancelled) {
                            performInitialFit();
                        }
                    });
                    return;
                }

                // In tests or when container isn't ready after repeated attempts, use default dimensions
                logger.warn(`[Terminal ${terminalId}] Container dimensions not ready (${containerWidth}x${containerHeight}), using defaults`);
                initialFitAttemptsRef.current = 0;
                if (initialFitRetryHandleRef.current != null) {
                    cancelAnimationFrame(initialFitRetryHandleRef.current);
                    initialFitRetryHandleRef.current = null;
                }
                try {
                    // Set reasonable default dimensions for tests and edge cases
                    terminal.current.resize(80, 24);
                    lastSize.current = { cols: 80, rows: 24 };
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Default resize failed:`, e);
                }
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
                            if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                                lastSize.current = { cols, rows };
                                invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
                            }
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
                                if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                                    lastSize.current = { cols, rows };
                                    invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
                                }
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
                    if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                        lastSize.current = { cols, rows };
                        invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
                    }
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
            
            // Cmd+Enter for new line (like Claude Code)
            if (modifierKey && event.key === 'Enter' && event.type === 'keydown') {
                // Send a newline character without submitting the command
                // This allows multiline input in shells that support it
                invoke(TauriCommands.WriteTerminal, { id: terminalId, data: '\n' }).catch(err => logger.debug('[Terminal] newline ignored (backend not ready yet)', err));
                return false; // Prevent default Enter behavior
            }
            
            // Kanban board shortcut: Cmd+Shift+K
            if (modifierKey && event.shiftKey && (event.key === 'k' || event.key === 'K')) {
                window.dispatchEvent(new CustomEvent('global-kanban-shortcut'))
                return false
            }
            // Prefer Shift+Cmd/Ctrl+N as "New spec"
            if (modifierKey && event.shiftKey && (event.key === 'n' || event.key === 'N')) {
                window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
                return false
            }
            // Plain Cmd/Ctrl+N opens the regular new session modal
            if (modifierKey && !event.shiftKey && (event.key === 'n' || event.key === 'N')) {
                // Dispatch a custom event to trigger the global new session handler
                window.dispatchEvent(new CustomEvent('global-new-session-shortcut'))
                return false // Prevent xterm.js from processing this event
            }
            if (modifierKey && (event.key === 'r' || event.key === 'R')) {
                // Dispatch a custom event to trigger the global mark reviewed handler
                window.dispatchEvent(new CustomEvent('global-mark-ready-shortcut'))
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
                    if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                        lastSize.current = { cols, rows };
                        invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
                    }
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
            if (pendingFlushRef.current) return;
            pendingFlushRef.current = true;
            queueMicrotask(() => {
                pendingFlushRef.current = false;
                if (!rendererReadyRef.current || !terminal.current || writeQueueRef.current.length === 0) return;
                const chunk = dequeueChunk(MAX_WRITE_CHUNK);
                try {
                    const buffer = terminal.current.buffer.active as unknown as ActiveBufferLike & { viewportY?: number; baseY?: number };
                    const wasAtBottom = (buffer?.viewportY != null && buffer?.baseY != null)
                        ? buffer.viewportY === buffer.baseY
                        : false;
                    if (termDebug()) logger.debug(`[Terminal ${terminalId}] flush: bytes=${chunk.length} wasAtBottom=${wasAtBottom}`);
                    terminal.current.write(chunk, () => {
                        try { if (shouldAutoScroll(wasAtBottom)) terminal.current!.scrollToBottom(); } catch (error) { logger.debug('Scroll error during terminal output (cb)', error); }
                        if (writeQueueRef.current.length > 0) scheduleFlush();
                    });
                } catch (e) {
                    logger.debug('xterm write failed in scheduleFlush', e);
                }
            });
        };

        // Immediate flush helper (no debounce), used during hydration transitions
        const flushNow = () => {
            if (!rendererReadyRef.current) return;
            if (!terminal.current || writeQueueRef.current.length === 0) return;
            const chunk = dequeueChunk(MAX_WRITE_CHUNK);
            try {
                const buffer = terminal.current.buffer.active as unknown as ActiveBufferLike & { viewportY?: number; baseY?: number };
                const wasAtBottom = (buffer?.viewportY != null && buffer?.baseY != null)
                    ? buffer.viewportY === buffer.baseY
                    : false;
                if (termDebug()) logger.debug(`[Terminal ${terminalId}] flushNow: bytes=${chunk.length} wasAtBottom=${wasAtBottom}`);
                terminal.current.write(chunk, () => {
                    try {
                        if (shouldAutoScroll(wasAtBottom)) {
                            terminal.current!.scrollToBottom();
                        }
                    } catch (error) {
                        logger.debug('Scroll error during buffer flush (cb)', error);
                    } finally {
                        if (writeQueueRef.current.length > 0) queueMicrotask(() => flushNow());
                    }
                });
            } catch (e) {
                logger.debug('xterm write failed in flushNow', e);
            }
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

            // 3) Drain writeQueueRef to empty using write callbacks
            if (!terminal.current) return;
            await new Promise<void>((resolve) => {
                const step = () => {
                    if (!mountedRef.current || !terminal.current) return resolve();
                    if (writeQueueRef.current.length === 0) {
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
                    try {
                        const chunk = dequeueChunk(MAX_WRITE_CHUNK);
                        const buffer = terminal.current!.buffer.active as unknown as ActiveBufferLike & { viewportY?: number; baseY?: number };
                        const wasAtBottom = (buffer?.viewportY != null && buffer?.baseY != null)
                            ? buffer.viewportY === buffer.baseY
                            : false;
                        terminal.current!.write(chunk, () => {
                            try { if (shouldAutoScroll(wasAtBottom)) terminal.current!.scrollToBottom(); } catch { /* ignore */ }
                            // Continue draining until truly empty; use microtask to avoid deep callback chains
                            queueMicrotask(step);
                        });
                    } catch {
                        // If a write fails, bail out to avoid an infinite loop; normal streaming will recover
                        resolve();
                    }
                };
                step();
            });
        };

        // Listen for terminal output from backend (buffer until hydrated)
        unlistenRef.current = null;
        const attachListener = async () => {
            unlistenRef.current = await listenTerminalOutput(terminalId, (output) => {
                if (termDebug()) {
                    const n = ++seqRef.current;
                    logger.debug(`[Terminal ${terminalId}] recv #${n} +${(output?.length ?? 0)}B qlen=${writeQueueRef.current.length}`)
                }
                if (cancelled) return;
                if (!hydratedRef.current) {
                    pendingOutput.current.push(output);
                } else {
                    enqueueWrite(output);
                    scheduleFlush();
                }
            });
            return unlistenRef.current!;
        };
        unlistenPromiseRef.current = attachListener();
        listenerAgentRef.current = agentType;

        // Hydrate from buffer
        const hydrateTerminal = async () => {
            try {
                // Ensure listener is attached before snapshot so there is zero gap
                try {
                    await unlistenPromiseRef.current;
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Listener attach awaited with error (continuing):`, e);
                }
                const snapshot = await invoke<string>(TauriCommands.GetTerminalBuffer, { id: terminalId });
                
                if (snapshot) {
                    enqueueWrite(snapshot);
                }
                // Queue any pending output that arrived during hydration
                if (pendingOutput.current.length > 0) {
                    for (const output of pendingOutput.current) {
                        enqueueWrite(output);
                    }
                    pendingOutput.current = [];
                 }
                 // Drain all queued content before we reveal the terminal to avoid "partial paint" perception
                 await flushAllNowAsync();
                 // Mark as hydrated only after flushing the entire snapshot + pending output
                 setHydrated(true);
                 hydratedRef.current = true;
                  
                  // Call onReady callback if provided
                  if (onReady) {
                      onReady();
                  }
                  
                  // After hydration, ensure a definitive fit+resize once layout/fonts are ready
                  const doHydrationFit = () => {
                      if (!fitAddon.current || !terminal.current || !termRef.current) return;
                      const el = termRef.current;
                      if (!el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;
                      try {
                          fitAddon.current.fit();
                          const { cols, rows } = terminal.current;
                          if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                              lastSize.current = { cols, rows };
                              invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
                          }
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
                      if (terminal.current) {
                          try {
                              if (agentType !== 'run' || !isUserSelectingInTerminal()) {
                                  terminal.current.scrollToBottom();
                              }
                              if (agentType === 'codex') {
                                  const buf = terminal.current.buffer.active as unknown as ActiveBufferLike
                                  const trailing = typeof buf?.getLine === 'function' ? countTrailingBlankLines(buf) : 0
                                  if (trailing > 0) terminal.current.scrollLines(-trailing)
                                  if (termDebug()) logger.debug(`[Terminal ${terminalId}] tighten(after hydration): trailing=${trailing}`)
                              }
                          } catch (error) {
                              logger.warn(`[Terminal ${terminalId}] Failed to scroll to bottom after hydration:`, error);
                          }
                      }
                  });

                  // Emit terminal ready event for focus management after we've fully flushed and fitted
                  if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('schaltwerk:terminal-ready', {
                          detail: { terminalId }
                      }));
                 }
                
            } catch (error) {
                logger.error(`[Terminal ${terminalId}] Failed to hydrate:`, error);
                // On failure, still shift to live streaming and flush any buffered output to avoid drops
                setHydrated(true);
                hydratedRef.current = true;
                if (pendingOutput.current.length > 0) {
                    for (const output of pendingOutput.current) {
                        writeQueueRef.current.push(output);
                    }
                    pendingOutput.current = [];
                    // Flush immediately; subsequent events will be batched
                    flushNow();
                    
                    // Scroll to bottom even on hydration failure
                    requestAnimationFrame(() => {
                        if (terminal.current) {
                            try {
                                if (agentType !== 'run' || !isUserSelectingInTerminal()) {
                                    terminal.current.scrollToBottom();
                                }
                            } catch (error) {
                                logger.warn(`[Terminal ${terminalId}] Failed to scroll to bottom after hydration failure:`, error);
                            }
                        }
                    });
                }
            }
        };

        hydrateTerminal();

        // Helper functions for scroll position management
        const captureScrollPosition = () => {
            let wasAtBottom = false;
            let scrollPosition = 0;
            
            try {
                if (!terminal.current) {
                    return { wasAtBottom: true, scrollPosition: 0 };
                }
                
                const buffer = terminal.current.buffer.active;
                wasAtBottom = buffer.viewportY === buffer.baseY;
                scrollPosition = buffer.viewportY;
            } catch (error) {
                logger.warn(`[Terminal ${terminalId}] Failed to capture scroll position:`, error);
                wasAtBottom = true;
            }
            
            return { wasAtBottom, scrollPosition };
        };


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

                // Capture scroll position before font size change
                const { wasAtBottom } = captureScrollPosition();

                try {
                    fitAddon.current.fit();
                    const { cols, rows } = terminal.current;

                    // Only scroll to bottom on font size change if user was at bottom AND we're not during session switching
                    const isUILayoutChange = document.body.classList.contains('session-switching');
                    if (wasAtBottom && !isUILayoutChange && (agentType !== 'run' || !isUserSelectingInTerminal())) {
                        requestAnimationFrame(() => {
                            try {
                                if (!terminal.current) return
                                if (agentType === 'codex') {
                                    const buf = terminal.current.buffer.active as unknown as ActiveBufferLike
                                    const trailing = typeof buf?.getLine === 'function' ? countTrailingBlankLines(buf) : 0
                                    terminal.current.scrollToBottom()
                                    if (trailing > 0) terminal.current.scrollLines(-trailing)
                                } else {
                                    terminal.current.scrollToBottom()
                                }
                            } catch (error) {
                                logger.debug('Failed to scroll to bottom after font size change', error);
                            }
                        });
                    }

                    // Only send resize if dimensions actually changed
                    if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                        lastSize.current = { cols, rows };
                        invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
                    }
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
                invoke(TauriCommands.WriteTerminal, { id: terminalId, data }).catch(err => logger.debug('[Terminal] write ignored (backend not ready yet)', err));
            });
        }
        
        // Send initialization sequence to ensure proper terminal mode
        // This helps with arrow key handling in some shells
        requestAnimationFrame(() => {
            if (terminal.current) {
                invoke(TauriCommands.WriteTerminal, { id: terminalId, data: '' }).catch(err => logger.debug('[Terminal] init write ignored (backend not ready yet)', err));
            }
        });

        // Handle terminal resize - only send if size actually changed
        const handleResize = () => {
            if (!fitAddon.current || !terminal.current) return;

            const el = termRef.current;
            if (!el || !el.isConnected) {
                return;
            }

            // Capture scroll position before resize
            const { wasAtBottom } = captureScrollPosition();

            try {
                // Force a proper fit with accurate dimensions
                fitAddon.current.fit();
            } catch (e) {
                logger.warn(`[Terminal ${terminalId}] fit() failed during resize; skipping this tick`, e);
                return;
            }
            const { cols, rows } = terminal.current;

            // Only scroll to bottom on resize if user was at bottom AND we're not during a UI layout change
            // Skip auto-scroll during session switches to prevent interference with scrolling
            const isUILayoutChange = document.body.classList.contains('session-switching');
            if (wasAtBottom && !isUILayoutChange && (agentType !== 'run' || !isUserSelectingInTerminal())) {
                requestAnimationFrame(() => {
                    try {
                        terminal.current?.scrollToBottom();
                    } catch (error) {
                        logger.debug('Failed to scroll to bottom after resize', error);
                    }
                });
            }

            // Only send resize if dimensions actually changed
            if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                lastSize.current = { cols, rows };
                // Send resize command immediately to update PTY size
                invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
            }
        };

        // Use ResizeObserver with more stable debouncing to prevent jitter
        let roRafPending = false;
        
        addResizeObserver(termRef.current, () => {
            if (document.body.classList.contains('is-split-dragging')) return;
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
                    // Wait a frame for DOM to stabilize after drag
                    requestAnimationFrame(() => {
                        if (!fitAddon.current || !terminal.current) return;
                        
                        // Capture scroll position before final fit
                        const { wasAtBottom } = captureScrollPosition();

                        // Force a complete refit after drag ends
                        fitAddon.current.fit();
                        const { cols, rows } = terminal.current;
                        
                        // Only scroll to bottom after drag if user was at bottom AND we're not during session switching
                        const isUILayoutChange = document.body.classList.contains('session-switching');
                        if (wasAtBottom && !isUILayoutChange) {
                            requestAnimationFrame(() => {
                                try {
                                    terminal.current?.scrollToBottom();
                                } catch (error) {
                                    logger.debug('Failed to scroll to bottom after drag', error);
                                }
                            });
                        }

                        lastSize.current = { cols, rows };
                        invoke(TauriCommands.ResizeTerminal, { id: terminalId, cols, rows }).catch(err => logger.debug("[Terminal] resize ignored (backend not ready yet)", err));
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
            writeQueueRef.current = [];
            if (rafIdRef.current != null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
            pendingFlushRef.current = false;
            // Note: We intentionally don't close terminals here to allow switching between sessions
            // All terminals are cleaned up when the app exits via the backend cleanup handler
            // useCleanupRegistry handles other cleanup automatically
        };
    }, [terminalId, addEventListener, addResizeObserver, agentType, isBackground, terminalFontSize, onReady, resolvedFontFamily, readOnly, enqueueWrite, queueCfg, MAX_WRITE_CHUNK, shouldAutoScroll, isUserSelectingInTerminal, scheduleInitialFitRetry, inputFilter]);

    // Reconfigure output listener when agent type changes for the same terminal
    useEffect(() => {
        if (!terminal.current) return;
        if (listenerAgentRef.current === agentType) return;

        // Helper: minimal flush to reuse existing buffering
        const flushQueuedWritesLight = () => {
            if (!terminal.current || writeQueueRef.current.length === 0) return;
            const chunk = dequeueChunk(MAX_WRITE_CHUNK);
            terminal.current.write(chunk);
            requestAnimationFrame(() => {
                try {
                    const buffer = terminal.current!.buffer.active;
                    const atBottom = buffer.viewportY === buffer.baseY;
                    if (shouldAutoScroll(atBottom)) terminal.current!.scrollToBottom();
                    if (writeQueueRef.current.length > 0) flushQueuedWritesLight();
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Failed to scroll after flush:`, e);
                }
            });
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
    }, [agentType, terminalId, enqueueWrite, queueCfg, MAX_WRITE_CHUNK, shouldAutoScroll]);


    // Automatically start Claude for top terminals when hydrated and first ready
    useEffect(() => {
        if (!hydrated) return;
        if (!terminalId.endsWith('-top')) return;
        if (startedGlobal.has(terminalId)) return;

        const start = async () => {
            if (startingTerminals.current.get(terminalId)) {
                return;
            }
            startingTerminals.current.set(terminalId, true);
            setAgentLoading(true);
            try {
                if (isCommander || (terminalId.includes('orchestrator') && terminalId.endsWith('-top'))) {
                    // OPTIMIZATION: Skip terminal_exists check - trust that hydrated terminals are ready
                     // Mark as started BEFORE invoking to prevent overlaps
                     startedGlobal.add(terminalId);
                     try {
                            // Provide initial size at spawn to avoid early overflow in TUI apps
                            let cols: number | undefined = undefined;
                            let rows: number | undefined = undefined;
                            try {
                                if (fitAddon.current && terminal.current) {
                                    fitAddon.current.fit();
                                    cols = terminal.current.cols;
                                    rows = terminal.current.rows;
                                }
                            } catch (e) {
                                logger.warn(`[Terminal ${terminalId}] Failed to measure size before orchestrator start:`, e);
                            }
                            await invoke(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, { terminalId, cols, rows });
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
                            // Handle no project error
                            logger.error(`[Terminal ${terminalId}] No project open:`, errorMessage);
                            window.dispatchEvent(new CustomEvent('schaltwerk:no-project-error', {
                                detail: { error: errorMessage, terminalId }
                            }));
                        } else if (errorMessage.includes('Permission required for folder:')) {
                            window.dispatchEvent(new CustomEvent('schaltwerk:permission-error', {
                                detail: { error: errorMessage }
                            }));
                        } else if (errorMessage.includes('Failed to spawn command')) {
                            // Log more details about spawn failures
                            logger.error(`[Terminal ${terminalId}] Spawn failure details:`, errorMessage);
                            // Dispatch a specific event for spawn failures
                            window.dispatchEvent(new CustomEvent('schaltwerk:spawn-error', {
                                detail: { error: errorMessage, terminalId }
                            }));
                         } else if (errorMessage.includes('not a git repository')) {
                             // Handle non-git repository error
                             logger.error(`[Terminal ${terminalId}] Not a git repository:`, errorMessage);
                             window.dispatchEvent(new CustomEvent('schaltwerk:not-git-error', {
                                 detail: { error: errorMessage, terminalId }
                             }));
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
                           let cols: number | undefined = undefined;
                           let rows: number | undefined = undefined;
                           try {
                               if (fitAddon.current && terminal.current) {
                                   fitAddon.current.fit();
                                   cols = terminal.current.cols;
                                   rows = terminal.current.rows;
                               }
                           } catch (e) {
                               logger.warn(`[Terminal ${terminalId}] Failed to measure size before session start:`, e);
                           }
                           await invoke(TauriCommands.SchaltwerkCoreStartClaude, { sessionName, cols, rows });
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
                            window.dispatchEvent(new CustomEvent('schaltwerk:permission-error', {
                                detail: { error: errorMessage }
                            }));
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
            if (initialFitRetryHandleRef.current != null) {
                cancelAnimationFrame(initialFitRetryHandleRef.current);
                initialFitRetryHandleRef.current = null;
            }
        };
    }, [hydrated, terminalId, isCommander, sessionName, isAnyModalOpen, scheduleInitialFitRetry]);

    useEffect(() => {
        if (!terminal.current || !resolvedFontFamily) return
        try {
            if (terminal.current.options.fontFamily !== resolvedFontFamily) {
                terminal.current.options.fontFamily = resolvedFontFamily
                if (fitAddon.current) {
                    fitAddon.current.fit()
                }
            }
        } catch (e) {
            logger.warn(`[Terminal ${terminalId}] Failed to apply font family`, e)
        }
    }, [resolvedFontFamily, terminalId])

    // Force scroll to bottom when switching sessions
    useEffect(() => {
        if (previousTerminalId.current !== terminalId) {
            // Terminal ID changed - this is a session switch
            if (terminal.current) {
                requestAnimationFrame(() => {
                    try {
                        terminal.current?.scrollToBottom();
                    } catch (error) {
                        logger.warn(`[Terminal ${terminalId}] Failed to scroll to bottom on session switch:`, error);
                    }
                });
            }
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
        <div ref={containerRef} className={`h-full w-full relative overflow-hidden px-2 ${className}`} onClick={handleTerminalClick} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} data-smartdash-exempt="true">
            <div ref={termRef} className="h-full w-full overflow-hidden" style={readOnly ? { WebkitUserSelect: 'text', userSelect: 'text' } : undefined} />
            {(!hydrated || agentLoading) && (
                <div className="absolute inset-0 flex items-center justify-center bg-background-secondary z-20">
                    <AnimatedText
                        text="loading"
                        colorClassName="text-slate-500"
                        size="md"
                        speedMultiplier={3}
                    />
                </div>
            )}
            {/* Search UI opens via keyboard shortcut only (Cmd/Ctrl+F) */}
            {isSearchVisible && (
                <div ref={searchContainerRef} data-terminal-search="true" className="absolute top-2 right-2 flex items-center bg-panel border border-slate-700 rounded px-2 py-1 z-10">
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (searchAddon.current && terminal.current) {
                                    if (e.shiftKey) {
                                        searchAddon.current.findPrevious(searchTerm);
                                    } else {
                                        searchAddon.current.findNext(searchTerm);
                                    }
                                }
                            } else if (e.key === 'Escape') {
                                setIsSearchVisible(false);
                                setSearchTerm('');
                            }
                        }}
                        placeholder="Search..."
                        className="bg-transparent text-sm text-slate-200 outline-none w-40"
                        autoFocus
                    />
                    <button 
                        onClick={() => {
                            if (searchAddon.current && terminal.current) {
                                searchAddon.current.findPrevious(searchTerm);
                            }
                        }}
                        className="text-slate-400 hover:text-slate-200 ml-1"
                        title="Previous match (Shift+Enter)"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M7 12L3 8L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                    <button 
                        onClick={() => {
                            if (searchAddon.current && terminal.current) {
                                searchAddon.current.findNext(searchTerm);
                            }
                        }}
                        className="text-slate-400 hover:text-slate-200 ml-1"
                        title="Next match (Enter)"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M9 4L13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                    <button 
                        onClick={() => {
                            setIsSearchVisible(false);
                            setSearchTerm('');
                        }}
                        className="text-slate-400 hover:text-slate-200 ml-2"
                        title="Close search (Escape)"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
});

Terminal.displayName = 'Terminal';
