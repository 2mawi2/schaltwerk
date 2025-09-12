import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
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
import { buildTerminalFontFamily } from '../../utils/terminalFonts'

// Global guard to avoid starting Claude multiple times for the same terminal id across remounts
const startedGlobal = new Set<string>();

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
    onTerminalClick?: () => void;
    isBackground?: boolean;
    onReady?: () => void;
}

export interface TerminalHandle {
    focus: () => void;
    showSearch: () => void;
    scrollToBottom: () => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(({ terminalId, className = '', sessionName, isCommander = false, agentType, onTerminalClick, isBackground = false, onReady }, ref) => {
    const { terminalFontSize } = useFontSize();
    const { addEventListener, addResizeObserver, addTimeout } = useCleanupRegistry();
    const termRef = useRef<HTMLDivElement>(null);
    const terminal = useRef<XTerm | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
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
    const rafIdRef = useRef<number | null>(null);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // When renderer isn't ready, avoid unbounded recursive timers by keeping a single retry timer
    const notReadyRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unlistenRef = useRef<UnlistenFn | null>(null);
    const unlistenPromiseRef = useRef<Promise<UnlistenFn> | null>(null);
    const mountedRef = useRef<boolean>(false);
    const startingTerminals = useRef<Map<string, boolean>>(new Map());
    const previousTerminalId = useRef<string>(terminalId);
    const listenerAgentRef = useRef<string | undefined>(agentType);
    const rendererReadyRef = useRef<boolean>(false); // Canvas renderer readiness flag
    const [resolvedFontFamily, setResolvedFontFamily] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
        focus: () => {
            if (terminal.current) {
                terminal.current.focus();
            }
        },
        showSearch: () => {
            setIsSearchVisible(true);
        },
        scrollToBottom: () => {
            if (terminal.current) {
                terminal.current.scrollToBottom();
            }
        }
    }), []);

    // Keep hydratedRef in sync so listeners see the latest state
    useEffect(() => {
        hydratedRef.current = hydrated;
    }, [hydrated]);

    useEffect(() => {
        let mounted = true
        const load = async () => {
            try {
                const settings = await invoke<{ fontFamily?: string | null }>('get_terminal_settings')
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

    useEffect(() => {
        mountedRef.current = true;
        let cancelled = false;
        const mountTime = Date.now();
        if (!termRef.current) {
            logger.error(`[Terminal ${terminalId}] No ref available!`);
            return;
        }

        setHydrated(false);
        hydratedRef.current = false;
        pendingOutput.current = [];
        writeQueueRef.current = [];
        if (rafIdRef.current != null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }

        // Disable cursor for TUI-based agents to avoid duplicate cursors
        // TUI agents (cursor, opencode, gemini, etc.) show their own cursor, so we hide xterm's cursor to prevent visual conflict
        const isTuiAgent = agentType === 'cursor' || agentType === 'cursor-agent' || agentType === 'opencode' || agentType === 'gemini'
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
            cursorBlink: !isTuiAgent,
            cursorStyle: isTuiAgent ? 'underline' : 'block',
            cursorInactiveStyle: 'outline',
            scrollback: scrollbackLines,
            // Important: Keep TUI control sequences intact (e.g., from cursor-agent)
            // Converting EOLs breaks carriage-return based updates and causes visual jumping
            convertEol: false,
        });

        // Add fit addon for proper sizing
        fitAddon.current = new FitAddon();
        terminal.current.loadAddon(fitAddon.current);
        
        // Add search addon
        searchAddon.current = new SearchAddon();
        terminal.current.loadAddon(searchAddon.current);
        
        // Open terminal to DOM first (required before WebGL addon)
        terminal.current.open(termRef.current);
        
        // Ensure proper initial fit after terminal is opened
        // CRITICAL: Wait for container dimensions before fitting - essential for xterm.js 5.x cursor positioning
        const performInitialFit = () => {
            if (!fitAddon.current || !termRef.current || !terminal.current) return;
            
            const containerWidth = termRef.current.clientWidth;
            const containerHeight = termRef.current.clientHeight;
            
            // Only fit if container has proper dimensions
            if (containerWidth > 0 && containerHeight > 0) {
                try {
                    fitAddon.current.fit();
                    const { cols, rows } = terminal.current;
                    // Only send resize if dimensions actually changed
                    if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                        lastSize.current = { cols, rows };
                        invoke('resize_terminal', { id: terminalId, cols, rows }).catch(err => logger.error("Error:", err));
                    }
                    logger.info(`[Terminal ${terminalId}] Initial fit: ${cols}x${rows} (container: ${containerWidth}x${containerHeight})`);
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Initial fit failed:`, e);
                }
            } else {
                // In tests or when container isn't ready, use default dimensions
                logger.warn(`[Terminal ${terminalId}] Container dimensions not ready (${containerWidth}x${containerHeight}), using defaults`);
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
                                invoke('resize_terminal', { id: terminalId, cols, rows }).catch(err => logger.error("Error:", err));
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
                                    invoke('resize_terminal', { id: terminalId, cols, rows }).catch(err => logger.error("Error:", err));
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
                        invoke('resize_terminal', { id: terminalId, cols, rows }).catch(err => logger.error("Error:", err));
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
                invoke('write_terminal', { id: terminalId, data: '\n' }).catch(err => logger.error("Error:", err));
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
                        invoke('resize_terminal', { id: terminalId, cols, rows }).catch(err => logger.error("Error:", err));
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

        // Flush queued writes with minimal delay for responsiveness
        const flushQueuedWrites = () => {
            // Defer until renderer is ready to avoid xterm renderer invariants
            if (!rendererReadyRef.current) {
                if (!mountedRef.current) return;
                if (!notReadyRetryTimerRef.current) {
                    notReadyRetryTimerRef.current = setTimeout(() => {
                        notReadyRetryTimerRef.current = null;
                        flushQueuedWrites();
                    }, 16);
                }
                return;
            }
            if (flushTimerRef.current) return;
            // Use a very short timeout to coalesce multiple events while maintaining responsiveness
            flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                if (!terminal.current || writeQueueRef.current.length === 0) return;
                const chunk = writeQueueRef.current.join('');
                writeQueueRef.current = [];
                terminal.current.write(chunk);
                
                // Only auto-scroll if user is already at bottom
                requestAnimationFrame(() => {
                    if (terminal.current) {
                        try {
                            const buffer = terminal.current.buffer.active;
                            const isAtBottom = buffer.viewportY === buffer.baseY;
                            if (isAtBottom) {
                                terminal.current.scrollToBottom();
                            }
                        } catch (error) {
                            logger.debug('Scroll error during terminal output', error)
                        }
                    }
                });
            }, 2);
        };

        // Immediate flush helper (no debounce), used during hydration transitions
        const flushNow = () => {
            if (!rendererReadyRef.current) {
                if (!mountedRef.current) return;
                if (!notReadyRetryTimerRef.current) {
                    notReadyRetryTimerRef.current = setTimeout(() => {
                        notReadyRetryTimerRef.current = null;
                        flushNow();
                    }, 16);
                }
                return;
            }
            if (!terminal.current || writeQueueRef.current.length === 0) return;
            const chunk = writeQueueRef.current.join('');
            writeQueueRef.current = [];
            terminal.current.write(chunk);
            
            // Only auto-scroll if user is already at bottom
            requestAnimationFrame(() => {
                if (terminal.current) {
                    try {
                        const buffer = terminal.current.buffer.active;
                        const isAtBottom = buffer.viewportY === buffer.baseY;
                        if (isAtBottom) {
                            terminal.current.scrollToBottom();
                        }
                    } catch (error) {
                        logger.debug('Scroll error during buffer flush', error)
                    }
                }
            });
        };

        // Listen for terminal output from backend (buffer until hydrated)
        unlistenRef.current = null;
        unlistenPromiseRef.current = listenTerminalOutput(terminalId, (output) => {
            if (cancelled) return;
            if (!hydratedRef.current) {
                pendingOutput.current.push(output);
            } else {
                writeQueueRef.current.push(output);
                flushQueuedWrites();
            }
        }).then((fn) => { unlistenRef.current = fn; return fn; });
        listenerAgentRef.current = agentType;

        // Hydrate from buffer
        const hydrateTerminal = async () => {
            try {
                const snapshot = await invoke<string>('get_terminal_buffer', { id: terminalId });
                
                if (snapshot) {
                    writeQueueRef.current.push(snapshot);
                }
                // Queue any pending output that arrived during hydration
                if (pendingOutput.current.length > 0) {
                    for (const output of pendingOutput.current) {
                        writeQueueRef.current.push(output);
                    }
                    pendingOutput.current = [];
                 }
                  setHydrated(true);
                  hydratedRef.current = true;
                  // Flush immediately to avoid dropping output on rapid remounts/tests
                  flushNow();
                  
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
                              invoke('resize_terminal', { id: terminalId, cols, rows }).catch(err => logger.error("Error:", err));
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

                  // Scroll to bottom after hydration to show latest content
                  requestAnimationFrame(() => {
                      if (terminal.current) {
                          try {
                              terminal.current.scrollToBottom();
                          } catch (error) {
                              logger.warn(`[Terminal ${terminalId}] Failed to scroll to bottom after hydration:`, error);
                          }
                      }
                  });

                  // Emit terminal ready event for focus management
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
                                terminal.current.scrollToBottom();
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
        let fontSizeChangeTimer: NodeJS.Timeout | null = null;
        const handleFontSizeChange = (ev: Event) => {
            if (!terminal.current) return;

            const detail = (ev as CustomEvent<{ terminalFontSize: number; uiFontSize: number }>).detail;
            const newTerminalFontSize = detail?.terminalFontSize;
            if (typeof newTerminalFontSize === 'number') {
                terminal.current.options.fontSize = newTerminalFontSize;
            }

            // Clear any pending font size change
            if (fontSizeChangeTimer) clearTimeout(fontSizeChangeTimer);

            // Debounce the fit operation to prevent rapid resizes
            fontSizeChangeTimer = setTimeout(() => {
                if (!fitAddon.current || !terminal.current || !mountedRef.current) return;

                // Capture scroll position before font size change
                const { wasAtBottom } = captureScrollPosition();

                try {
                    fitAddon.current.fit();
                    const { cols, rows } = terminal.current;

                    // Only scroll to bottom on font size change if user was at bottom AND we're not during session switching
                    const isUILayoutChange = document.body.classList.contains('session-switching');
                    if (wasAtBottom && !isUILayoutChange) {
                        requestAnimationFrame(() => {
                            try {
                                terminal.current?.scrollToBottom();
                            } catch (error) {
                                logger.debug('Failed to scroll to bottom after font size change', error);
                            }
                        });
                    }

                    // Only send resize if dimensions actually changed
                    if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                        lastSize.current = { cols, rows };
                        invoke('resize_terminal', { id: terminalId, cols, rows }).catch(err => logger.error("Error:", err));
                    }
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Font size change fit failed:`, e);
                }
            }, 100);
        };

        addEventListener(window, 'font-size-changed', handleFontSizeChange);

        // Send input to backend
        terminal.current.onData((data) => {
            // Gate noisy logs behind a debug flag if needed
            // if (import.meta.env.VITE_DEBUG_TERMINAL) {
            //     logger.info(`[Terminal ${terminalId}] Input length=${data.length}`)
            // }
            invoke('write_terminal', { id: terminalId, data }).catch(err => logger.error("Error:", err));
        });
        
        // Send initialization sequence to ensure proper terminal mode
        // This helps with arrow key handling in some shells
        setTimeout(() => {
            if (terminal.current) {
                // Send a null byte to initialize the terminal properly
                // This helps ensure the shell is in the right mode
                invoke('write_terminal', { id: terminalId, data: '' }).catch(err => logger.error("Error:", err));
            }
        }, 100);

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
            if (wasAtBottom && !isUILayoutChange) {
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
                invoke('resize_terminal', { id: terminalId, cols, rows }).catch(err => logger.error("Error:", err));
            }
        };

        // Use ResizeObserver with more stable debouncing to prevent jitter
        let resizeTimeout: NodeJS.Timeout | null = null;
        let immediateResizeTimeout: NodeJS.Timeout | null = null;
        let lastResizeTime = 0;
        
        // Check if this is a TUI application that needs faster resize response
        const isTuiTerminal = terminalId.includes('opencode') || 
                             terminalId.includes('cursor-agent') || 
                             terminalId.includes('cursor') || 
                             terminalId.includes('gemini') ||
                             terminalId.includes('claude');
        
        addResizeObserver(termRef.current, () => {
            // Skip resize work while user drags the split for smoother UI
            if (document.body.classList.contains('is-split-dragging')) {
                // Clear any pending immediate resize
                if (immediateResizeTimeout) {
                    clearTimeout(immediateResizeTimeout);
                    immediateResizeTimeout = null;
                }
                // Schedule an immediate resize after drag ends
                immediateResizeTimeout = setTimeout(() => {
                    handleResize();
                    immediateResizeTimeout = null;
                }, 100);
                return;
            }
            
            const now = Date.now();
            const timeSinceLastResize = now - lastResizeTime;
            
            // Clear any pending resize
            if (resizeTimeout) clearTimeout(resizeTimeout);
            
            // Perform an immediate resize for the first observation to prevent overflow
            if (timeSinceLastResize > 500) {
                // Do an immediate resize for significant changes
                handleResize();
                lastResizeTime = Date.now();
            } else {
                // Use shorter debounce for TUI applications for better responsiveness
                // TUI apps need faster resize feedback to prevent rendering issues
                const debounceTime = isTuiTerminal 
                    ? 30  // Even faster response for TUI apps
                    : 80; // Reduced debouncing for regular terminals
                
                resizeTimeout = setTimeout(() => {
                    lastResizeTime = Date.now();
                    handleResize();
                }, debounceTime);
            }
        });
        
        // Initial fit pass after mount - delay to ensure renderer is initialized
        // This is important to prevent resize before WebGL is ready
        addTimeout(() => {
            // Only do initial resize if renderer is ready or if we've waited long enough
            if (rendererInitialized || Date.now() - mountTime > 200) {
                handleResize();
            } else {
                // Retry after renderer should be initialized
                addTimeout(() => handleResize(), 100);
            }
        }, 60);

        // After split drag ends, perform a strong fit + resize
        const doFinalFit = () => {
            // Clear any immediate resize timeout from drag
            if (immediateResizeTimeout) {
                clearTimeout(immediateResizeTimeout);
                immediateResizeTimeout = null;
            }
            
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
                        invoke('resize_terminal', { id: terminalId, cols, rows }).catch(err => logger.error("Error:", err));
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
            
            if (resizeTimeout) clearTimeout(resizeTimeout);
            if (immediateResizeTimeout) clearTimeout(immediateResizeTimeout);
            if (fontSizeChangeTimer) clearTimeout(fontSizeChangeTimer);
            
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
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            if (notReadyRetryTimerRef.current) { clearTimeout(notReadyRetryTimerRef.current); notReadyRetryTimerRef.current = null; }
            // Note: We intentionally don't close terminals here to allow switching between sessions
            // All terminals are cleaned up when the app exits via the backend cleanup handler
            // useCleanupRegistry handles other cleanup automatically
        };
    }, [terminalId, addEventListener, addResizeObserver, addTimeout, agentType, isBackground, terminalFontSize]);

    // Reconfigure output listener when agent type changes for the same terminal
    useEffect(() => {
        if (!terminal.current) return;
        if (listenerAgentRef.current === agentType) return;

        // Helper: minimal flush to reuse existing buffering
        const flushQueuedWritesLight = () => {
            if (flushTimerRef.current) return;
            flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                if (!terminal.current || writeQueueRef.current.length === 0) return;
                const chunk = writeQueueRef.current.join('');
                writeQueueRef.current = [];
                terminal.current.write(chunk);
                requestAnimationFrame(() => {
                    try {
                        const buffer = terminal.current!.buffer.active;
                        const atBottom = buffer.viewportY === buffer.baseY;
                        if (atBottom) terminal.current!.scrollToBottom();
                    } catch (e) {
                        logger.warn(`[Terminal ${terminalId}] Failed to scroll after flush:`, e);
                    }
                });
            }, 2);
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
                        writeQueueRef.current.push(output);
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
    }, [agentType, terminalId]);


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
                            await invoke('schaltwerk_core_start_claude_orchestrator', { terminalId, cols, rows });
                            // OPTIMIZATION: Immediate focus and loading state update
                            if (terminal.current) {
                                terminal.current.focus();
                            }
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
                           await invoke('schaltwerk_core_start_claude', { sessionName, cols, rows });
                           // Focus the terminal after Claude starts successfully
                           requestAnimationFrame(() => {
                               if (terminal.current) {
                                   terminal.current.focus();
                               }
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
        const t = setTimeout(start, 0);
        return () => clearTimeout(t);
    }, [hydrated, terminalId, isCommander, sessionName]);

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
    }, [resolvedFontFamily])

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


    const handleTerminalClick = () => {
        // Focus the terminal when clicked
        if (terminal.current) {
            terminal.current.focus()
        }
        // Also notify parent about the click to update focus context
        if (onTerminalClick) {
            onTerminalClick()
        }
    }

    return (
        <div className={`h-full w-full relative overflow-hidden px-2 ${className}`} onClick={handleTerminalClick}>
            <div ref={termRef} className="h-full w-full overflow-hidden" />
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
                <div className="absolute top-2 right-2 flex items-center bg-panel border border-slate-700 rounded px-2 py-1 z-10">
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
