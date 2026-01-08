import { useEffect, useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback, useMemo, memo } from 'react';
import { TauriCommands } from '../../common/tauriCommands'
import { SchaltEvent, listenEvent } from '../../common/eventSystem'
import { UiEvent, emitUiEvent, listenUiEvent } from '../../common/uiEvents'
import {
  isTerminalStartingOrStarted,
  markTerminalStarted,
  clearTerminalStartState,
} from '../../common/terminalStartState'
import { recordTerminalSize } from '../../common/terminalSizeCache'
import { Terminal as XTerm, type IDisposable } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import { invoke } from '@tauri-apps/api/core'
import { startOrchestratorTop, startSessionTop, AGENT_START_TIMEOUT_MESSAGE } from '../../common/agentSpawn'
import { schedulePtyResize } from '../../common/ptyResizeScheduler'
import { isTopTerminalId, sessionTerminalBase } from '../../common/terminalIdentity'
import { getActiveAgentTerminalId } from '../../common/terminalTargeting'
import { UnlistenFn } from '@tauri-apps/api/event';
import { useAtomValue, useSetAtom } from 'jotai'
import { previewStateAtom, setPreviewUrlActionAtom } from '../../store/atoms/preview'
import { resolvedThemeAtom } from '../../store/atoms/theme'
import { LocalPreviewWatcher } from '../../features/preview/localPreview'
import type { AutoPreviewConfig } from '../../utils/runScriptPreviewConfig'
import { useCleanupRegistry } from '../../hooks/useCleanupRegistry';
import { useTerminalConfig } from '../../hooks/useTerminalConfig';
import { buildTerminalTheme } from '../../common/themes/terminalTheme'
import type { ResolvedTheme } from '../../common/themes/types'
import { isTuiAgent } from '../../types/session';
import '@xterm/xterm/css/xterm.css';
import './xtermOverrides.css';
import { logger } from '../../utils/logger'
import { useModal } from '../../contexts/ModalContext'
import { safeTerminalFocus, safeTerminalFocusImmediate } from '../../utils/safeFocus'
import { TerminalLoadingOverlay } from './TerminalLoadingOverlay'
import { TerminalSearchPanel } from './TerminalSearchPanel'
import { detectPlatformSafe } from '../../keyboardShortcuts/helpers'
import { writeTerminalBackend } from '../../terminal/transport/backend'
import { buildBracketedPasteChunks } from '../../terminal/paste/bracketedPaste'
import {
    acquireTerminalInstance,
    attachTerminalInstance,
    detachTerminalInstance,
    hasTerminalInstance,
    isTerminalBracketedPasteEnabled,
} from '../../terminal/registry/terminalRegistry'
import { XtermTerminal } from '../../terminal/xterm/XtermTerminal'
import { useTerminalGpu } from '../../hooks/useTerminalGpu'
import { TerminalResizeCoordinator } from './resize/TerminalResizeCoordinator'
import {
    calculateEffectiveColumns,
    MIN_TERMINAL_COLUMNS,
    MIN_TERMINAL_ROWS,
    MIN_PROPOSED_COLUMNS,
    isMeasurementTooSmall,
} from './terminalSizing'
import { shouldEmitControlPaste, shouldEmitControlNewline } from './terminalKeybindings'
import { parseTerminalFileReference, resolveTerminalFileReference } from '../../terminal/xterm/fileLinks/terminalFileLinks'

import { TERMINAL_FILE_DRAG_TYPE, type TerminalFileDragPayload } from '../../common/dragTypes'
import { TerminalScrollButton } from './TerminalScrollButton'

const CLAUDE_SHIFT_ENTER_SEQUENCE = '\\'
// Track last effective size we told the PTY (after guard), for SIGWINCH nudging
const lastEffectiveRefInit = { cols: 80, rows: 24 }

const RESIZE_PIXEL_EPSILON = 0.75
const MIN_PIXEL_WHEEL_STEP = 40;

const classifyWheelEvent = (event: WheelEvent, previous: boolean): boolean => {
    if (typeof WheelEvent !== 'undefined') {
        if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
            return true;
        }
        if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
            const magnitude = Math.abs(event.deltaY);
            if (!Number.isFinite(magnitude) || magnitude === 0) {
                return previous;
            }
            if (Number.isInteger(magnitude) && magnitude >= MIN_PIXEL_WHEEL_STEP) {
                return true;
            }
            if (magnitude < 10) {
                return false;
            }
            return previous;
        }
    }
    return previous;
}

// Export function to clear started tracking for specific terminals
export function clearTerminalStartedTracking(terminalIds: string[]) {
    clearTerminalStartState(terminalIds)
}

export interface TerminalProps {
    terminalId: string;
    className?: string;
    sessionName?: string;
    isCommander?: boolean;
    agentType?: string;
    readOnly?: boolean;
    onTerminalClick?: () => void;
    onReady?: () => void;
    inputFilter?: (data: string) => boolean;
    workingDirectory?: string;
    previewKey?: string;
    autoPreviewConfig?: AutoPreviewConfig;
}

export interface TerminalHandle {
    focus: () => void;
    showSearch: () => void;
    scrollToBottom: () => void;
    scrollLineUp: () => void;
    scrollLineDown: () => void;
    scrollPageUp: () => void;
    scrollPageDown: () => void;
    scrollToTop: () => void;
}

type TerminalFileLinkHandler = (text: string) => Promise<boolean> | boolean;

const normalizeForComparison = (value: string) => value.replace(/\\/g, '/');

const isPathWithinBase = (basePath: string, candidatePath: string) => {
    const baseNormalized = normalizeForComparison(basePath);
    const candidateNormalized = normalizeForComparison(candidatePath);
    const baseWithSlash = baseNormalized.endsWith('/') ? baseNormalized : `${baseNormalized}/`;
    return candidateNormalized === baseNormalized || candidateNormalized.startsWith(baseWithSlash);
};

