import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useFontSize } from '../../contexts/FontSizeContext';
import 'xterm/css/xterm.css';

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
    isOrchestrator?: boolean;
}

export interface TerminalHandle {
    focus: () => void;
    showSearch: () => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(({ terminalId, className = '', sessionName, isOrchestrator = false }, ref) => {
    const { terminalFontSize } = useFontSize();
    const termRef = useRef<HTMLDivElement>(null);
    const terminal = useRef<XTerm | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    const searchAddon = useRef<SearchAddon | null>(null);
    const webglAddon = useRef<WebglAddon | null>(null);
    const lastSize = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
    const [hydrated, setHydrated] = useState(false);
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
    const startAttempts = useRef<Map<string, number>>(new Map());
    const mountedRef = useRef<boolean>(false);
    const startingTerminals = useRef<Map<string, boolean>>(new Map());

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

        terminal.current = new XTerm({
            theme: {
                background: '#0b1220', // Match bg-panel color from web-ui
                foreground: '#e4e4e7',
                cursor: '#e4e4e7',
                black: '#1e293b',
                red: '#ef4444',
                green: '#22c55e',
                yellow: '#eab308',
                blue: '#3b82f6',
                magenta: '#a855f7',
                cyan: '#06b6d4',
                white: '#e4e4e7',
                brightBlack: '#475569',
                brightRed: '#f87171',
                brightGreen: '#86efac',
                brightYellow: '#fde047',
                brightBlue: '#60a5fa',
                brightMagenta: '#c084fc',
                brightCyan: '#67e8f9',
                brightWhite: '#f1f5f9',
            },
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: terminalFontSize,
            cursorBlink: true,
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
        const initializeRenderer = () => {
            if (!cancelled && terminal.current && termRef.current) {
                // Skip WebGL for known problematic terminal types
                const isProblematicTerminal = terminalId.includes('session-') && !terminalId.includes('orchestrator');
                
                if (isProblematicTerminal) {
                    // Session terminals that run TUI apps - use Canvas for compatibility
                    console.info(`[Terminal ${terminalId}] Using Canvas renderer for TUI app compatibility`);
                    return;
                }
                
                // For orchestrator terminals, try WebGL with proper error handling
                if (termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
                    try {
                        fitAddon.current?.fit();
                        const webglEnabled = setupWebGLAcceleration();
                        if (!webglEnabled) {
                            console.info(`[Terminal ${terminalId}] Falling back to Canvas renderer`);
                        }
                    } catch (e) {
                        console.warn(`[Terminal ${terminalId}] WebGL initialization failed, using Canvas:`, e);
                    }
                } else {
                    // Retry if container not yet sized
                    setTimeout(() => initializeRenderer(), 100);
                }
            }
        };
        
        // Delay renderer initialization to ensure terminal is ready
        // This avoids the WebGL timing issues with initial data
        requestAnimationFrame(() => {
            setTimeout(() => initializeRenderer(), 50);
        });

        // Intercept global shortcuts before xterm.js processes them
        terminal.current.attachCustomKeyEventHandler((event: KeyboardEvent) => {
            const isMac = navigator.userAgent.includes('Mac')
            const modifierKey = isMac ? event.metaKey : event.ctrlKey
            
            // Kanban board shortcut: Cmd+Shift+K
            if (modifierKey && event.shiftKey && (event.key === 'k' || event.key === 'K')) {
                window.dispatchEvent(new CustomEvent('global-kanban-shortcut'))
                return false
            }
            // Prefer Shift+Cmd/Ctrl+N as "New draft"
            if (modifierKey && event.shiftKey && (event.key === 'n' || event.key === 'N')) {
                window.dispatchEvent(new CustomEvent('schaltwerk:new-draft'))
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
        
        // For OpenCode terminals, send additional resize events to ensure proper TUI layout
        // But delay them longer to avoid conflicts with the mounting process
        if (terminalId.includes('session-') && !terminalId.includes('orchestrator')) {
            setTimeout(() => {
                if (terminal.current && termRef.current) {
                    try {
                        const addon = fitAddon.current;
                        if (!addon) return;
                        addon.fit();
                        const { cols, rows } = terminal.current;
                        // Only send if we got reasonable dimensions
                        if (cols > 80 && rows > 24) {
                            invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
                        }
                    } catch (e) {
                        console.warn('OpenCode resize failed:', e);
                    }
                }
            }, 1500);
            setTimeout(() => {
                if (terminal.current && termRef.current) {
                    try {
                        const addon = fitAddon.current;
                        if (!addon) return;
                        addon.fit();
                        const { cols, rows } = terminal.current;
                        invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
                    } catch (e) {
                        console.warn('OpenCode resize failed:', e);
                    }
                }
            }, 3000);
        }

        // Flush queued writes once per frame
        const flushQueuedWrites = () => {
            if (flushTimerRef.current) return;
            // Use a short timeout to coalesce multiple events and be test-friendly with fake timers
            flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                if (!terminal.current || writeQueueRef.current.length === 0) return;
                const chunk = writeQueueRef.current.join('');
                writeQueueRef.current = [];
                terminal.current.write(chunk);
            }, 16);
        };

        // Immediate flush helper (no debounce), used during hydration transitions
        const flushNow = () => {
            if (!terminal.current || writeQueueRef.current.length === 0) return;
            const chunk = writeQueueRef.current.join('');
            writeQueueRef.current = [];
            terminal.current.write(chunk);
        };

        // Listen for terminal output from backend (buffer until hydrated)
        unlistenRef.current = null;
        unlistenPromiseRef.current = listen(`terminal-output-${terminalId}`, (event) => {
            if (cancelled) return;
            const output = event.payload as string;
            if (!hydratedRef.current) {
                pendingOutput.current.push(output);
            } else {
                writeQueueRef.current.push(output);
                flushQueuedWrites();
            }
        }).then((fn) => { unlistenRef.current = fn; return fn; });

        // Hydrate from buffer
        const hydrateTerminal = async () => {
            try {
                const snapshot = await invoke<string>('get_terminal_buffer', { id: terminalId });
                
                if (snapshot) {
                    // Check if the snapshot contains enough data to have scrollback
                    const lineCount = (snapshot.match(/\n/g) || []).length;
                    const hasSignificantContent = lineCount > terminal.current!.rows;
                    
                    writeQueueRef.current.push(snapshot);
                    
                    // If we have significant content, try to scroll to bottom after rendering
                    // This prevents the terminal from appearing at the top of the scrollback
                    if (hasSignificantContent) {
                        requestAnimationFrame(() => {
                            if (terminal.current && terminal.current.buffer && terminal.current.buffer.active) {
                                try {
                                    // Scroll to the bottom (most recent output)
                                    terminal.current.scrollToBottom();
                                } catch (e) {
                                    // Scroll API might not be available
                                }
                            }
                        });
                    }
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
                }
            }
        };

        hydrateTerminal();

        // Handle font size changes
        const handleFontSizeChange = () => {
            if (terminal.current) {
                terminal.current.options.fontSize = terminalFontSize;
                if (fitAddon.current) {
                    // Small delay to ensure the font change is processed
                    setTimeout(() => {
                        if (fitAddon.current && terminal.current) {
                            try {
                                fitAddon.current.fit();
                                const { cols, rows } = terminal.current;
                                lastSize.current = { cols, rows };
                                invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
                            } catch (e) {
                                console.warn(`[Terminal ${terminalId}] Font size change fit failed:`, e);
                            }
                        }
                    }, 50);
                }
            }
        };

        window.addEventListener('font-size-changed', handleFontSizeChange);

        // Send input to backend
        terminal.current.onData((data) => {
            // Gate noisy logs behind a debug flag if needed
            // if (import.meta.env.VITE_DEBUG_TERMINAL) {
            //     console.log(`[Terminal ${terminalId}] Input length=${data.length}`)
            // }
            invoke('write_terminal', { id: terminalId, data }).catch(console.error);
        });

        // Handle terminal resize - only send if size actually changed
        const handleResize = () => {
            if (!fitAddon.current || !terminal.current) return;

            const el = termRef.current;
            if (!el || !el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) {
                return;
            }

            try {
                fitAddon.current.fit();
            } catch (e) {
                console.warn(`[Terminal ${terminalId}] fit() failed during resize; skipping this tick`, e);
                return;
            }
            const { cols, rows } = terminal.current;
            
            // Only send resize if dimensions actually changed
            if (cols !== lastSize.current.cols || rows !== lastSize.current.rows) {
                // For OpenCode session terminals, prevent downgrading to small sizes
                // unless it's a legitimate resize (like window resize)
                const isSessionTerminal = terminalId.includes('session-') && !terminalId.includes('orchestrator');
                const isDowngrading = (cols < lastSize.current.cols || rows < lastSize.current.rows);
                const isTooSmall = cols < 100 || rows < 30;
                
                if (isSessionTerminal && isDowngrading && isTooSmall) {
                    console.log(`[Terminal ${terminalId}] Ignoring small resize: ${cols}x${rows} (was ${lastSize.current.cols}x${lastSize.current.rows})`);
                    return;
                }
                
                lastSize.current = { cols, rows };
                invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
            }
        };

        // Use ResizeObserver with a more conservative debounce for better performance
        let resizeTimeout: NodeJS.Timeout | null = null;
        const resizeObserver = new ResizeObserver(() => {
            // Skip resize work while user drags the split for smoother UI
            if (document.body.classList.contains('is-split-dragging')) {
                return;
            }
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                handleResize();
            }, 120); // slightly tighter debounce for snappier feel
        });
        resizeObserver.observe(termRef.current);
        // Initial fit pass after mount
        const mountTimeout = setTimeout(() => handleResize(), 60);

        // After split drag ends, perform a strong fit + resize
        const doFinalFit = () => {
            try {
                if (fitAddon.current && terminal.current) {
                    fitAddon.current.fit();
                    const { cols, rows } = terminal.current;
                    lastSize.current = { cols, rows };
                    invoke('resize_terminal', { id: terminalId, cols, rows }).catch(console.error);
                }
            } catch {}
        };
        window.addEventListener('terminal-split-drag-end', doFinalFit);

        // Cleanup - dispose UI but keep terminal process running
        // Terminal processes will be cleaned up when the app exits
        return () => {
            mountedRef.current = false;
            cancelled = true;
            
            if (resizeTimeout) clearTimeout(resizeTimeout);
            clearTimeout(mountTimeout);
            window.removeEventListener('terminal-split-drag-end', doFinalFit);
            // Synchronously detach if possible to avoid races in tests
            const fn = unlistenRef.current;
            if (fn) { try { fn(); } catch { /* ignore */ } }
            else if (unlistenPromiseRef.current) {
                // Detach once promise resolves
                unlistenPromiseRef.current.then((resolved) => { try { resolved(); } catch { /* ignore */ } });
            }
            window.removeEventListener('font-size-changed', handleFontSizeChange);
            webglAddon.current?.dispose();
            webglAddon.current = null;
            terminal.current?.dispose();
            terminal.current = null;
            resizeObserver.disconnect();
            setHydrated(false);
            pendingOutput.current = [];
            writeQueueRef.current = [];
            if (rafIdRef.current != null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            // Note: We intentionally don't close terminals here to allow switching between sessions
            // All terminals are cleaned up when the app exits via the backend cleanup handler
        };
    }, [terminalId, terminalFontSize]); // Recreate when terminalId or fontSize changes


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
            try {
                if (isOrchestrator || (terminalId.includes('orchestrator') && terminalId.endsWith('-top'))) {
                    const exists = await invoke<boolean>('terminal_exists', { id: terminalId });
                    if (!exists) {
                        const attempts = (startAttempts.current.get(terminalId) || 0) + 1;
                        if (attempts <= 10) {
                            startAttempts.current.set(terminalId, attempts);
                            startingTerminals.current.set(terminalId, false);
                            setTimeout(start, 150);
                            return;
                        }
                        startingTerminals.current.set(terminalId, false);
                        return;
                    }
                    // Mark as started BEFORE invoking to prevent overlaps
                    startedGlobal.add(terminalId);
                    try {
                        await invoke('para_core_start_claude_orchestrator', { terminalId });
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
                    const exists = await invoke<boolean>('terminal_exists', { id: terminalId });
                    if (!exists) {
                        const attempts = (startAttempts.current.get(terminalId) || 0) + 1;
                        if (attempts <= 10) {
                            startAttempts.current.set(terminalId, attempts);
                            startingTerminals.current.set(terminalId, false);
                            setTimeout(start, 150);
                            return;
                        }
                        startingTerminals.current.set(terminalId, false);
                        return;
                    }
                    // Mark as started BEFORE invoking to prevent overlaps
                    startedGlobal.add(terminalId);
                    try {
                        await invoke('para_core_start_claude', { sessionName });
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
                    startingTerminals.current.set(terminalId, false);
                }
            } catch (error) {
                console.error(`[Terminal ${terminalId}] Failed to auto-start Claude:`, error);
                startingTerminals.current.set(terminalId, false);
            }
        };

        // Delay a tick to ensure xterm is laid out
        const t = setTimeout(start, 0);
        return () => clearTimeout(t);
    }, [hydrated, terminalId, isOrchestrator, sessionName]);


    return (
        <div className={`h-full w-full ${className}`}>
            <div ref={termRef} className="h-full w-full" />
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