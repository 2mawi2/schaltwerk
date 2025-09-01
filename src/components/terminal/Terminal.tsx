import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { SchaltEvent, listenEvent, listenTerminalOutput, listenTerminalOutputNormalized } from '../../common/eventSystem'
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { invoke } from '@tauri-apps/api/core';
import { UnlistenFn } from '@tauri-apps/api/event';
import { useFontSize } from '../../contexts/FontSizeContext';
import { useCleanupRegistry } from '../../hooks/useCleanupRegistry';
import { theme } from '../../common/theme';
import { AnimatedText } from '../common/AnimatedText';
import '@xterm/xterm/css/xterm.css';

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
}

export interface TerminalHandle {
    focus: () => void;
    showSearch: () => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(({ terminalId, className = '', sessionName, isCommander = false, agentType, onTerminalClick }, ref) => {
    const { terminalFontSize } = useFontSize();
    const { addEventListener, addResizeObserver, addTimeout } = useCleanupRegistry();
    const termRef = useRef<HTMLDivElement>(null);
    const terminal = useRef<XTerm | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    const searchAddon = useRef<SearchAddon | null>(null);
    const webglAddon = useRef<WebglAddon | null>(null);
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
    const unlistenRef = useRef<UnlistenFn | null>(null);
    const unlistenPromiseRef = useRef<Promise<UnlistenFn> | null>(null);
    const mountedRef = useRef<boolean>(false);
    const startingTerminals = useRef<Map<string, boolean>>(new Map());
    const previousTerminalId = useRef<string>(terminalId);

    useImperativeHandle(ref, () => ({
        focus: () => {
            if (terminal.current) {
                terminal.current.focus();
            }
        },
        showSearch: () => {
            setIsSearchVisible(true);
        }
    }), []);

    // Keep hydratedRef in sync so listeners see the latest state
    useEffect(() => {
        hydratedRef.current = hydrated;
    }, [hydrated]);

    // Listen for Claude auto-start events to prevent double-starting
    useEffect(() => {
        let unlistenClaudeStarted: UnlistenFn | null = null;
        
        const setupListener = async () => {
            try {
                unlistenClaudeStarted = await listenEvent(SchaltEvent.ClaudeStarted, (payload) => {
                    console.log(`[Terminal] Received claude-started event for ${payload.terminal_id}`);
                    
                    // Mark the terminal as started globally to prevent auto-start
                    startedGlobal.add(payload.terminal_id);
                });
            } catch (e) {
                console.error('[Terminal] Failed to set up claude-started listener:', e);
            }
        };
        
        setupListener();
        
        return () => {
            if (unlistenClaudeStarted) {
                unlistenClaudeStarted();
            }
        };
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        let cancelled = false;
        if (!termRef.current) {
            console.error(`[Terminal ${terminalId}] No ref available!`);
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
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: terminalFontSize,
            cursorBlink: !isTuiAgent,
            cursorStyle: isTuiAgent ? 'underline' : 'block',
            cursorInactiveStyle: 'outline',
            scrollback: 10000,
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
                    lastSize.current = { cols, rows };
                    console.log(`[Terminal ${terminalId}] Initial fit: ${cols}x${rows} (container: ${containerWidth}x${containerHeight})`);
                } catch (e) {
                    console.warn(`[Terminal ${terminalId}] Initial fit failed:`, e);
                }
            } else {
                // In tests or when container isn't ready, use default dimensions
                console.warn(`[Terminal ${terminalId}] Container dimensions not ready (${containerWidth}x${containerHeight}), using defaults`);
                try {
                    // Set reasonable default dimensions for tests and edge cases
                    terminal.current.resize(80, 24);
                    lastSize.current = { cols: 80, rows: 24 };
                } catch (e) {
                    console.warn(`[Terminal ${terminalId}] Default resize failed:`, e);
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
        
        // Add WebGL addon AFTER terminal is opened to DOM
        // This is critical for proper rendering with TUI applications
        const setupWebGLAcceleration = () => {
            // Check WebGL support before attempting to create addon
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) {
                console.info(`[Terminal ${terminalId}] WebGL not supported, using canvas renderer`);
                return false;
            }

            // Skip WebGL on mobile devices for better compatibility
            const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            if (isMobile) {
                console.info(`[Terminal ${terminalId}] Mobile device detected, using canvas renderer for compatibility`);
                return false;
            }

            try {
                webglAddon.current = new WebglAddon();
                terminal.current!.loadAddon(webglAddon.current);
                
                // Enhanced context loss handling with restoration attempt
                webglAddon.current.onContextLoss(() => {
                    console.warn(`[Terminal ${terminalId}] WebGL context lost, attempting restoration`);
                    
                    // Attempt to restore WebGL context after a brief delay
                    setTimeout(() => {
                        if (webglAddon.current && !cancelled) {
                            try {
                                // Check if context can be restored
                                const testCanvas = document.createElement('canvas');
                                const testGl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
                                
                                if (testGl) {
                                    console.info(`[Terminal ${terminalId}] WebGL context restoration possible, recreating addon`);
                                    const oldAddon = webglAddon.current;
                                    oldAddon.dispose();
                                    
                                    webglAddon.current = new WebglAddon();
                                    terminal.current?.loadAddon(webglAddon.current);
                                    console.info(`[Terminal ${terminalId}] WebGL acceleration restored`);
                                } else {
                                    console.warn(`[Terminal ${terminalId}] WebGL context restoration failed, permanently using canvas renderer`);
                                    webglAddon.current.dispose();
                                    webglAddon.current = null;
                                }
                            } catch (restoreError) {
                                console.warn(`[Terminal ${terminalId}] WebGL restoration failed:`, restoreError);
                                if (webglAddon.current) {
                                    webglAddon.current.dispose();
                                    webglAddon.current = null;
                                }
                            }
                        }
                    }, 1000);
                });

                console.info(`[Terminal ${terminalId}] WebGL acceleration enabled`);
                return true;
                
            } catch (error: any) {
                if (error.name === 'SecurityError') {
                    console.info(`[Terminal ${terminalId}] WebGL blocked by security policy, using canvas renderer`);
                } else if (error.message?.includes('blacklisted')) {
                    console.info(`[Terminal ${terminalId}] WebGL blacklisted on this system, using canvas renderer`);
                } else {
                    console.warn(`[Terminal ${terminalId}] WebGL addon failed to load, using canvas renderer:`, error);
                }
                webglAddon.current = null;
                return false;
            }
        };

        // Smart WebGL initialization with fallback strategy (similar to VSCode)
        // Start with Canvas for immediate compatibility, then try WebGL
        let rendererInitialized = false;
        const initializeRenderer = () => {
            if (rendererInitialized || cancelled || !terminal.current || !termRef.current) {
                return;
            }
            
            // Only initialize when container has proper dimensions
            if (termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
                rendererInitialized = true;
                try {
                    // Ensure terminal is properly fitted before WebGL
                    if (fitAddon.current && terminal.current) {
                        fitAddon.current.fit();
                    }
                    const webglEnabled = setupWebGLAcceleration();
                    if (!webglEnabled) {
                        console.info(`[Terminal ${terminalId}] Falling back to Canvas renderer`);
                    }
                } catch (e) {
                    console.warn(`[Terminal ${terminalId}] WebGL initialization failed, using Canvas:`, e);
                }
            }
        };
        
        // Use ResizeObserver to deterministically initialize renderer when container is ready
        // This avoids polling and ensures we initialize exactly once when dimensions are available
        const rendererObserver = new ResizeObserver((entries) => {
            if (entries.length > 0 && !rendererInitialized) {
                const entry = entries[0];
                if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
                    // Container now has dimensions, initialize renderer
                    requestAnimationFrame(() => {
                        initializeRenderer();
                    });
                }
            }
        });
        
        // Start observing the terminal container
        rendererObserver.observe(termRef.current);
        
        // Also try immediate initialization in case container already has dimensions
        requestAnimationFrame(() => {
            initializeRenderer();
        });

        // Intercept global shortcuts before xterm.js processes them
        terminal.current.attachCustomKeyEventHandler((event: KeyboardEvent) => {
            const isMac = navigator.userAgent.includes('Mac')
            const modifierKey = isMac ? event.metaKey : event.ctrlKey
            
            // Cmd+Enter for new line (like Claude Code)
            if (modifierKey && event.key === 'Enter' && event.type === 'keydown') {
                // Send a newline character without submitting the command
                // This allows multiline input in shells that support it
                invoke('write_terminal', { id: terminalId, data: '\n' }).catch(console.error);
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
                if (!isReadyForFit() || !fitAddon.current) return;
                try {
                    fitAddon.current.fit();
                } catch {
                    // ignore single-shot fit error; RO will retry
                }
            });
        };
        if (isReadyForFit()) {
            scheduleInitialFit();
        }

        const initialCols = terminal.current.cols;
        const initialRows = terminal.current.rows;
        lastSize.current = { cols: initialCols, rows: initialRows };

        // Send initial size to backend immediately
        invoke('resize_terminal', { id: terminalId, cols: initialCols, rows: initialRows }).catch(console.error);

        // Flush queued writes with minimal delay for responsiveness
        const flushQueuedWrites = () => {
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
                            // Silently ignore scroll errors during normal operation
                        }
                    }
                });
            }, 2);
        };

        // Immediate flush helper (no debounce), used during hydration transitions
        const flushNow = () => {
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
                        // Silently ignore scroll errors during flush
                    }
                }
            });
        };

        // Listen for terminal output from backend (buffer until hydrated)
        unlistenRef.current = null;
        if (agentType === 'codex') {
            unlistenPromiseRef.current = listenTerminalOutputNormalized(terminalId, (output) => {
                if (cancelled) return;
                if (!hydratedRef.current) {
                    pendingOutput.current.push(output);
                } else {
                    writeQueueRef.current.push(output);
                    flushQueuedWrites();
                }
            }).then((fn) => { unlistenRef.current = fn; return fn; });
        } else {
            unlistenPromiseRef.current = listenTerminalOutput(terminalId, (output) => {
                if (cancelled) return;
                if (!hydratedRef.current) {
                    pendingOutput.current.push(output);
                } else {
                    writeQueueRef.current.push(output);
                    flushQueuedWrites();
                }
            }).then((fn) => { unlistenRef.current = fn; return fn; });
        }

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
                  
                  // Scroll to bottom after hydration to show latest content
                  requestAnimationFrame(() => {
                      if (terminal.current) {
                          try {
                              terminal.current.scrollToBottom();
                          } catch (error) {
                              console.warn(`[Terminal ${terminalId}] Failed to scroll to bottom after hydration:`, error);
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
                console.error(`[Terminal ${terminalId}] Failed to hydrate:`, error);
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
                                console.warn(`[Terminal ${terminalId}] Failed to scroll to bottom after hydration failure:`, error);
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
                console.warn(`[Terminal ${terminalId}] Failed to capture scroll position:`, error);
                wasAtBottom = true;
            }
            
            return { wasAtBottom, scrollPosition };
        };

        const restoreScrollPosition = (wasAtBottom: boolean, scrollPosition: number) => {
            if (wasAtBottom || !terminal.current) return;
            
            try {
                const buffer = terminal.current.buffer.active;
                // Only preserve scroll for terminals with substantial content
                if (buffer.length > 50) {
                    const maxScroll = Math.max(0, buffer.baseY - terminal.current.rows + 1);
                    const targetScroll = Math.min(scrollPosition, maxScroll);
                    terminal.current.scrollToLine(targetScroll);
                }
            } catch (error) {
                console.warn(`[Terminal ${terminalId}] Failed to restore scroll position:`, error);
            }
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
                const { wasAtBottom, scrollPosition } = captureScrollPosition();

                try {
                    fitAddon.current.fit();
                    const { cols, rows } = terminal.current;

                    // Restore scroll position after font size change
                    restoreScrollPosition(wasAtBottom, scrollPosition);

                    // Only send resize if dimensions actually changed
                    if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                        lastSize.current = { cols, rows };
                        invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
                    }
                } catch (e) {
                    console.warn(`[Terminal ${terminalId}] Font size change fit failed:`, e);
                }
            }, 100);
        };

        addEventListener(window, 'font-size-changed', handleFontSizeChange);

        // Send input to backend
        terminal.current.onData((data) => {
            // Gate noisy logs behind a debug flag if needed
            // if (import.meta.env.VITE_DEBUG_TERMINAL) {
            //     console.log(`[Terminal ${terminalId}] Input length=${data.length}`)
            // }
            invoke('write_terminal', { id: terminalId, data }).catch(console.error);
        });
        
        // Send initialization sequence to ensure proper terminal mode
        // This helps with arrow key handling in some shells
        setTimeout(() => {
            if (terminal.current) {
                // Send a null byte to initialize the terminal properly
                // This helps ensure the shell is in the right mode
                invoke('write_terminal', { id: terminalId, data: '' }).catch(console.error);
            }
        }, 100);

        // Handle terminal resize - only send if size actually changed
        const handleResize = () => {
            if (!fitAddon.current || !terminal.current) return;

            const el = termRef.current;
            if (!el || !el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) {
                return;
            }

            // Capture scroll position before resize
            const { wasAtBottom, scrollPosition } = captureScrollPosition();

            try {
                // Force a proper fit with accurate dimensions
                fitAddon.current.fit();
            } catch (e) {
                console.warn(`[Terminal ${terminalId}] fit() failed during resize; skipping this tick`, e);
                return;
            }
            const { cols, rows } = terminal.current;

            // Restore scroll position after resize
            restoreScrollPosition(wasAtBottom, scrollPosition);

            // Only send resize if dimensions actually changed
            if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                lastSize.current = { cols, rows };
                // Send resize command immediately to update PTY size
                invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
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
        
        // Initial fit pass after mount
        addTimeout(() => handleResize(), 60);

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
                        const { wasAtBottom, scrollPosition } = captureScrollPosition();

                        // Force a complete refit after drag ends
                        fitAddon.current.fit();
                        const { cols, rows } = terminal.current;
                        
                        // Restore scroll position after final fit
                        restoreScrollPosition(wasAtBottom, scrollPosition);

                        lastSize.current = { cols, rows };
                        invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
                    });
                }
            } catch (error) {
                console.error(`[Terminal ${terminalId}] Final fit error:`, error);
            }
        };
        addEventListener(window, 'terminal-split-drag-end', doFinalFit);
        addEventListener(window, 'right-panel-split-drag-end', doFinalFit);

        // Cleanup - dispose UI but keep terminal process running
        // Terminal processes will be cleaned up when the app exits
        return () => {
            mountedRef.current = false;
            cancelled = true;
            
            if (resizeTimeout) clearTimeout(resizeTimeout);
            if (immediateResizeTimeout) clearTimeout(immediateResizeTimeout);
            if (fontSizeChangeTimer) clearTimeout(fontSizeChangeTimer);
            
            // Synchronously detach if possible to avoid races in tests
            const fn = unlistenRef.current;
            if (fn) { try { fn(); } catch (error) {
                console.error(`[Terminal ${terminalId}] Event listener cleanup error:`, error);
            }}
            else if (unlistenPromiseRef.current) {
                // Detach once promise resolves
                unlistenPromiseRef.current.then((resolved) => { 
                    try { resolved(); } catch (error) {
                        console.error(`[Terminal ${terminalId}] Async event listener cleanup error:`, error);
                    }
                });
            }
            
            rendererObserver.disconnect();
            webglAddon.current?.dispose();
            webglAddon.current = null;
            terminal.current?.dispose();
            terminal.current = null;
            setHydrated(false);
            pendingOutput.current = [];
            writeQueueRef.current = [];
            if (rafIdRef.current != null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            // Note: We intentionally don't close terminals here to allow switching between sessions
            // All terminals are cleaned up when the app exits via the backend cleanup handler
            // useCleanupRegistry handles other cleanup automatically
        };
    }, [terminalId]); // Recreate only when terminalId changes


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
                            await invoke('schaltwerk_core_start_claude_orchestrator', { terminalId });
                            // OPTIMIZATION: Immediate focus and loading state update
                            if (terminal.current) {
                                terminal.current.focus();
                            }
                            setAgentLoading(false);
                      } catch (e) {
                         // Roll back start flags on failure to allow retry
                         startedGlobal.delete(terminalId);
                         console.error(`[Terminal ${terminalId}] Failed to start Claude:`, e);
                        
                        // Check if it's a permission error and dispatch event
                        const errorMessage = String(e);
                        if (errorMessage.includes('No project is currently open')) {
                            // Handle no project error
                            console.error(`[Terminal ${terminalId}] No project open:`, errorMessage);
                            window.dispatchEvent(new CustomEvent('schaltwerk:no-project-error', {
                                detail: { error: errorMessage, terminalId }
                            }));
                        } else if (errorMessage.includes('Permission required for folder:')) {
                            window.dispatchEvent(new CustomEvent('schaltwerk:permission-error', {
                                detail: { error: errorMessage }
                            }));
                        } else if (errorMessage.includes('Failed to spawn command')) {
                            // Log more details about spawn failures
                            console.error(`[Terminal ${terminalId}] Spawn failure details:`, errorMessage);
                            // Dispatch a specific event for spawn failures
                            window.dispatchEvent(new CustomEvent('schaltwerk:spawn-error', {
                                detail: { error: errorMessage, terminalId }
                            }));
                         } else if (errorMessage.includes('not a git repository')) {
                             // Handle non-git repository error
                             console.error(`[Terminal ${terminalId}] Not a git repository:`, errorMessage);
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
                           await invoke('schaltwerk_core_start_claude', { sessionName });
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
                         console.error(`[Terminal ${terminalId}] Failed to start Claude for session ${sessionName}:`, e);
                        
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
                  console.error(`[Terminal ${terminalId}] Failed to auto-start Claude:`, error);
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

    // Force scroll to bottom when switching sessions
    useEffect(() => {
        if (previousTerminalId.current !== terminalId) {
            // Terminal ID changed - this is a session switch
            if (terminal.current) {
                requestAnimationFrame(() => {
                    try {
                        terminal.current?.scrollToBottom();
                    } catch (error) {
                        console.warn(`[Terminal ${terminalId}] Failed to scroll to bottom on session switch:`, error);
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
        <div className={`h-full w-full relative ${className}`} onClick={handleTerminalClick}>
            <div ref={termRef} className="h-full w-full" />
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