const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(({ terminalId, className = '', sessionName, isCommander = false, agentType, readOnly = false, onTerminalClick, onReady, inputFilter, workingDirectory, previewKey, autoPreviewConfig }, ref) => {
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
    const layoutSuspendedRef = useRef(false);
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
    const fileLinkHandlerRef = useRef<TerminalFileLinkHandler | null>(null);
    const scrollDebugRef = useRef<{ lastY: number; lastTime: number; changes: number[] }>({ lastY: -1, lastTime: 0, changes: [] });
    const debugCountersRef = useRef<{ scrollEvents: number; initRuns: number }>({ scrollEvents: 0, initRuns: 0 });
    const termDebug = () => (typeof window !== 'undefined' && localStorage.getItem('TERMINAL_DEBUG') === '1');

    const getScrollSnapshot = useCallback(() => {
        const term = terminal.current;
        const el = termRef.current;
        if (!term) return null;
        try {
            const buf = term.buffer?.active;
            return {
                cols: term.cols,
                rows: term.rows,
                bufferType: (buf as unknown as { type?: string })?.type,
                baseY: buf?.baseY,
                viewportY: buf?.viewportY,
                cursorY: (buf as unknown as { cursorY?: number })?.cursorY,
                length: buf?.length,
                container: el ? { w: el.clientWidth, h: el.clientHeight } : undefined,
            };
        } catch (error) {
            return { error: String(error) };
        }
    }, []);

    const logScrollSnapshot = useCallback((source: string, extra?: Record<string, unknown>) => {
        if (!termDebug()) return;
        const snap = getScrollSnapshot();
        logger.debug(`[Terminal ${terminalId}] [scroll-snap] ${source}`, { ...extra, ...snap });
    }, [getScrollSnapshot, terminalId]);
    const logScrollChange = useCallback((source: string) => {
        const term = terminal.current;
        if (!term) return;
        const viewportY = term.buffer.active.viewportY;
        const baseY = term.buffer.active.baseY;
        const now = performance.now();
        const debug = scrollDebugRef.current;
        const delta = debug.lastY >= 0 ? viewportY - debug.lastY : 0;
        const timeDelta = debug.lastTime > 0 ? now - debug.lastTime : 0;
        debugCountersRef.current.scrollEvents += 1;
        const debugEnabled = termDebug();
        if (Math.abs(delta) > 0 && timeDelta < 500) {
            debug.changes.push(delta);
            if (debug.changes.length > 10) debug.changes.shift();
            const hasOscillation = debug.changes.length >= 4 &&
                debug.changes.slice(-4).some((d, i, arr) => i > 0 && Math.sign(d) !== Math.sign(arr[i-1]));
            if (hasOscillation) {
                logger.warn(`[Terminal ${terminalId}] OSCILLATION DETECTED source=${source} viewportY=${viewportY} baseY=${baseY} delta=${delta} timeDelta=${timeDelta.toFixed(0)}ms changes=[${debug.changes.join(',')}]`);
                logScrollSnapshot(`${source}:oscillation`, { delta, timeDelta });
            } else if (Math.abs(delta) > 5) {
                logger.debug(`[Terminal ${terminalId}] Scroll jump source=${source} viewportY=${viewportY} baseY=${baseY} delta=${delta} timeDelta=${timeDelta.toFixed(0)}ms`);
                logScrollSnapshot(`${source}:jump`, { delta, timeDelta });
            } else if (debugEnabled && (debugCountersRef.current.scrollEvents % 25 === 0)) {
                logScrollSnapshot(`${source}:periodic`, { delta, timeDelta });
            }
        }
        debug.lastY = viewportY;
        debug.lastTime = now;
    }, [terminalId, logScrollSnapshot]);
    const getPreviewState = useAtomValue(previewStateAtom)
    const setPreviewUrl = useSetAtom(setPreviewUrlActionAtom)
    const resolvedTheme = useAtomValue(resolvedThemeAtom)
    const resolvedThemeRef = useRef(resolvedTheme)
    resolvedThemeRef.current = resolvedTheme
    const previewWatcherRef = useRef<LocalPreviewWatcher | null>(null)
    const previewLogStateRef = useRef<{ disabled: boolean; missing: boolean; ready: boolean }>({ disabled: false, missing: false, ready: false })
    const openFileFromTerminal = useCallback(async (text: string) => {
        if (!workingDirectory) return false;
        const parsed = parseTerminalFileReference(text);
        if (!parsed) return false;
        const resolvedPath = resolveTerminalFileReference(parsed, workingDirectory);
        if (!resolvedPath) return false;

        if (!isPathWithinBase(workingDirectory, resolvedPath)) {
            try {
                const projectRoot = await invoke<string | null>(TauriCommands.GetActiveProjectPath);
                const openRoot = projectRoot ?? workingDirectory;

                const appId = await invoke<string>(TauriCommands.GetDefaultOpenApp);
                await invoke(TauriCommands.OpenInApp, {
                    appId,
                    worktreeRoot: openRoot,
                    worktreePath: openRoot, // backward compat
                    targetPath: resolvedPath,
                    line: parsed.startLine,
                });
                return true;
            } catch (error) {
                logger.error(`[Terminal ${terminalId}] Failed to open out-of-project file link ${text}`, error);
                return false;
            }
        }

        try {
            const appId = await invoke<string>(TauriCommands.GetDefaultOpenApp);
            await invoke(TauriCommands.OpenInApp, { 
                appId, 
                worktreeRoot: workingDirectory,
                worktreePath: workingDirectory, // backward compat
                targetPath: resolvedPath,
                line: parsed.startLine
            });
            return true;
        } catch (error) {
            logger.error(`[Terminal ${terminalId}] Failed to open file link ${text}`, error);
            return false;
        }
    }, [workingDirectory, terminalId]);

    useEffect(() => {
        const handler = workingDirectory ? openFileFromTerminal : null;
        fileLinkHandlerRef.current = handler;
        const instance = xtermWrapperRef.current;
        if (instance) {
            instance.setFileLinkHandler(handler);
        }
        return () => {
            if (fileLinkHandlerRef.current === handler) {
                fileLinkHandlerRef.current = null;
                instance?.setFileLinkHandler(null);
            }
        };
    }, [workingDirectory, openFileFromTerminal]);

    useEffect(() => {
        if (!autoPreviewConfig || !autoPreviewConfig.interceptClicks) {
            if (!previewLogStateRef.current.disabled) {
                logger.info(`[Terminal ${terminalId}] Localhost click intercept disabled or not configured`);
                previewLogStateRef.current.disabled = true;
            }
            previewWatcherRef.current = null;
            return;
        }

        if (!previewKey) {
            if (!previewLogStateRef.current.missing) {
                logger.info(`[Terminal ${terminalId}] Localhost click intercept skipped - missing preview key`);
                previewLogStateRef.current.missing = true;
            }
            previewWatcherRef.current = null;
            return;
        }

        previewLogStateRef.current.disabled = false;
        previewLogStateRef.current.missing = false;

        previewWatcherRef.current = new LocalPreviewWatcher({
            previewKey,
            interceptClicks: autoPreviewConfig.interceptClicks,
            onUrl: (url) => setPreviewUrl({ key: previewKey, url }),
            onOpenPreviewPanel: () => emitUiEvent(UiEvent.OpenPreviewPanel, { previewKey }),
            getCurrentUrl: () => getPreviewState(previewKey).url,
        });

        if (!previewLogStateRef.current.ready) {
            logger.info(`[Terminal ${terminalId}] Localhost click intercept ready`, { previewKey });
            previewLogStateRef.current.ready = true;
        }

        return () => {
            previewWatcherRef.current = null;
        };
    }, [autoPreviewConfig, previewKey, setPreviewUrl, getPreviewState, terminalId]);

    const handleLinkClickRef = useRef<((uri: string) => boolean) | null>(null);
    handleLinkClickRef.current = useCallback((uri: string) => {
        const watcher = previewWatcherRef.current;
        if (watcher) {
            const handled = watcher.handleClick(uri);
            if (handled) {
                logger.info(`[Terminal ${terminalId}] Detected localhost link`, { previewKey, url: uri });
                return true;
            }
        }
        return false;
    }, [previewKey, terminalId]);


    const terminal = useRef<XTerm | null>(null);
    const applyTerminalTheme = useCallback((resolved: ResolvedTheme) => {
        if (!terminal.current) return;
        terminal.current.options.theme = buildTerminalTheme(resolved);
        xtermWrapperRef.current?.refresh();
    }, []);
    const onDataDisposableRef = useRef<IDisposable | null>(null);
    const onScrollDisposableRef = useRef<IDisposable | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    const searchAddon = useRef<SearchAddon | null>(null);
    const lastSize = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
    const lastEffectiveRef = useRef<{ cols: number; rows: number }>(lastEffectiveRefInit);
    const resizeCoordinatorRef = useRef<TerminalResizeCoordinator | null>(null);
    const existingInstance = hasTerminalInstance(terminalId);
    const [hydrated, setHydrated] = useState(existingInstance);
    const hydratedRef = useRef<boolean>(existingInstance);
    const [agentLoading, setAgentLoading] = useState(false);
    const [agentStopped, setAgentStopped] = useState(false);
    const terminalEverStartedRef = useRef<boolean>(false);
    const [restartInFlight, setRestartInFlight] = useState(false);
    const hydratedOnceRef = useRef<boolean>(existingInstance);
    // Tracks user-initiated interrupt signal to distinguish from startup/other exits.
    const lastSigintAtRef = useRef<number | null>(null);
    const [isSearchVisible, setIsSearchVisible] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showScrollBottom, setShowScrollBottom] = useState(false);
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
    const terminalIdRef = useRef(terminalId);
    terminalIdRef.current = terminalId;
    const sessionScopeRef = useRef<string | null>(null);
    sessionScopeRef.current = isCommander ? 'orchestrator' : (sessionName ?? null);

    const mountedRef = useRef<boolean>(false);
    const startingTerminals = useRef<Map<string, boolean>>(new Map());
    const previousTerminalId = useRef<string>(terminalId);
    const rendererReadyRef = useRef<boolean>(false); // Renderer readiness flag
    const [fontsFullyLoaded, setFontsFullyLoaded] = useState(false);
    const fontsLoadedRef = useRef(false);
    const agentTypeRef = useRef(agentType);
    agentTypeRef.current = agentType;
    const isPhysicalWheelRef = useRef(true);
    const isTerminalOnlyAgent = agentType === 'terminal';
    const isAgentTopTerminal = useMemo(() => {
        if (isTerminalOnlyAgent) {
            return false;
        }
        if (!isTopTerminalId(terminalId)) {
            return false;
        }
        return terminalId.startsWith('session-') || terminalId.startsWith('orchestrator-');
    }, [terminalId, isTerminalOnlyAgent]);

    const shouldAcceptInputForAgentTab = useCallback((): boolean => {
        const id = terminalIdRef.current;
        if (!isTopTerminalId(id)) {
            return true;
        }
        if (!(id.startsWith('session-') || id.startsWith('orchestrator-'))) {
            return true;
        }

        const scope = sessionScopeRef.current;
        if (!scope) {
            return true;
        }

        const active = getActiveAgentTerminalId(scope);
        if (!active) {
            return true;
        }

        return active === id;
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        applyTerminalTheme(resolvedTheme);
    }, [resolvedTheme, applyTerminalTheme, hydrated]);

    useEffect(() => {
        const cleanup = listenUiEvent(UiEvent.ThemeChanged, detail => {
            applyTerminalTheme(detail.resolved);
        });
        return cleanup;
    }, [applyTerminalTheme]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return
        }

        const handleSelectAll = (event: KeyboardEvent) => {
            if (detectPlatformSafe() !== 'mac') return
            if (event.type !== 'keydown') return

            if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
            if (event.key !== 'a' && event.key !== 'A') return

            const target = event.target
            if (!(target instanceof Node)) return

            const container = termRef.current
            if (!container || !container.isConnected) return
            if (!container.contains(target)) return

            if (target instanceof HTMLInputElement) return
            if (target instanceof HTMLElement && target.isContentEditable) return
            if (target instanceof HTMLTextAreaElement) {
                const isXtermTextarea = target.classList.contains('xterm-helper-textarea') || Boolean(target.closest('.xterm'))
                if (!isXtermTextarea) {
                    return
                }
            }

            event.preventDefault()
            event.stopPropagation()
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation()
            }
            terminal.current?.selectAll()
        }

        window.addEventListener('keydown', handleSelectAll, true)
        return () => window.removeEventListener('keydown', handleSelectAll, true)
    }, []);

    const {
        config: terminalConfig,
        configRef: terminalConfigRef,
        resolvedFontFamily,
        customFontFamily,
        smoothScrollingEnabled,
        terminalFontSize,
        readOnlyRef,
    } = useTerminalConfig({
        readOnly,
    });
    // Drag-selection suppression for run terminals
    const suppressNextClickRef = useRef<boolean>(false);
    const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
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

    const applySizeUpdate = useCallback((cols: number, rows: number, reason: string, _force = false) => {
        if (!terminal.current) return false;
        const effectiveCols = calculateEffectiveColumns(cols);
        const effectiveRows = Math.max(Math.floor(rows), MIN_TERMINAL_ROWS);
        if (effectiveCols !== cols || effectiveRows !== rows) {
            logger.debug(`[Terminal ${terminalId}] Clamping ${reason} resize ${cols}x${rows} → ${effectiveCols}x${effectiveRows}`);
        }
        lastSize.current = { cols: effectiveCols, rows: effectiveRows };

        const term = terminal.current;
        try {
            logScrollSnapshot(`resize:${reason}:before`, { cols: effectiveCols, rows: effectiveRows });
            term.resize(effectiveCols, effectiveRows);
            if (xtermWrapperRef.current?.shouldFollowOutput()) {
                requestAnimationFrame(() => {
                    term.scrollToLine(term.buffer.active.baseY);
                    logScrollChange('applySizeUpdate');
                });
            }
            logScrollSnapshot(`resize:${reason}:after`, { cols: effectiveCols, rows: effectiveRows });
        } catch (e) {
            logger.debug(`[Terminal ${terminalId}] Failed to apply frontend resize to ${effectiveCols}x${effectiveRows}`, e);
        }

        recordTerminalSize(terminalId, effectiveCols, effectiveRows);
        schedulePtyResize(terminalId, { cols: effectiveCols, rows: effectiveRows });
        lastEffectiveRef.current = { cols: effectiveCols, rows: effectiveRows };
        rememberDimensions();
        return true;
    }, [terminalId, rememberDimensions, logScrollChange, logScrollSnapshot]);

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
            getCurrentCols: () => terminal.current?.cols ?? 80,
            getCurrentRows: () => terminal.current?.rows ?? 24,
            applyResize: (cols, rows, context) => {
                applySizeUpdate(cols, rows, context.reason, context.force);
            },
            applyRowsOnly: (rows, _context) => {
                if (!terminal.current) return;
                const currentCols = terminal.current.cols;
                const effectiveRows = Math.max(Math.floor(rows), MIN_TERMINAL_ROWS);
                const term = terminal.current;
                try {
                    term.resize(currentCols, effectiveRows);
                    if (xtermWrapperRef.current?.shouldFollowOutput()) {
                        requestAnimationFrame(() => {
                            term.scrollToLine(term.buffer.active.baseY);
                            logScrollChange('applyRowsOnly');
                        });
                    }
                } catch (e) {
                    logger.debug(`[Terminal ${terminalId}] Failed to apply rows-only resize to ${currentCols}x${effectiveRows}`, e);
                }
                lastSize.current = { cols: currentCols, rows: effectiveRows };
                recordTerminalSize(terminalId, currentCols, effectiveRows);
                schedulePtyResize(terminalId, { cols: currentCols, rows: effectiveRows });
                lastEffectiveRef.current = { cols: currentCols, rows: effectiveRows };
            },
            applyColsOnly: (cols, _context) => {
                if (!terminal.current) return;
                const currentRows = terminal.current.rows;
                const effectiveCols = calculateEffectiveColumns(cols);
                const term = terminal.current;
                try {
                    term.resize(effectiveCols, currentRows);
                    if (xtermWrapperRef.current?.shouldFollowOutput()) {
                        requestAnimationFrame(() => {
                            term.scrollToLine(term.buffer.active.baseY);
                            logScrollChange('applyColsOnly');
                        });
                    }
                } catch (e) {
                    logger.debug(`[Terminal ${terminalId}] Failed to apply cols-only resize to ${effectiveCols}x${currentRows}`, e);
                }
                lastSize.current = { cols: effectiveCols, rows: currentRows };
                recordTerminalSize(terminalId, effectiveCols, currentRows);
                schedulePtyResize(terminalId, { cols: effectiveCols, rows: currentRows });
                lastEffectiveRef.current = { cols: effectiveCols, rows: currentRows };
            },
        });
        resizeCoordinatorRef.current = coordinator;
        return () => {
            coordinator.dispose();
            resizeCoordinatorRef.current = null;
        };
    }, [applySizeUpdate, terminalId]);

    const {
        gpuRenderer,
        gpuEnabledForTerminal,
        refreshGpuFontRendering,
        applyLetterSpacing,
        cancelGpuRefreshWork,
        ensureRenderer,
        handleFontPreferenceChange,
        webglRendererActive,
    } = useTerminalGpu({
        terminalId,
        terminalRef: terminal,
        fitAddonRef: fitAddon,
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

    const refreshGpuFontRenderingRef = useRef(refreshGpuFontRendering);
    useEffect(() => {
        refreshGpuFontRenderingRef.current = refreshGpuFontRendering;
    }, [refreshGpuFontRendering]);

    const applyLetterSpacingRef = useRef(applyLetterSpacing);
    useEffect(() => {
        applyLetterSpacingRef.current = applyLetterSpacing;
    }, [applyLetterSpacing]);

    const handleFontPreferenceChangeRef = useRef(handleFontPreferenceChange);
    useEffect(() => {
        handleFontPreferenceChangeRef.current = handleFontPreferenceChange;
    }, [handleFontPreferenceChange]);

    const webglRendererActiveRef = useRef(webglRendererActive);
    webglRendererActiveRef.current = webglRendererActive;

    const onReadyRef = useRef(onReady);
    useEffect(() => {
        onReadyRef.current = onReady;
    }, [onReady]);

    const inputFilterRef = useRef(inputFilter);
    useEffect(() => {
        inputFilterRef.current = inputFilter;
    }, [inputFilter]);

    const beginClaudeShiftEnterRef = useRef(beginClaudeShiftEnter);
    useEffect(() => {
        beginClaudeShiftEnterRef.current = beginClaudeShiftEnter;
    }, [beginClaudeShiftEnter]);

    const finalizeClaudeShiftEnterRef = useRef(finalizeClaudeShiftEnter);
    useEffect(() => {
        finalizeClaudeShiftEnterRef.current = finalizeClaudeShiftEnter;
    }, [finalizeClaudeShiftEnter]);

    const requestResize = useCallback((reason: string, options?: { immediate?: boolean; force?: boolean }) => {
        if (!fitAddon.current || !terminal.current) {
            return;
        }

        const measured = readDimensions();
        if (!measured) {
            return;
        }

        const wasSuspended = layoutSuspendedRef.current;
        if (isMeasurementTooSmall(measured.width, measured.height)) {
            lastMeasuredDimensionsRef.current = measured;
            layoutSuspendedRef.current = true;
            if (!wasSuspended) {
                logger.debug(`[Terminal ${terminalId}] Suspending resize - container too small (${measured.width}x${measured.height})`);
            }
            return;
        }

        if (wasSuspended) {
            layoutSuspendedRef.current = false;
            logger.debug(`[Terminal ${terminalId}] Resuming resize - container measurable (${measured.width}x${measured.height})`);
        }

        const shouldForce = Boolean(options?.force) || wasSuspended;
        const shouldImmediate = Boolean(options?.immediate) || wasSuspended;

        if (!shouldForce) {
            const prev = lastMeasuredDimensionsRef.current;
            const deltaWidth = Math.abs(measured.width - prev.width);
            const deltaHeight = Math.abs(measured.height - prev.height);
            if (!shouldImmediate && deltaWidth < RESIZE_PIXEL_EPSILON && deltaHeight < RESIZE_PIXEL_EPSILON) {
                return;
            }
        }
        lastMeasuredDimensionsRef.current = measured;

        const proposer = fitAddon.current as unknown as { proposeDimensions?: () => { cols: number; rows: number } | undefined };
        const proposed = proposer.proposeDimensions?.();
        if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows) || proposed.cols <= 0 || proposed.rows <= 0) {
            layoutSuspendedRef.current = true;
            logger.debug(`[Terminal ${terminalId}] Suspending resize - invalid size proposal`, { proposed, reason });
            return;
        }

        const desiredRows = Math.max(MIN_TERMINAL_ROWS, Math.floor(proposed.rows));
        const desiredCols = proposed.cols < MIN_PROPOSED_COLUMNS
            ? MIN_TERMINAL_COLUMNS
            : calculateEffectiveColumns(proposed.cols);

        if (terminal.current.cols === desiredCols && terminal.current.rows === desiredRows) {
            // Avoid no-op resizes. xterm.js can still perturb viewport scroll position when `resize()` is
            // called with the current dimensions, which shows up as "scroll creeps up" when switching
            // between terminals while scrolled away from bottom.
            if (shouldForce) {
                try {
                    xtermWrapperRef.current?.forceScrollbarRefresh();
                    xtermWrapperRef.current?.refresh();
                } catch (error) {
                    logger.debug(`[Terminal ${terminalId}] No-op resize refresh failed`, error);
                }
            }
            return;
        }

        resizeCoordinatorRef.current?.resize({
            cols: desiredCols,
            rows: desiredRows,
            reason: proposed.cols < MIN_PROPOSED_COLUMNS ? `${reason}:min-clamp-proposal` : reason,
            immediate: proposed.cols < MIN_PROPOSED_COLUMNS ? true : shouldImmediate,
        });
    }, [readDimensions, terminalId]);

    const requestResizeRef = useRef(requestResize);
    useEffect(() => {
        requestResizeRef.current = requestResize;
    }, [requestResize]);

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

    const scrollLines = useCallback((amount: number) => {
        terminal.current?.scrollLines(amount);
    }, []);

    const scrollPages = useCallback((amount: number) => {
        terminal.current?.scrollPages(amount);
    }, []);

    const scrollToTopInstant = useCallback(() => {
        terminal.current?.scrollToTop();
    }, []);

    const restartAgent = useCallback(async () => {
        if (!isAgentTopTerminal) return;
        setRestartInFlight(true);
        setAgentLoading(true);
        sessionStorage.removeItem(`schaltwerk:agent-stopped:${terminalId}`);
        clearTerminalStartedTracking([terminalId]);

             try {
                 // Provide initial size to avoid early overflow (apply guard)
                 let measured: { cols?: number; rows?: number } | undefined;
                 try {
                     if (fitAddon.current && terminal.current) {
                         const proposer = fitAddon.current as unknown as { proposeDimensions?: () => { cols: number; rows: number } | undefined };
                         const proposed = proposer.proposeDimensions?.();
                         if (proposed) {
                             const mCols = calculateEffectiveColumns(proposed.cols);
                             measured = { cols: mCols, rows: proposed.rows };
                         }
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
             setRestartInFlight(false);
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
        scrollToBottom: scrollToBottomInstant,
        scrollLineUp: () => scrollLines(-1),
        scrollLineDown: () => scrollLines(1),
        scrollPageUp: () => scrollPages(-1),
        scrollPageDown: () => scrollPages(1),
        scrollToTop: scrollToTopInstant,
    }), [isAnyModalOpen, isSearchVisible, focusSearchInput, scrollToBottomInstant, scrollLines, scrollPages, scrollToTopInstant]);

    useEffect(() => {
        hydratedRef.current = hydrated;
    }, [hydrated]);


    useEffect(() => {
        const node = termRef.current;
        if (!node) {
            return undefined;
        }

        const handleWheel = (event: WheelEvent) => {
            const next = classifyWheelEvent(event, isPhysicalWheelRef.current);
            if (next === isPhysicalWheelRef.current) {
                return;
            }
            isPhysicalWheelRef.current = next;
            if (xtermWrapperRef.current) {
                xtermWrapperRef.current.setSmoothScrolling(smoothScrollingEnabled && next);
            }
        };
        
        // Use capture phase for wheel events to intercept them before xterm consumes them
        // This is crucial for custom scrolling behavior or monitoring
        node.addEventListener('wheel', handleWheel, { passive: true, capture: true });
        return () => {
            node.removeEventListener('wheel', handleWheel, { capture: true });
        };
    }, [smoothScrollingEnabled]);

    useEffect(() => {
        if (!xtermWrapperRef.current) {
            return;
        }
        xtermWrapperRef.current.setSmoothScrolling(smoothScrollingEnabled && isPhysicalWheelRef.current);
    }, [smoothScrollingEnabled]);


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

    // Listen for unified agent-start events to prevent double-starting
    useEffect(() => {
        let unlistenAgentStarted: UnlistenFn | null = null;
        // Dedup duplicate start events that arrive back-to-back, but still allow later restarts
        // Map stores last-handled timestamp per terminal id; entries naturally expire by time window
        const handledStarts = new Map<string, number>();
        const DEDUP_WINDOW_MS = 1_000;

        const setupListener = async () => {
            try {
                unlistenAgentStarted = await listenEvent(SchaltEvent.TerminalAgentStarted, (payload) => {
                    const id = payload?.terminal_id;
                    if (!id) return;
                    const now = Date.now();
                    const lastHandled = handledStarts.get(id);
                    if (lastHandled && now - lastHandled < DEDUP_WINDOW_MS) {
                        return;
                    }
                    handledStarts.set(id, now);

                    logger.debug(`[Terminal] Received terminal-agent-started event for ${id}`);

                    markTerminalStarted(id);

                    if (id === terminalId) {
                        sessionStorage.removeItem(`schaltwerk:agent-stopped:${terminalId}`);
                        setAgentStopped(false);
                        terminalEverStartedRef.current = true;
                        setRestartInFlight(false);
                    }
                });
            } catch (e) {
                logger.error('[Terminal] Failed to set up terminal-agent-started listener:', e);
            }
        };

        void setupListener();

        return () => {
            handledStarts.clear();
            if (unlistenAgentStarted) {
                try {
                    unlistenAgentStarted();
                } catch (error) {
                    logger.warn(`[Terminal ${terminalId}] Failed to remove terminal-agent-started listener`, error);
                }
            }
        };
    }, [terminalId]);

      // Listen for TerminalClosed events to detect when agent terminals are killed
      useEffect(() => {
          if (!isAgentTopTerminal) return;
          let unlisten: UnlistenFn | null = null;
        void (async () => {
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
          return () => {
            try {
              unlisten?.();
            } catch (e) {
              logger.debug(`[Terminal ${terminalId}] Failed to cleanup TerminalClosed listener:`, e);
            }
          };
      }, [isAgentTopTerminal, terminalId]);

    // Workaround: force-fit and send PTY resize when session search runs for OpenCode
    useEffect(() => {
        const handleSearchResize = (detail?: { kind?: 'session' | 'orchestrator'; sessionId?: string }) => {
            if (agentType !== 'opencode') return;
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
        let unsubscribe: (() => void) | null = null
        let cancelled = false
        void (async () => {
            try {
                const cleanup = await listenUiEvent(UiEvent.OpencodeSearchResize, handleSearchResize)
                if (cancelled) {
                    cleanup()
                    return
                }
                unsubscribe = cleanup
            } catch (error) {
                logger.warn(`[Terminal ${terminalId}] Failed to register OpenCode search resize listener`, error)
            }
        })()
        return () => {
            cancelled = true
            try {
                unsubscribe?.()
            } catch (error) {
                logger.warn(`[Terminal ${terminalId}] Failed to remove OpenCode search resize listener`, error)
            }
        }
        // Deliberately depend on agentType to keep logic accurate per mount
    }, [agentType, terminalId, sessionName, isCommander, requestResize]);

    // Listen for session-switching animation completion for OpenCode
    useEffect(() => {
        const handleSessionSwitchAnimationEnd = () => {
            if (agentType !== 'opencode') return;

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
    }, [agentType, terminalId, requestResize]);

    // Deterministic refit on session switch specifically for OpenCode
    useEffect(() => {
        const handleSelectionResize = (detail?: { kind?: 'session' | 'orchestrator'; sessionId?: string }) => {
            if (agentType !== 'opencode') return;
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
        let unsubscribe: (() => void) | null = null
        let cancelled = false
        void (async () => {
            try {
                const cleanup = await listenUiEvent(UiEvent.OpencodeSelectionResize, handleSelectionResize)
                if (cancelled) {
                    cleanup()
                    return
                }
                unsubscribe = cleanup
            } catch (error) {
                logger.warn(`[Terminal ${terminalId}] Failed to register OpenCode selection resize listener`, error)
            }
        })()
        return () => {
            cancelled = true
            try {
                unsubscribe?.()
            } catch (error) {
                logger.warn(`[Terminal ${terminalId}] Failed to remove OpenCode selection resize listener`, error)
            }
        }
    }, [agentType, terminalId, sessionName, isCommander, requestResize]);

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

    // Sync UI mode when agent type changes (e.g., late hydration or session switch)
    useEffect(() => {
        const instance = xtermWrapperRef.current;
        if (instance && agentType) {
            const mode = isTuiAgent(agentType) ? 'tui' : 'standard';
            const currentMode = instance.isTuiMode() ? 'tui' : 'standard';
            if (currentMode !== mode) {
                logger.info(`[Terminal ${terminalId}] Syncing UI mode: ${currentMode} → ${mode} (agentType=${agentType})`);
                instance.setUiMode(mode);
            }
        }
    }, [agentType, terminalId]);

    useEffect(() => {
        debugCountersRef.current.initRuns += 1;
        if (termDebug()) {
            logger.debug(`[Terminal ${terminalId}] [init] effect run #${debugCountersRef.current.initRuns}`);
        }
        mountedRef.current = true;
        let cancelled = false;
        // track mounted lifecycle only; no timer-based logic tied to mount time
        if (!termRef.current) {
            logger.error(`[Terminal ${terminalId}] No ref available!`);
            return;
        }

        const currentConfig = terminalConfigRef.current;
        const initialTheme = buildTerminalTheme(resolvedThemeRef.current);

        const initialUiMode = isTuiAgent(agentTypeRef.current) ? 'tui' : 'standard';
        logger.debug(`[Terminal ${terminalId}] Creating terminal: agentTypeRef.current=${agentTypeRef.current}, initialUiMode=${initialUiMode}`);
        const { record, isNew } = acquireTerminalInstance(terminalId, () => new XtermTerminal({
            terminalId,
            config: currentConfig,
            uiMode: initialUiMode,
            onLinkClick: (uri: string) => handleLinkClickRef.current?.(uri) ?? false,
            theme: initialTheme,
        }));

        // Always start with hydrated=false and let onRender set it to true
        // This prevents the flash where CSS shows opacity-100 before xterm renders
        setHydrated(false);
        hydratedRef.current = false;
        if (isNew) {
            hydratedOnceRef.current = false;
        }
        const instance = record.xterm;
        if (!isNew) {
            instance.applyConfig(currentConfig);
        }
        instance.setUiMode(isTuiAgent(agentTypeRef.current) ? 'tui' : 'standard');
        instance.setLinkHandler((uri: string) => handleLinkClickRef.current?.(uri) ?? false);
        instance.setSmoothScrolling(currentConfig.smoothScrolling && isPhysicalWheelRef.current);
        xtermWrapperRef.current = instance;

        if (fileLinkHandlerRef.current) {
            instance.setFileLinkHandler(fileLinkHandlerRef.current);
        }
        terminal.current = instance.raw;
        terminal.current.options.theme = initialTheme;
        xtermWrapperRef.current?.refresh();
        fitAddon.current = instance.fitAddon;
        searchAddon.current = instance.searchAddon;
        
        if (termRef.current) {
            attachTerminalInstance(terminalId, termRef.current);
        }
        logScrollSnapshot('attached');
        applyLetterSpacingRef.current?.(webglRendererActiveRef.current);
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
                requestResizeRef.current?.('initial-fit', { immediate: true, force: true });
                const { cols, rows } = terminal.current;
                logger.info(`[Terminal ${terminalId}] Initial fit: ${cols}x${rows} (container: ${containerWidth}x${containerHeight})`);
            } catch (e) {
                logger.warn(`[Terminal ${terminalId}] Initial fit failed:`, e);
            }
        };

        performInitialFit();

        let rendererInitialized = false;
        const initializeRenderer = async () => {
            if (rendererInitialized || cancelled || !terminal.current || !termRef.current) {
                return;
            }

            if (termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
                rendererInitialized = true;
                try {
                    if (terminal.current) {
                        try {
                            requestResizeRef.current?.('renderer-init', { immediate: true, force: true });
                        } catch (e) {
                            logger.warn(`[Terminal ${terminalId}] Early initial resize failed:`, e);
                        }
                    }

                    if (gpuEnabledForTerminal) {
                        await ensureRendererRef.current?.();
                    }

                    rendererReadyRef.current = true;

                    requestAnimationFrame(() => {
                        if (terminal.current) {
                            try {
                                requestResizeRef.current?.('post-init', { immediate: true, force: true });
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
        
        // Use ResizeObserver to deterministically initialize renderer when container is ready
        // This avoids polling and ensures we initialize exactly once when dimensions are available
        const rendererObserver = new ResizeObserver((entries?: ResizeObserverEntry[]) => {
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
                        void initializeRenderer();
                    });
                }
            } catch (e) {
                logger.debug('ResizeObserver error during terminal initialization', e)
                // Fallback: try immediate initialization based on current element size
                if (termRef.current && termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
                    rendererObserver?.disconnect();
                    requestAnimationFrame(() => {
                        void initializeRenderer();
                    });
                }
            }
        });

        // Start observing the terminal container
        rendererObserver.observe(termRef.current);

        // Use IntersectionObserver to catch hidden->visible transitions (e.g., collapsed panels)
        // and trigger a definitive fit+resize when the terminal becomes visible.
        // NOTE: IntersectionObserver now ONLY handles layout concerns (fit, scrollbar refresh).
        // Scroll positioning is handled by explicit lifecycle atoms to avoid race conditions.
        let visibilityObserver: IntersectionObserver | null = null;
        if (typeof IntersectionObserver !== 'undefined' && termRef.current) {
            visibilityObserver = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (!entry || !entry.isIntersecting) return;
                if (!fitAddon.current || !terminal.current || !termRef.current) return;
                const el = termRef.current;
                if (!el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;
                resizeCoordinatorRef.current?.flush('visibility');

                try {
                    requestResizeRef.current?.('visibility', { immediate: true, force: true });
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
                void initializeRenderer();
            }
        });

        // Intercept global shortcuts before xterm.js processes them
        terminal.current.attachCustomKeyEventHandler((event: KeyboardEvent) => {
            // When multiple agent tabs exist, ensure only the active tab's terminal handles stdin
            // and global shortcuts. This prevents keystrokes (including Escape) from being sent to
            // multiple agent PTYs.
            if (!shouldAcceptInputForAgentTab()) {
                return true
            }

            if (!readOnlyRef.current && shouldEmitControlPaste(event)) {
                event.preventDefault()
                writeTerminalBackend(terminalId, '\x16').catch(err => logger.debug('[Terminal] ctrl+v ignored (backend not ready yet)', err))
                return false
            }

            if (!readOnlyRef.current && shouldEmitControlNewline(event)) {
                event.preventDefault()
                writeTerminalBackend(terminalId, '\n').catch(err => logger.debug('[Terminal] ctrl+j ignored (backend not ready yet)', err))
                return false
            }

            const isMac = navigator.userAgent.includes('Mac')
            const modifierKey = isMac ? event.metaKey : event.ctrlKey

            if (
                isMac &&
                event.type === 'keydown' &&
                event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.shiftKey &&
                (event.key === 'a' || event.key === 'A')
            ) {
                event.preventDefault()
                terminal.current?.selectAll()
                return false
            }
            const shouldHandleClaudeShiftEnter = (
                agentTypeRef.current === 'claude' &&
                isAgentTopTerminal &&
                event.key === 'Enter' &&
                event.type === 'keydown' &&
                event.shiftKey &&
                !modifierKey &&
                !event.altKey &&
                !readOnlyRef.current
            )

            if (shouldHandleClaudeShiftEnter) {
                beginClaudeShiftEnterRef.current?.();
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
                if (!isReadyForFit() || !terminal.current) return;
                try {
                    requestResizeRef.current?.('initial-raf', { immediate: true, force: true });
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
                        setHydrated(true);
                        if (!hydratedOnceRef.current) {
                            hydratedOnceRef.current = true;
                            try {
                                emitUiEvent(UiEvent.TerminalReady, { terminalId });
                            } catch (error) {
                                logger.debug(`[Terminal ${terminalId}] Failed to emit terminal-ready event`, error);
                            }
                            onReadyRef.current?.();
                        }
                        logScrollSnapshot('onRender:hydrated');
                    }
                });
                if (disposable && typeof disposable === 'object' && typeof (disposable as { dispose?: () => void }).dispose === 'function') {
                    outputDisposables.push(disposable as IDisposable);
                }
            }
        }

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
                applyLetterSpacingRef.current?.(webglRendererActiveRef.current);
                refreshGpuFontRenderingRef.current?.();
                if (gpuEnabledForTerminal) {
                    void handleFontPreferenceChangeRef.current?.();
                }
            } else {
                applyLetterSpacingRef.current?.(false);
            }

            if (fontSizeRafPending) return;
            fontSizeRafPending = true;
            requestAnimationFrame(() => {
                fontSizeRafPending = false;
                if (!terminal.current || !mountedRef.current) return;

                try {
                    requestResizeRef.current?.('font-size-change', { immediate: true, force: true });
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Font size change fit failed:`, e);
                }
            });
        };

        addEventListener(window, 'font-size-changed', handleFontSizeChange);

        const handlePaste = (e: Event) => {
            if (readOnlyRef.current) return
            const id = terminalIdRef.current
            if (!isTerminalBracketedPasteEnabled(id)) return

            const event = e as ClipboardEvent
            const target = event.target
            if (!(target instanceof Node) || !termRef.current?.contains(target)) {
                return
            }

            const text = event.clipboardData?.getData('text/plain')
            if (!text) return

            // Some TUIs enable "bracketed paste mode" (ESC[?2004h) and expect the terminal emulator to
            // wrap the entire paste in ESC[200~ … ESC[201~. Without these markers, multi-line pastes can
            // be misinterpreted as many individual Enter key presses.
            event.preventDefault()
            event.stopPropagation()
            event.stopImmediatePropagation()

            void (async () => {
                const chunks = buildBracketedPasteChunks(text, 60_000)
                for (const chunk of chunks) {
                    await writeTerminalBackend(id, chunk)
                }
            })().catch(error => {
                logger.debug(`[Terminal ${id}] Failed to paste bracketed payload`, error)
            })
        }

        // Capture-phase ensures we intercept before xterm/browser default handling so we can emit a
        // single bracketed paste payload to the PTY.
        addEventListener(containerRef.current, 'paste', handlePaste as EventListener, { capture: true })

        // Send input to backend.
        //
        // Important: even when `readOnly` is true (e.g., background terminals in tab sets), we still
        // register the `onData` handler so the terminal can become writable later without a full
        // remount. Input is gated by `readOnlyRef.current` at call time.
        if (onDataDisposableRef.current) {
            try {
                onDataDisposableRef.current.dispose();
            } catch (error) {
                logger.debug(`[Terminal ${terminalId}] Failed to dispose previous onData listener`, error);
            }
            onDataDisposableRef.current = null;
        }

        onDataDisposableRef.current = terminal.current.onData((data) => {
            if (readOnlyRef.current) {
                return;
            }

            if (!shouldAcceptInputForAgentTab()) {
                return;
            }

            if (finalizeClaudeShiftEnterRef.current?.(data)) {
                return;
            }

            const filter = inputFilterRef.current;
            if (filter && !filter(data)) {
                if (termDebug()) {
                    logger.debug(`[Terminal ${terminalId}] blocked input: ${JSON.stringify(data)}`);
                }
                return;
            }

            if (isAgentTopTerminal && data === '\u0003') {
                lastSigintAtRef.current = Date.now();
                const platform = detectPlatformSafe()
                const keyCombo = platform === 'mac' ? 'Cmd+C' : 'Ctrl+C'
                logger.debug(`[Terminal ${terminalId}] Interrupt signal detected (${keyCombo})`);
            }

            writeTerminalBackend(terminalId, data).catch(err => logger.debug('[Terminal] write ignored (backend not ready yet)', err));
        });

        if (onScrollDisposableRef.current) {
            try {
                onScrollDisposableRef.current.dispose();
            } catch (error) {
                logger.debug(`[Terminal ${terminalId}] Failed to dispose previous onScroll listener`, error);
            }
            onScrollDisposableRef.current = null;
        }
        onScrollDisposableRef.current = terminal.current.onScroll(() => {
            logScrollChange('onScroll');
        });

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
                requestResizeRef.current?.('resize-observer', { force: dragging });
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
        void (async () => {
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
                        if (!terminal.current) return;

                        resizeCoordinatorRef.current?.flush('split-final');
                        requestResizeRef.current?.('split-final', { immediate: true, force: true });
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
            logScrollSnapshot('cleanup:before-detach');

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

            if (onScrollDisposableRef.current) {
                try {
                    onScrollDisposableRef.current.dispose();
                } catch (error) {
                    logger.debug(`[Terminal ${terminalId}] onScroll listener cleanup error:`, error);
                }
                onScrollDisposableRef.current = null;
            }

            detachTerminalInstance(terminalId);
            logScrollSnapshot('cleanup:after-detach');
            xtermWrapperRef.current = null;
            gpuRenderer.current = null;
            terminal.current = null;
            hydratedRef.current = false;
            hydratedOnceRef.current = false;
            // Note: We intentionally don't close terminals here to allow switching between sessions
            // All terminals are cleaned up when the app exits via the backend cleanup handler
            // useCleanupRegistry handles other cleanup automatically
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; isAgentTopTerminal is read at call-time and shouldn't trigger re-init
    }, [
        terminalId,
        addEventListener,
        addResizeObserver,
    ]);


    const configEffectInitializedRef = useRef(false);
    useEffect(() => {
        if (!xtermWrapperRef.current) {
            return;
        }
        if (!configEffectInitializedRef.current) {
            configEffectInitializedRef.current = true;
            return;
        }
        xtermWrapperRef.current.applyConfig(terminalConfig);
        xtermWrapperRef.current.setSmoothScrolling(terminalConfig.smoothScrolling && isPhysicalWheelRef.current);
    }, [terminalConfig, terminalId]);

    useEffect(() => {
        if (!terminal.current) return;
        if (agentType === 'terminal') return;
        if (!terminalId.endsWith('-top')) return;
        if (isTerminalStartingOrStarted(terminalId)) return;
        if (agentStopped) return;

        const isOrchestratorTop = isCommander || (terminalId.includes('orchestrator') && terminalId.endsWith('-top'));
        if (!isOrchestratorTop) return;

        const start = async () => {
            if (startingTerminals.current.get(terminalId)) {
                return;
            }
            startingTerminals.current.set(terminalId, true);
            setAgentLoading(true);
            try {
                let measured: { cols?: number; rows?: number } | undefined;
                try {
                    if (fitAddon.current && terminal.current) {
                        const proposer = fitAddon.current as unknown as { proposeDimensions?: () => { cols: number; rows: number } | undefined };
                        const proposed = proposer.proposeDimensions?.();
                        if (proposed) {
                            const mCols = calculateEffectiveColumns(proposed.cols);
                            measured = { cols: mCols, rows: proposed.rows };
                        }
                    }
                } catch (e) {
                    logger.warn(`[Terminal ${terminalId}] Failed to measure size before orchestrator start:`, e);
                }
                logger.info(`[Terminal ${terminalId}] Auto-starting Claude orchestrator at ${new Date().toISOString()}`);
                await startOrchestratorTop({ terminalId, measured });
                terminalEverStartedRef.current = true;
                safeTerminalFocusImmediate(() => {
                    terminal.current?.focus();
                }, isAnyModalOpen);
                setAgentLoading(false);
            } catch (e) {
                clearTerminalStartState([terminalId]);
                logger.error(`[Terminal ${terminalId}] Failed to start Claude:`, e);

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
                    terminalEverStartedRef.current = true;
                    setAgentStopped(true);
                    sessionStorage.setItem(`schaltwerk:agent-stopped:${terminalId}`, 'true');
                    clearTerminalStartedTracking([terminalId]);
                } else if (errorMessage.includes('not a git repository')) {
                    logger.error(`[Terminal ${terminalId}] Not a git repository:`, errorMessage);
                    emitUiEvent(UiEvent.NotGitError, { error: errorMessage, terminalId });
                }
                setAgentLoading(false);
                startingTerminals.current.set(terminalId, false);
            }
        };

        let cancelled = false;
        requestAnimationFrame(() => {
            if (!cancelled) {
                void start();
            }
        });
        return () => {
            cancelled = true;
        };
    }, [agentType, hydrated, terminalId, isCommander, isAnyModalOpen, agentStopped]);

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
                requestResize('font-family', { immediate: true, force: true })
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
            applyLetterSpacing(webglRendererActive);
            if (fontsLoadedRef.current) {
                refreshGpuFontRendering();
                if (gpuEnabledForTerminal) {
                    void handleFontPreferenceChange();
                }
                requestResize('fonts-ready', { immediate: true, force: true });
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
        webglRendererActive,
        requestResize,
    ])

    useLayoutEffect(() => {
        if (previousTerminalId.current === terminalId) {
            return;
        }

        const hasInstance = hasTerminalInstance(terminalId);
        previousTerminalId.current = terminalId;
        hydratedOnceRef.current = hasInstance;
        hydratedRef.current = hasInstance;
        setHydrated(hasInstance);
    }, [terminalId]);

    useEffect(() => {
        if (!hydrated || !terminal.current) {
            setShowScrollBottom(false);
            return;
        }

        const term = terminal.current;
        let rafId: number | null = null;

        const checkState = () => {
             if (!term.buffer?.active) return;
             const buffer = term.buffer.active;
             if (buffer.type === 'alternate') {
                 setShowScrollBottom(false);
                 return;
             }
             const distance = buffer.baseY - buffer.viewportY;
             const shouldShow = distance > 0;
             setShowScrollBottom(prev => {
                 if (prev !== shouldShow) return shouldShow;
                 return prev;
             });
        };

        const scheduleUpdate = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                checkState();
                rafId = null;
            });
        };

        // Check immediately
        checkState();

        const scrollDisposable = term.onScroll(scheduleUpdate);
        // onRender covers output, resize, and other visual updates
        // It fires after the frame is drawn, so metrics are fresh
        const renderDisposable = (term as unknown as { onRender: (cb: () => void) => IDisposable }).onRender(scheduleUpdate);

        return () => {
            scrollDisposable.dispose();
            renderDisposable?.dispose();
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [hydrated, terminalId]);


    const handleTerminalClick = (event?: React.MouseEvent<HTMLDivElement>) => {
        if (isSearchVisible) {
            const target = event?.target as Node | null;
            if (target instanceof Element && target.closest('[data-terminal-search="true"]')) {
                return;
            }
        }
        if (isUserSelectingInTerminal() || suppressNextClickRef.current) {
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
    };
    const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!mouseDownPosRef.current) return;
        const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
        const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);
        if (dx + dy > 3) {
            suppressNextClickRef.current = true;
        }
    };
    const onMouseUp = () => {
        mouseDownPosRef.current = null;
    };

    const showLoadingOverlay =
        !hydrated
        || (!terminalEverStartedRef.current && agentLoading)
        || (restartInFlight && agentLoading);

    const isTerminalDrag = useCallback((event: React.DragEvent) => {
        const types = Array.from(event.dataTransfer?.types ?? []);
        return types.includes(TERMINAL_FILE_DRAG_TYPE);
    }, []);

    const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!isTerminalDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    }, [isTerminalDrag]);

    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!isTerminalDrag(event) || readOnly) return;
        event.preventDefault();
        event.stopPropagation();

        const transfer = event.dataTransfer;
        if (!transfer) return;

        void (async () => {
            try {
                const raw = transfer.getData(TERMINAL_FILE_DRAG_TYPE);
                const parsed: TerminalFileDragPayload | null = raw ? JSON.parse(raw) : null;
                const filePath = parsed?.filePath?.trim();
                if (!filePath) return;

                const text = filePath.startsWith('./') ? filePath : `./${filePath}`;
                await writeTerminalBackend(terminalId, `${text} `);
                safeTerminalFocus(() => {
                    terminal.current?.focus?.();
                }, isAnyModalOpen);
            } catch (error) {
                logger.debug(`[Terminal ${terminalId}] Failed to handle file drop`, error);
            }
        })();
    }, [isTerminalDrag, readOnly, terminalId, isAnyModalOpen]);

    return (
        <div
            ref={containerRef}
            className={`h-full w-full relative overflow-hidden ${className}`}
            onClick={handleTerminalClick}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            data-smartdash-exempt="true"
        >
             <div
                 ref={termRef}
                 data-terminal-id={terminalId}
                 className={`h-full w-full overflow-hidden transition-opacity duration-150 ${!hydrated ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
             />
             <TerminalScrollButton
                 visible={showScrollBottom}
                 onClick={(e) => {
                     e.stopPropagation();
                     scrollToBottomInstant();
                 }}
             />
             {isAgentTopTerminal && agentStopped && hydrated && terminalEverStartedRef.current && (
                 <div className="absolute inset-0 flex items-center justify-center z-30">
                     <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700 rounded px-3 py-2 shadow-lg">
                         <span className="text-sm text-slate-300">Agent stopped</span>
                          <button
                              onClick={(e) => { e.stopPropagation(); void restartAgent(); }}
                              className="text-sm px-3 py-1 rounded text-white font-medium"
                              style={{
                                  backgroundColor: 'var(--color-accent-blue-dark)',
                              }}
                              onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = 'var(--color-accent-blue)';
                              }}
                              onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = 'var(--color-accent-blue-dark)';
                              }}
                          >
                             Restart
                         </button>
                     </div>
                 </div>
             )}
             <TerminalLoadingOverlay visible={showLoadingOverlay} />
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
