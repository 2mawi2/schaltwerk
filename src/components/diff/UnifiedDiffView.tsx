import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { TauriCommands } from "../../common/tauriCommands";
import { invoke } from "@tauri-apps/api/core";
import { useSelection } from "../../hooks/useSelection";
import { useReview } from "../../contexts/ReviewContext";
import { useFocus } from "../../contexts/FocusContext";
import {
  useLineSelection,
  type LineSelection,
} from "../../hooks/useLineSelection";
import { useDiffHover } from "../../hooks/useDiffHover";
import {
  loadFileDiff,
  loadCommitFileDiff,
  normalizeCommitChangeType,
  type FileDiffData,
} from "./loadDiffs";
import { getFileLanguage } from "../../utils/diff";
import { useReviewComments } from "../../hooks/useReviewComments";
import { DiffFileExplorer, ChangedFile } from "./DiffFileExplorer";
import { DiffViewer } from "./DiffViewer";
import {
  VscSend,
  VscListFlat,
  VscListSelection,
} from "react-icons/vsc";
import { SearchBox } from "../common/SearchBox";
import "../../styles/vscode-dark-theme.css";
import { logger } from "../../utils/logger";
import { useSessions } from "../../hooks/useSessions";
import { mapSessionUiState } from "../../utils/sessionFilters";
import { DiffSessionActions } from "./DiffSessionActions";
import { useKeyboardShortcutsConfig } from "../../contexts/KeyboardShortcutsContext";
import {
  KeyboardShortcutAction,
  KeyboardShortcutConfig,
} from "../../keyboardShortcuts/config";
import {
  detectPlatformSafe,
  isShortcutForAction,
} from "../../keyboardShortcuts/helpers";
import type { Platform } from "../../keyboardShortcuts/matcher";
import { useHighlightWorker } from "../../hooks/useHighlightWorker";
import { hashSegments } from "../../utils/hashSegments";
import { stableSessionTerminalId } from "../../common/terminalIdentity";
import { ReviewCommentThread, ReviewComment } from "../../types/review";
import { listenEvent, SchaltEvent } from "../../common/eventSystem";
import { ORCHESTRATOR_SESSION_NAME } from "../../constants/sessions";
import { createGuardedLoader } from "./guardedLoader";
import { theme } from "../../common/theme";
import { ResizableModal } from "../shared/ResizableModal";
import { computeRenderOrder } from "./virtualization";
import { HistoryDiffContext } from "../../types/diff";

interface UnifiedDiffViewProps {
  filePath: string | null;
  isOpen: boolean;
  onClose: () => void;
  mode?: "session" | "history";
  historyContext?: HistoryDiffContext;
  viewMode?: "modal" | "sidebar";
  className?: string;
  onSelectedFileChange?: (filePath: string | null) => void;
}

interface DiffViewPreferences {
  continuous_scroll: boolean;
  compact_diffs: boolean;
  sidebar_width?: number;
  inline_sidebar_default?: boolean;
}

export const shouldHandleFileChange = (
  eventSession: string | null | undefined,
  isCommander: boolean,
  sessionName: string | null,
) => {
  const targetSession = isCommander ? ORCHESTRATOR_SESSION_NAME : sessionName;
  if (!targetSession) return false;
  return eventSession === targetSession;
};

const RECENTLY_RENDERED_LIMIT = 8;
const LOCKED_RENDER_LIMIT = RECENTLY_RENDERED_LIMIT * 2;

export function UnifiedDiffView({
  filePath,
  isOpen,
  onClose,
  mode: incomingMode,
  historyContext,
  viewMode = "modal",
  className,
  onSelectedFileChange,
}: UnifiedDiffViewProps) {
  const mode: "session" | "history" = incomingMode ?? "session";
  const { selection, setSelection, terminals } = useSelection();
  const selectedKind = selection.kind;
  const terminalTop = terminals.top;
  const {
    currentReview,
    startReview,
    addComment,
    getCommentsForFile,
    clearReview,
    removeComment,
  } = useReview();
  const { setFocusForSession, setCurrentFocus } = useFocus();
  const { sessions, reloadSessions } = useSessions();
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig();
  const platform = useMemo(() => detectPlatformSafe(), []);
  const lineSelection = useLineSelection();
  const lineSelectionRef = useRef(lineSelection);
  lineSelectionRef.current = lineSelection;

  const { setHoveredLineInfo, clearHoveredLine, useHoverKeyboardShortcuts } =
    useDiffHover();

  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(filePath);
  const lastNotifiedFileRef = useRef<string | null>(filePath);
  const [fileError, setFileError] = useState<string | null>(null);
  const [branchInfo, setBranchInfo] = useState<{
    currentBranch: string;
    baseBranch: string;
    baseCommit: string;
    headCommit: string;
  } | null>(null);
  const [historyHeader, setHistoryHeader] = useState<{
    subject: string;
    author: string;
    hash: string;
    committedAt?: string;
  } | null>(null);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [allFileDiffs, setAllFileDiffs] = useState<Map<string, FileDiffData>>(
    new Map(),
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const suppressAutoSelectRef = useRef(false);
  const leftScrollRafRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const lastInitialFilePathRef = useRef<string | null>(null);

  const [visibleFilePath, setVisibleFilePath] = useState<string | null>(null);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [expandedSections, setExpandedSections] = useState<
    Map<string, Set<number>>
  >(new Map());
  const [commentFormPosition, setCommentFormPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const [continuousScroll, setContinuousScroll] = useState(false);
  const [compactDiffs, setCompactDiffs] = useState(true);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const sidebarWidthRef = useRef(320);
  const inlineSidebarDefaultRef = useRef(true);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarDragStartRef = useRef<{ x: number; width: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const fileBodyHeightsRef = useRef<Map<string, number>>(new Map());
  const [, setFileHeightsVersion] = useState(0);
  const clampSidebarWidth = useCallback(
    (value: number) => Math.min(600, Math.max(200, value)),
    [],
  );

  const [visibleFileSet, setVisibleFileSet] = useState<Set<string>>(new Set());
  const [renderedFileSet, setRenderedFileSet] = useState<Set<string>>(
    new Set(),
  );
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pendingVisibilityUpdatesRef = useRef<Map<string, boolean>>(new Map());
  const visibilityFrameRef = useRef<number | NodeJS.Timeout | null>(null);
  const recentlyVisibleRef = useRef<string[]>([]);
  const [isVirtualizationLocked, setIsVirtualizationLocked] = useState(false);
  const virtualizationUnlockTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const historyPrefetchQueueRef = useRef<string[]>([]);
  const historyPrefetchActiveRef = useRef<Set<string>>(new Set());
  const activeSelectionFileRef = useRef<string | null>(null);
  const historyLoadedRef = useRef<Set<string>>(new Set());
  const [historyPrefetchVersion, setHistoryPrefetchVersion] = useState(0);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [alwaysShowLargeDiffs, setAlwaysShowLargeDiffs] = useState(false);

  // Force continuous scroll in sidebar mode
  const isSidebarMode = viewMode === "sidebar";
  const effectiveContinuousScroll =
    mode === "history" || isSidebarMode ? true : continuousScroll;
  const isLargeDiffMode = useMemo(() => {
    return !effectiveContinuousScroll;
  }, [effectiveContinuousScroll]);

  const historyFiles = useMemo<ChangedFile[]>(() => {
    if (mode !== "history" || !historyContext) {
      return [];
    }
    return historyContext.files.map((file) => ({
      path: file.path,
      change_type: normalizeCommitChangeType(file.changeType),
      previous_path: file.oldPath,
      additions: 0,
      deletions: 0,
      changes: 0,
    }));
  }, [mode, historyContext]);

  const historyInitialFile = useMemo(() => {
    if (mode !== "history") {
      return null;
    }
    if (filePath && historyFiles.some((file) => file.path === filePath)) {
      return filePath;
    }
    return historyFiles[0]?.path ?? null;
  }, [mode, filePath, historyFiles]);

  useEffect(() => {
    if (!isOpen || mode !== "history") {
      return;
    }
    setSelectedFile(historyInitialFile);
    if (historyInitialFile) {
      const idx = historyFiles.findIndex(
        (file) => file.path === historyInitialFile,
      );
      setSelectedFileIndex(idx >= 0 ? idx : 0);
    } else {
      setSelectedFileIndex(0);
    }
  }, [isOpen, mode, historyInitialFile, historyFiles]);

  const emptyThreadCommentsForFile = useCallback(
    (): ReviewCommentThread[] => [],
    [],
  );
  const emptyReviewCommentsForFile = useCallback((): ReviewComment[] => [], []);
  const historyLineSelection = useMemo(
    () => ({
      isLineSelected: () => false,
      selection: null as LineSelection | null,
    }),
    [],
  );

  const commentThreadsByFile = useMemo(() => {
    const map = new Map<string, ReviewCommentThread[]>();
    if (mode === "history") {
      return map;
    }

    files.forEach((file) => {
      const comments = getCommentsForFile(file.path);
      if (!comments || comments.length === 0) {
        map.set(file.path, []);
        return;
      }
      const grouped = new Map<string, ReviewCommentThread>();
      comments.forEach((comment) => {
        const key = `${comment.side}:${comment.lineRange.start}:${comment.lineRange.end}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.comments = [...existing.comments, comment];
        } else {
          grouped.set(key, {
            id: `${file.path}-${key}`,
            filePath: file.path,
            side: comment.side,
            lineRange: { ...comment.lineRange },
            comments: [comment],
          });
        }
      });
      map.set(file.path, Array.from(grouped.values()));
    });

    return map;
  }, [mode, files, getCommentsForFile]);

  const isCommanderView = useCallback(
    () => selection.kind === "orchestrator",
    [selection.kind],
  );
  const sessionName: string | null =
    selection.kind === "session" ? (selection.payload as string) : null;
  const targetSession = useMemo(() => {
    if (selection.kind !== "session" || !sessionName) return null;
    return sessions.find((s) => s.info.session_id === sessionName) ?? null;
  }, [selection.kind, sessionName, sessions]);
  const canMarkReviewed = useMemo(() => {
    if (!targetSession) return false;
    return mapSessionUiState(targetSession.info) === "running";
  }, [targetSession]);

  const handleOpenFile = useCallback(
    async (filePath: string): Promise<string | undefined> => {
      if (mode === "history") {
        return undefined;
      }

      try {
        if (selection.kind === "orchestrator") {
          const repoPath = await invoke<string | null>(
            TauriCommands.GetActiveProjectPath,
          );
          return repoPath ? `${repoPath}/${filePath}` : undefined;
        } else if (sessionName) {
          const sessionData = await invoke<{ worktree_path?: string }>(
            TauriCommands.SchaltwerkCoreGetSession,
            { name: sessionName },
          );
          const worktreePath = sessionData?.worktree_path;
          if (worktreePath) {
            return `${worktreePath}/${filePath}`;
          }
        }
      } catch (err) {
        logger.error("Failed to resolve file path for opening:", err);
      }
      return undefined;
    },
    [mode, selection.kind, sessionName],
  );
  const openFileHandler = mode === "history" ? undefined : handleOpenFile;

  const getThreadsForFile = useCallback(
    (filePath: string) => {
      return commentThreadsByFile.get(filePath) ?? [];
    },
    [commentThreadsByFile],
  );

  useEffect(() => {
    if (mode === "history") {
      return;
    }
    if (lineSelection.selection && !isDraggingSelection) {
      setShowCommentForm(true);
    } else if (!lineSelection.selection) {
      setShowCommentForm(false);
      setCommentFormPosition(null);
      activeSelectionFileRef.current = null;
    }
  }, [mode, lineSelection.selection, isDraggingSelection]);

  useEffect(() => {
    setSelectedFile(filePath);
  }, [filePath]);

  useEffect(() => {
    if (!onSelectedFileChange) return;
    if (lastNotifiedFileRef.current === selectedFile) return;
    lastNotifiedFileRef.current = selectedFile;
    onSelectedFileChange(selectedFile);
  }, [onSelectedFileChange, selectedFile]);

  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<{ always_show_large_diffs?: boolean }>(
          TauriCommands.GetSessionPreferences,
        );
        setAlwaysShowLargeDiffs(prefs?.always_show_large_diffs ?? false);
      } catch (error) {
        logger.debug(
          "Failed to load session preferences for diff collapse:",
          error,
        );
      }
    };
    void loadPreferences();
  }, []);

  useEffect(() => {
    if (mode === "history") {
      return;
    }
    if (!isOpen) return;
    if (selection.kind === "orchestrator") {
      if (!currentReview || currentReview.sessionName !== "orchestrator") {
        void startReview("orchestrator");
      }
      return;
    }
    if (
      sessionName &&
      (!currentReview || currentReview.sessionName !== sessionName)
    ) {
      void startReview(sessionName);
    }
  }, [mode, isOpen, selection.kind, sessionName, currentReview, startReview]);

  const persistDiffPreferences = useCallback(
    async (
      partial: Partial<{
        continuous_scroll: boolean;
        compact_diffs: boolean;
        sidebar_width: number;
      }>,
    ) => {
      if (mode === "history" || isSidebarMode) {
        return;
      }
      const payload = {
        continuous_scroll: partial.continuous_scroll ?? continuousScroll,
        compact_diffs: partial.compact_diffs ?? compactDiffs,
        sidebar_width: partial.sidebar_width ?? sidebarWidthRef.current,
        inline_sidebar_default: inlineSidebarDefaultRef.current,
      };

      try {
        await invoke(TauriCommands.SetDiffViewPreferences, {
          preferences: payload,
        });
      } catch (err) {
        logger.error("Failed to save diff view preference:", err);
      }
    },
    [mode, isSidebarMode, continuousScroll, compactDiffs],
  );

  const toggleContinuousScroll = useCallback(async () => {
    if (mode === "history" || isSidebarMode) {
      return;
    }
    const newValue = !continuousScroll;

    setAllFileDiffs(new Map());
    setVisibleFilePath(null);

    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }

    setContinuousScroll(newValue);

    if (selectedFile) {
      const file = files.find((f) => f.path === selectedFile);
      if (file) {
        try {
          const diff = await loadFileDiff(sessionName, file, "unified");
          setAllFileDiffs(new Map([[selectedFile, diff]]));
        } catch (e) {
          logger.error("Failed to reload selected file:", e);
        }
      }
    }

    void persistDiffPreferences({ continuous_scroll: newValue });
  }, [
    mode,
    isSidebarMode,
    continuousScroll,
    selectedFile,
    files,
    sessionName,
    persistDiffPreferences,
  ]);

  const toggleCompactDiffs = useCallback(() => {
    setCompactDiffs((prev) => {
      const next = !prev;
      void persistDiffPreferences({ compact_diffs: next });
      return next;
    });
  }, [persistDiffPreferences]);

  const handleCopyLineFromContext = useCallback(
    async ({
      filePath,
      lineNumber,
    }: {
      filePath: string;
      lineNumber: number;
      side: "old" | "new";
    }) => {
      try {
        await invoke(TauriCommands.ClipboardWriteText, {
          text: String(lineNumber),
        });
      } catch (err) {
        logger.error("Failed to copy line number to clipboard", {
          filePath,
          lineNumber,
          err,
        });
      }
    },
    [],
  );

  const handleCopyCodeFromContext = useCallback(
    async ({ filePath, text }: { filePath: string; text: string }) => {
      try {
        await invoke(TauriCommands.ClipboardWriteText, { text });
      } catch (err) {
        logger.error("Failed to copy code to clipboard", { filePath, err });
      }
    },
    [],
  );

  const handleCopyFilePath = useCallback(async (filePath: string) => {
    try {
      await invoke(TauriCommands.ClipboardWriteText, { text: filePath });
    } catch (err) {
      logger.error("Failed to copy file path to clipboard", err);
    }
  }, []);

  const beginSidebarResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      sidebarDragStartRef.current = {
        x: event.clientX,
        width: sidebarWidthRef.current,
      };
      setIsResizingSidebar(true);
      document.body.style.cursor = "col-resize";
    },
    [],
  );

  const handleSidebarResizeMove = useCallback(
    (event: MouseEvent) => {
      const start = sidebarDragStartRef.current;
      if (!start) return;
      const delta = event.clientX - start.x;
      const targetWidth = clampSidebarWidth(start.width + delta);
      if (targetWidth === sidebarWidthRef.current) return;
      if (resizeFrameRef.current !== null) return;
      sidebarWidthRef.current = targetWidth;
      setSidebarWidth(targetWidth);
      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        resizeFrameRef.current = window.requestAnimationFrame(() => {
          resizeFrameRef.current = null;
        });
      }
    },
    [clampSidebarWidth],
  );

  const finishSidebarResize = useCallback(() => {
    if (!isResizingSidebar) return;
    setIsResizingSidebar(false);
    sidebarDragStartRef.current = null;
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    document.body.style.cursor = "";
    void persistDiffPreferences({
      sidebar_width: Math.round(sidebarWidthRef.current),
    });
  }, [isResizingSidebar, persistDiffPreferences]);

  useEffect(() => {
    if (!isResizingSidebar) return;
    const onMove = (event: MouseEvent) => handleSidebarResizeMove(event);
    const onUp = () => finishSidebarResize();

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, [isResizingSidebar, handleSidebarResizeMove, finishSidebarResize]);

  const fetchSessionChangedFiles = useCallback(async () => {
    return await invoke<ChangedFile[]>(TauriCommands.GetChangedFilesFromMain, {
      sessionName,
    });
  }, [sessionName]);

  const fetchOrchestratorChangedFiles = useCallback(async () => {
    return await invoke<ChangedFile[]>(
      TauriCommands.GetOrchestratorWorkingChanges,
    );
  }, []);

  const loadChangedFiles = useCallback(async () => {
    if (mode === "history") {
      if (!historyContext) {
        logger.warn("[UnifiedDiffView] History mode invoked without context");
        return;
      }

      setBranchInfo(null);
      setHistoryHeader({
        subject: historyContext.subject,
        author: historyContext.author,
        hash: historyContext.commitHash,
        committedAt: historyContext.committedAt,
      });

      setFiles(historyFiles);

      const initialPath = historyInitialFile;
      const initialIndex = initialPath
        ? Math.max(
            historyFiles.findIndex((f) => f.path === initialPath),
            0,
          )
        : 0;

      setSelectedFile(initialPath);
      setSelectedFileIndex(initialIndex);
      setFileError(null);

      const seedSet = computeHistorySeedWindow(historyFiles, initialIndex);
      const seedArray = Array.from(seedSet);
      recentlyVisibleRef.current = seedArray;
      setRenderedFileSet(new Set(seedArray));
      setVisibleFileSet(new Set(seedArray));
      setLoadingFiles(new Set());
      setAllFileDiffs(new Map());

      historyLoadedRef.current.clear();
      historyPrefetchActiveRef.current.clear();
      historyPrefetchQueueRef.current = buildHistoryPrefetchQueue(
        historyFiles,
        initialIndex,
        seedSet,
      );
      setHistoryPrefetchVersion((prev) => prev + 1);

      if (initialPath) {
        const commitFile = historyContext.files.find(
          (file) => file.path === initialPath,
        );
        if (commitFile) {
          try {
            const diff = await loadCommitFileDiff({
              repoPath: historyContext.repoPath,
              commitHash: historyContext.commitHash,
              file: commitFile,
            });
            historyLoadedRef.current.add(initialPath);
            setAllFileDiffs(new Map([[initialPath, diff]]));
          } catch (error) {
            logger.error(
              `Failed to load commit file diff for ${initialPath}`,
              error,
            );
            const message =
              error instanceof Error ? error.message : String(error);
            setFileError(message);
          }
        }
      }
      return;
    }

    try {
      const changedFiles = isCommanderView()
        ? await fetchOrchestratorChangedFiles()
        : await fetchSessionChangedFiles();
      setFiles(changedFiles);

      let nextSelectedPath: string | null = null;
      let nextSelectedIndex = 0;

      if (changedFiles.length > 0) {
        const requestedPath = filePath || null;
        if (requestedPath) {
          const foundIndex = changedFiles.findIndex(
            (f) => f.path === requestedPath,
          );
          if (foundIndex >= 0) {
            nextSelectedPath = changedFiles[foundIndex].path;
            nextSelectedIndex = foundIndex;
          } else {
            nextSelectedPath = changedFiles[0].path;
            nextSelectedIndex = 0;
          }
        } else {
          nextSelectedPath = changedFiles[0].path;
          nextSelectedIndex = 0;
        }
      } else {
        setSelectedFile(null);
        setSelectedFileIndex(0);
        setVisibleFilePath(null);
        setAllFileDiffs(new Map());
        setRenderedFileSet(new Set());
        setVisibleFileSet(new Set());
        setLoadingFiles(new Set());
        setFileError(null);
      }

      if (nextSelectedPath) {
        setSelectedFile(nextSelectedPath);
        setSelectedFileIndex(nextSelectedIndex);
        setVisibleFilePath(nextSelectedPath);
        setFileError(null);
        const targetFile = changedFiles[nextSelectedIndex];
        if (targetFile) {
          try {
            const primary = await loadFileDiff(
              sessionName,
              targetFile,
              "unified",
            );
            setAllFileDiffs((prev) => {
              const merged = new Map(prev);
              merged.set(nextSelectedPath!, primary);
              return merged;
            });
          } catch (e) {
            logger.error(`Failed to load file diff for ${nextSelectedPath}`, e);
            const msg = e instanceof Error ? e.message : String(e);
            setFileError(msg);
          }
        }
      }

      const currentBranch = await invoke<string>(
        TauriCommands.GetCurrentBranchName,
        { sessionName },
      );
      const baseBranch = await invoke<string>(TauriCommands.GetBaseBranchName, {
        sessionName,
      });
      const [baseCommit, headCommit] = await invoke<[string, string]>(
        TauriCommands.GetCommitComparisonInfo,
        { sessionName },
      );

      setBranchInfo({ currentBranch, baseBranch, baseCommit, headCommit });
      setHistoryHeader(null);
    } catch (error) {
      logger.error("Failed to load changed files:", error);
    }
  }, [
    mode,
    historyContext,
    historyFiles,
    historyInitialFile,
    isCommanderView,
    fetchOrchestratorChangedFiles,
    fetchSessionChangedFiles,
    filePath,
    sessionName,
  ]);

  // Prevent overlapping loads; queue a single follow-up run if an event fires mid-load.
  const guardedLoaderRef = useRef(createGuardedLoader(loadChangedFiles));
  const loadChangedFilesGuarded = useCallback(
    () => guardedLoaderRef.current.run(),
    [],
  );

  const handleDiscardFile = useCallback(
    async (filePath: string) => {
      if (mode === "history") {
        return;
      }
      try {
        if (selection.kind === "orchestrator") {
          await invoke(TauriCommands.SchaltwerkCoreDiscardFileInOrchestrator, {
            filePath,
          });
        } else if (sessionName) {
          await invoke(TauriCommands.SchaltwerkCoreDiscardFileInSession, {
            sessionName,
            filePath,
          });
        } else {
          return;
        }
        await loadChangedFiles();
      } catch (err) {
        logger.error("Failed to discard file changes", err);
      }
    },
    [mode, selection.kind, sessionName, loadChangedFiles],
  );

  useEffect(() => {
    if (mode !== "history" || !isOpen || !historyContext) {
      return;
    }

    let cancelled = false;
    const MAX_CONCURRENCY = 3;

    const activeSet = historyPrefetchActiveRef.current;

    const pumpQueue = () => {
      if (cancelled) {
        return;
      }
      const queue = historyPrefetchQueueRef.current;
      while (activeSet.size < MAX_CONCURRENCY && queue.length > 0) {
        const nextPath = queue.shift()!;
        if (historyLoadedRef.current.has(nextPath) || activeSet.has(nextPath)) {
          continue;
        }

        const commitFile = historyContext.files.find(
          (file) => file.path === nextPath,
        );
        if (!commitFile) {
          continue;
        }

        activeSet.add(nextPath);
        setLoadingFiles((prev) => {
          const next = new Set(prev);
          next.add(nextPath);
          return next;
        });

        void loadCommitFileDiff({
          repoPath: historyContext.repoPath,
          commitHash: historyContext.commitHash,
          file: commitFile,
        })
          .then((diff) => {
            if (cancelled) {
              return;
            }
            historyLoadedRef.current.add(nextPath);
            setAllFileDiffs((prev) => {
              const next = new Map(prev);
              next.set(nextPath, diff);
              return next;
            });
          })
          .catch((error) => {
            if (!cancelled) {
              logger.warn(
                "[UnifiedDiffView] Failed to prefetch history diff",
                error,
              );
            }
          })
          .finally(() => {
            if (cancelled) {
              return;
            }
            activeSet.delete(nextPath);
            setLoadingFiles((prev) => {
              const next = new Set(prev);
              next.delete(nextPath);
              return next;
            });
            pumpQueue();
          });
      }
    };

    pumpQueue();

    return () => {
      cancelled = true;
      activeSet.clear();
    };
  }, [mode, isOpen, historyContext, historyPrefetchVersion]);

  const scrollToFile = useCallback(
    async (path: string, index?: number) => {
      suppressAutoSelectRef.current = true;
      setSelectedFile(path);
      setVisibleFilePath(path);
      setFileError(null);
      if (index !== undefined) {
        setSelectedFileIndex(index);
      }

      if (mode === "history") {
        historyPrefetchQueueRef.current = [
          path,
          ...historyPrefetchQueueRef.current.filter(
            (candidate) => candidate !== path,
          ),
        ];
        setHistoryPrefetchVersion((prev) => prev + 1);
      }

      if (!allFileDiffs.has(path)) {
        const file = files.find((f) => f.path === path);
        if (file) {
          try {
            let diff: FileDiffData | null = null;
            if (mode === "history" && historyContext) {
              const commitFile = historyContext.files.find(
                (entry) => entry.path === path,
              );
              if (commitFile) {
                diff = await loadCommitFileDiff({
                  repoPath: historyContext.repoPath,
                  commitHash: historyContext.commitHash,
                  file: commitFile,
                });
                historyLoadedRef.current.add(path);
              }
            } else {
              diff = await loadFileDiff(sessionName, file, "unified");
            }

            if (diff) {
              setAllFileDiffs((prev) => {
                const merged = new Map(prev);
                merged.set(path, diff as FileDiffData);
                return merged;
              });
            }
          } catch (e) {
            logger.error(`Failed to load file diff for ${path}`, e);
            const msg = e instanceof Error ? e.message : String(e);
            setFileError(msg);
          }
        }
      }

      if (isLargeDiffMode) {
        window.setTimeout(() => {
          suppressAutoSelectRef.current = false;
        }, 150);
        return;
      }
      requestAnimationFrame(() => {
        const fileElement = fileRefs.current.get(path);
        const container = scrollContainerRef.current;
        if (fileElement && container) {
          const containerRect = container.getBoundingClientRect();
          const elementRect = fileElement.getBoundingClientRect();
          const stickyOffsetPx = 0;
          const delta = elementRect.top - containerRect.top;
          container.scrollTop += delta - stickyOffsetPx;
        }
      });

      lineSelectionRef.current.clearSelection();
      setShowCommentForm(false);
      setCommentFormPosition(null);
      window.setTimeout(() => {
        suppressAutoSelectRef.current = false;
      }, 250);
    },
    [
      mode,
      historyContext,
      setHistoryPrefetchVersion,
      isLargeDiffMode,
      files,
      sessionName,
      allFileDiffs,
    ],
  );

  useEffect(() => {
    if (!isOpen || isLargeDiffMode) {
      setIsVirtualizationLocked(false);
      if (virtualizationUnlockTimeoutRef.current) {
        clearTimeout(virtualizationUnlockTimeoutRef.current);
        virtualizationUnlockTimeoutRef.current = null;
      }
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const releaseLock = () => {
      virtualizationUnlockTimeoutRef.current = null;
      setIsVirtualizationLocked(false);
    };

    const scheduleUnlock = () => {
      if (virtualizationUnlockTimeoutRef.current) {
        clearTimeout(virtualizationUnlockTimeoutRef.current);
      }
      virtualizationUnlockTimeoutRef.current = setTimeout(releaseLock, 180);
    };

    const handleScroll = () => {
      setIsVirtualizationLocked((prev) => (prev ? prev : true));
      scheduleUnlock();
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (virtualizationUnlockTimeoutRef.current) {
        clearTimeout(virtualizationUnlockTimeoutRef.current);
        virtualizationUnlockTimeoutRef.current = null;
      }
    };
  }, [isOpen, isLargeDiffMode]);

  useEffect(() => {
    const pendingUpdates = pendingVisibilityUpdatesRef.current;

    const clearPendingFrame = () => {
      if (visibilityFrameRef.current != null) {
        if (
          typeof window !== "undefined" &&
          typeof window.cancelAnimationFrame === "function"
        ) {
          window.cancelAnimationFrame(visibilityFrameRef.current as number);
        } else {
          clearTimeout(visibilityFrameRef.current as NodeJS.Timeout);
        }
        visibilityFrameRef.current = null;
      }
    };

    if (!isOpen || isLargeDiffMode) {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      pendingUpdates.clear();
      clearPendingFrame();
      setVisibleFileSet((prev) => (prev.size === 0 ? prev : new Set<string>()));
      recentlyVisibleRef.current = [];
      setRenderedFileSet((prev) =>
        prev.size === 0 ? prev : new Set<string>(),
      );
      return;
    }

    const flushPendingVisibility = () => {
      visibilityFrameRef.current = null;
      if (pendingUpdates.size === 0) return;
      const updates = new Map(pendingUpdates);
      pendingUpdates.clear();
      setVisibleFileSet((prev) => {
        let mutated = false;
        const next = new Set(prev);
        updates.forEach((isVisible, path) => {
          if (isVisible) {
            if (!next.has(path)) {
              next.add(path);
              mutated = true;
            }
          } else if (next.delete(path)) {
            mutated = true;
          }
        });
        return mutated ? next : prev;
      });
    };

    const scheduleFlush = () => {
      if (visibilityFrameRef.current != null) return;
      const frameCallback = () => flushPendingVisibility();
      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        visibilityFrameRef.current =
          window.requestAnimationFrame(frameCallback);
      } else {
        const timeoutId = setTimeout(() => frameCallback(), 16);
        visibilityFrameRef.current = timeoutId;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const filePath = entry.target.getAttribute("data-file-path");
          if (filePath) {
            pendingUpdates.set(filePath, entry.isIntersecting);
          }
        });
        scheduleFlush();
      },
      {
        root: scrollContainerRef.current,
        rootMargin: "600px 0px",
        threshold: 0,
      },
    );

    observerRef.current = observer;

    fileRefs.current.forEach((element) => {
      if (element) observer.observe(element);
    });

    return () => {
      observer.disconnect();
      pendingUpdates.clear();
      clearPendingFrame();
      if (observerRef.current === observer) {
        observerRef.current = null;
      }
    };
  }, [isOpen, isLargeDiffMode, files]);

  useEffect(() => {
    if (isLargeDiffMode || !isOpen) {
      return;
    }

    const previousList = recentlyVisibleRef.current;
    const previousSet = new Set(previousList);
    const visibleArray = Array.from(visibleFileSet);
    const newEntries = visibleArray.filter((path) => !previousSet.has(path));
    const existingEntries = visibleArray.filter((path) =>
      previousSet.has(path),
    );
    const prioritizedVisible = [...newEntries, ...existingEntries];
    const baseLimit = isVirtualizationLocked
      ? LOCKED_RENDER_LIMIT
      : RECENTLY_RENDERED_LIMIT;
    const effectiveLimit = Math.max(visibleArray.length, baseLimit);
    const nextList = computeRenderOrder(
      previousList,
      prioritizedVisible,
      effectiveLimit,
    );

    recentlyVisibleRef.current = nextList;

    if (isVirtualizationLocked) {
      return;
    }

    const nextSet = new Set(nextList);
    setRenderedFileSet((prev) => (setsEqual(prev, nextSet) ? prev : nextSet));
  }, [visibleFileSet, isVirtualizationLocked, isLargeDiffMode, isOpen]);

  useEffect(() => {
    if (isLargeDiffMode || !isOpen) {
      return;
    }

    const fileIndexMap = new Map<string, number>();
    const filesByPath = new Map<string, (typeof files)[0]>();
    files.forEach((file, index) => {
      fileIndexMap.set(file.path, index);
      filesByPath.set(file.path, file);
    });

    const loadQueue = new Set<string>();

    visibleFileSet.forEach((path) => {
      if (mode === "history") {
        if (
          historyLoadedRef.current.has(path) ||
          historyPrefetchActiveRef.current.has(path)
        ) {
          return;
        }
      }
      if (!allFileDiffs.has(path) && !loadingFiles.has(path)) {
        loadQueue.add(path);
      }
    });

    visibleFileSet.forEach((path) => {
      const index = fileIndexMap.get(path);
      if (index === undefined) return;

      if (index > 0) {
        const prevPath = files[index - 1].path;
        if (mode === "history") {
          if (
            historyLoadedRef.current.has(prevPath) ||
            historyPrefetchActiveRef.current.has(prevPath)
          ) {
            // skip
          } else if (
            !allFileDiffs.has(prevPath) &&
            !loadingFiles.has(prevPath)
          ) {
            loadQueue.add(prevPath);
          }
        } else if (!allFileDiffs.has(prevPath) && !loadingFiles.has(prevPath)) {
          loadQueue.add(prevPath);
        }
      }
      if (index < files.length - 1) {
        const nextPath = files[index + 1].path;
        if (mode === "history") {
          if (
            historyLoadedRef.current.has(nextPath) ||
            historyPrefetchActiveRef.current.has(nextPath)
          ) {
            // skip
          } else if (
            !allFileDiffs.has(nextPath) &&
            !loadingFiles.has(nextPath)
          ) {
            loadQueue.add(nextPath);
          }
        } else if (!allFileDiffs.has(nextPath) && !loadingFiles.has(nextPath)) {
          loadQueue.add(nextPath);
        }
      }
    });

    if (loadQueue.size === 0) return;

    const loadNextBatch = async () => {
      const batch = Array.from(loadQueue).slice(0, 3);
      const loadPromises = batch.map(async (path) => {
        const file = filesByPath.get(path);
        if (!file) return null;
        try {
          if (mode === "history" && historyContext) {
            const commitFile = historyContext.files.find(
              (entry) => entry.path === path,
            );
            if (!commitFile) {
              return null;
            }
            historyPrefetchActiveRef.current.add(path);
            const diff = await loadCommitFileDiff({
              repoPath: historyContext.repoPath,
              commitHash: historyContext.commitHash,
              file: commitFile,
            });
            historyPrefetchActiveRef.current.delete(path);
            historyLoadedRef.current.add(path);
            return { path, diff };
          }

          const diff = await loadFileDiff(sessionName, file, "unified");
          return { path, diff };
        } catch (e) {
          logger.error(`Failed to load diff for ${path}:`, e);
          if (mode === "history") {
            historyPrefetchActiveRef.current.delete(path);
          }
          return null;
        }
      });

      setLoadingFiles((prev) => {
        const next = new Set(prev);
        batch.forEach((path) => next.add(path));
        return next;
      });

      const results = await Promise.all(loadPromises);

      setAllFileDiffs((prev) => {
        const next = new Map(prev);
        results.forEach((result) => {
          if (result) {
            next.set(result.path, result.diff);
          }
        });
        return next;
      });

      setLoadingFiles((prev) => {
        const next = new Set(prev);
        batch.forEach((path) => next.delete(path));
        return next;
      });
    };

    void loadNextBatch();
  }, [
    visibleFileSet,
    files,
    allFileDiffs,
    loadingFiles,
    isLargeDiffMode,
    isOpen,
    sessionName,
    mode,
    historyContext,
  ]);

  useEffect(() => {
    if (isLargeDiffMode || !isOpen) return;

    const cleanupTimer = setTimeout(() => {
      const MAX_LOADED_DIFFS = 20;
      if (allFileDiffs.size <= MAX_LOADED_DIFFS) return;

      const keepSet = new Set<string>();

      visibleFileSet.forEach((path) => {
        keepSet.add(path);
        const index = files.findIndex((f) => f.path === path);
        if (index > 0) keepSet.add(files[index - 1].path);
        if (index < files.length - 1) keepSet.add(files[index + 1].path);
      });

      if (selectedFile) keepSet.add(selectedFile);

      const toRemove: string[] = [];
      allFileDiffs.forEach((_, path) => {
        if (!keepSet.has(path)) {
          toRemove.push(path);
        }
      });

      const removeCount = allFileDiffs.size - MAX_LOADED_DIFFS;
      if (removeCount > 0) {
        toRemove.slice(0, removeCount).forEach((path) => {
          setAllFileDiffs((prev) => {
            const next = new Map(prev);
            next.delete(path);
            return next;
          });
        });
      }
    }, 2000);

    return () => clearTimeout(cleanupTimer);
  }, [
    allFileDiffs,
    visibleFileSet,
    files,
    selectedFile,
    isLargeDiffMode,
    isOpen,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (isLargeDiffMode) return;
    const updateSelectionForRoot = (
      rootEl: HTMLElement,
      rafRef: React.MutableRefObject<number | null>,
    ) => {
      if (suppressAutoSelectRef.current) return;
      if (files.length === 0) return;
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const rootTop = rootEl.getBoundingClientRect().top;
        let bestPath: string | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const file of files) {
          const el = fileRefs.current.get(file.path);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.top - rootTop);
          if (dist < bestDist) {
            bestDist = dist;
            bestPath = file.path;
          }
        }
        if (bestPath && bestPath !== visibleFilePath) {
          setVisibleFilePath(bestPath);
          setSelectedFile(bestPath);
          const index = files.findIndex((f) => f.path === bestPath);
          if (index >= 0) {
            setSelectedFileIndex(index);
          }
        }
      });
    };

    const leftRoot = scrollContainerRef.current;
    if (!leftRoot) return;

    const onLeftScroll = () =>
      leftRoot && updateSelectionForRoot(leftRoot, leftScrollRafRef);

    leftRoot?.addEventListener("scroll", onLeftScroll, { passive: true });

    if (leftRoot) updateSelectionForRoot(leftRoot, leftScrollRafRef);

    return () => {
      leftRoot?.removeEventListener("scroll", onLeftScroll);
      if (leftScrollRafRef.current != null) {
        cancelAnimationFrame(leftScrollRafRef.current);
        leftScrollRafRef.current = null;
      }
    };
  }, [isOpen, files, visibleFilePath, isLargeDiffMode]);

  useEffect(() => {
    if (isOpen) {
      void loadChangedFilesGuarded();
      if (!isSidebarMode) {
        void invoke<DiffViewPreferences>(TauriCommands.GetDiffViewPreferences)
          .then((prefs) => {
            setContinuousScroll(prefs.continuous_scroll);
            setCompactDiffs(prefs.compact_diffs ?? true);
            const width = clampSidebarWidth(
              prefs.sidebar_width ?? sidebarWidthRef.current,
            );
            setSidebarWidth(width);
            sidebarWidthRef.current = width;
            inlineSidebarDefaultRef.current =
              prefs.inline_sidebar_default ?? true;
          })
          .catch((err) =>
            logger.error("Failed to load diff view preferences:", err),
          );
      } else {
        setContinuousScroll(true);
        setCompactDiffs(true);
      }
    }
  }, [isOpen, loadChangedFilesGuarded, clampSidebarWidth, isSidebarMode]);

  useEffect(() => {
    if (!isOpen || mode !== "session") return;

    let unlisten: (() => void | Promise<void>) | null = null;

    void listenEvent(SchaltEvent.FileChanges, (event) => {
      if (
        !shouldHandleFileChange(
          event.session_name,
          isCommanderView(),
          sessionName,
        )
      )
        return;
      void loadChangedFilesGuarded();
    })
      .then((remove) => {
        unlisten = remove;
      })
      .catch((err) => {
        logger.warn(
          "[UnifiedDiffView] Failed to attach FileChanges listener",
          err,
        );
      });

    return () => {
      if (unlisten) {
        try {
          const maybePromise = unlisten();
          if (maybePromise instanceof Promise) {
            void maybePromise.catch((error) => {
              logger.warn(
                "[UnifiedDiffView] Failed to detach FileChanges listener",
                error,
              );
            });
          }
        } catch (error) {
          logger.warn(
            "[UnifiedDiffView] Error while detaching FileChanges listener",
            error,
          );
        }
      }
    };
  }, [isOpen, mode, sessionName, isCommanderView, loadChangedFilesGuarded]);

  useEffect(() => {
    if (!isOpen) {
      didInitialScrollRef.current = false;
      lastInitialFilePathRef.current = null;

      pendingVisibilityUpdatesRef.current.clear();
      if (visibilityFrameRef.current != null) {
        if (
          typeof window !== "undefined" &&
          typeof window.cancelAnimationFrame === "function"
        ) {
          window.cancelAnimationFrame(visibilityFrameRef.current as number);
        } else {
          clearTimeout(visibilityFrameRef.current as NodeJS.Timeout);
        }
        visibilityFrameRef.current = null;
      }

      return;
    }
    if (filePath !== lastInitialFilePathRef.current) {
      didInitialScrollRef.current = false;
    }
    if (isOpen && filePath && !didInitialScrollRef.current) {
      const targetPath = filePath;
      suppressAutoSelectRef.current = true;

      let suppressTimeoutId: NodeJS.Timeout;
      const scrollTimeoutId = setTimeout(() => {
        const fileElement = fileRefs.current.get(targetPath);
        const container = scrollContainerRef.current;
        if (fileElement && container) {
          const containerRect = container.getBoundingClientRect();
          const elementRect = fileElement.getBoundingClientRect();
          const stickyOffsetPx = 0;
          const delta = elementRect.top - containerRect.top;
          container.scrollTop += delta - stickyOffsetPx;
        }
        suppressTimeoutId = setTimeout(() => {
          suppressAutoSelectRef.current = false;
        }, 250);
      }, 100);

      didInitialScrollRef.current = true;
      lastInitialFilePathRef.current = filePath;

      return () => {
        clearTimeout(scrollTimeoutId);
        if (suppressTimeoutId) clearTimeout(suppressTimeoutId);
      };
    }
  }, [isOpen, filePath]);

  const HIGHLIGHT_LINE_CAP = 3000;
  const HIGHLIGHT_BLOCK_SIZE = 200;

  const { requestBlockHighlight, readBlockLine } = useHighlightWorker();

  const highlightPlans = useMemo(() => {
    const plans = new Map<string, FileHighlightPlan>();

    for (const file of files) {
      const diff = allFileDiffs.get(file.path);
      if (!diff || !("diffResult" in diff)) continue;

      const descriptors = collectLineDescriptors(file.path, diff);
      if (descriptors.length === 0) continue;

      const blocks: HighlightBlockDescriptor[] = [];
      const lineMap = new Map<string, HighlightLocation>();
      const versionToken = `${diff.changedLinesCount}-${descriptors.length}-${diff.fileInfo?.sizeBytes ?? 0}`;

      for (let i = 0; i < descriptors.length; i += HIGHLIGHT_BLOCK_SIZE) {
        const chunk = descriptors.slice(i, i + HIGHLIGHT_BLOCK_SIZE);
        const blockIndex = blocks.length;
        const lines = chunk.map((entry) => entry.content);
        const blockHash = hashSegments(lines);
        const cacheKey = `${file.path}::${versionToken}::${blockIndex}::${blockHash}`;

        blocks.push({ cacheKey, lines });
        chunk.forEach((entry, offset) => {
          lineMap.set(entry.key, { cacheKey, index: offset });
        });
      }

      plans.set(file.path, {
        blocks,
        lineMap,
        language: diff.fileInfo?.language || getFileLanguage(file.path) || null,
        bypass: shouldBypassHighlighting(diff, HIGHLIGHT_LINE_CAP),
      });
    }

    return plans;
  }, [files, allFileDiffs]);

  useEffect(() => {
    highlightPlans.forEach((plan) => {
      plan.blocks.forEach((block) => {
        requestBlockHighlight({
          cacheKey: block.cacheKey,
          lines: block.lines,
          language: plan.language,
          autoDetect: !plan.language,
          bypass: plan.bypass,
        });
      });
    });
  }, [highlightPlans, requestBlockHighlight]);

  const highlightCode = useCallback(
    (filePath: string, lineKey: string, code: string) => {
      if (!code) return "";

      const plan = highlightPlans.get(filePath);
      if (!plan || plan.bypass) {
        return code;
      }

      const location = plan.lineMap.get(lineKey);
      if (!location) {
        return code;
      }

      return readBlockLine(location.cacheKey, location.index, code);
    },
    [highlightPlans, readBlockLine],
  );

  useEffect(() => {
    if (!isOpen) return;
    performance.mark("udm-open");
    return () => {
      performance.mark("udm-close");
      performance.measure("udm-open-duration", "udm-open", "udm-close");
    };
  }, [isOpen]);

  const clearActiveSelection = useCallback(() => {
    lineSelection.clearSelection();
    activeSelectionFileRef.current = null;
  }, [lineSelection]);

  const handleLineMouseDown = useCallback(
    ({
      lineNum,
      side,
      filePath,
      event,
    }: {
      lineNum: number;
      side: "old" | "new";
      filePath: string;
      event: React.MouseEvent;
    }) => {
      event.preventDefault();
      setIsDraggingSelection(true);
      activeSelectionFileRef.current = filePath;

      lineSelection.handleLineClick(lineNum, side, filePath, event);
    },
    [lineSelection],
  );

  const handleLineMouseEnter = useCallback(
    ({
      lineNum,
      side,
      filePath,
    }: {
      lineNum: number;
      side: "old" | "new";
      filePath: string;
    }) => {
      if (
        isDraggingSelection &&
        lineSelection.selection &&
        lineSelection.selection.side === side &&
        activeSelectionFileRef.current === filePath
      ) {
        lineSelection.extendSelection(lineNum, side, filePath);
      }

      if (selectedFile) {
        setHoveredLineInfo(lineNum, side, selectedFile);
      }
    },
    [isDraggingSelection, lineSelection, selectedFile, setHoveredLineInfo],
  );

  const handleLineMouseLeave = useCallback(
    (_: { filePath: string }) => {
      clearHoveredLine();
    },
    [clearHoveredLine],
  );

  const startCommentOnLine = useCallback(
    (lineNum: number, side: "old" | "new", filePath: string) => {
      clearActiveSelection();
      activeSelectionFileRef.current = filePath;

      lineSelection.handleLineClick(lineNum, side, filePath);

      setShowCommentForm(true);
    },
    [clearActiveSelection, lineSelection],
  );

  const handleStartCommentFromContext = useCallback(
    (payload: {
      filePath: string;
      lineNumber: number;
      side: "old" | "new";
    }) => {
      startCommentOnLine(payload.lineNumber, payload.side, payload.filePath);
    },
    [startCommentOnLine],
  );

  useHoverKeyboardShortcuts(startCommentOnLine, isOpen && mode !== "history");

  const handleLineMouseUp = useCallback(
    ({
      event,
      filePath,
    }: {
      event: MouseEvent | React.MouseEvent;
      filePath: string;
    }) => {
      if (!isDraggingSelection) {
        return;
      }

      setIsDraggingSelection(false);

      const targetFile = activeSelectionFileRef.current ?? filePath;
      if (
        !lineSelection.selection ||
        (targetFile && lineSelection.selection.filePath !== targetFile)
      ) {
        activeSelectionFileRef.current = null;
        return;
      }

      activeSelectionFileRef.current = null;
      setCommentFormPosition({
        x: window.innerWidth - 420,
        y: event.clientY + 10,
      });
    },
    [isDraggingSelection, lineSelection.selection],
  );

  useEffect(() => {
    if (!isDraggingSelection) {
      return;
    }
    const handleGlobalMouseUp = (e: MouseEvent) => {
      const fileForSelection =
        activeSelectionFileRef.current ?? selectedFile ?? "";
      handleLineMouseUp({ event: e, filePath: fileForSelection });
    };
    window.addEventListener("mouseup", handleGlobalMouseUp, true);
    return () =>
      window.removeEventListener("mouseup", handleGlobalMouseUp, true);
  }, [handleLineMouseUp, isDraggingSelection, selectedFile]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const noSelectClass = "sw-no-text-select";
    const body = document.body;
    if (!body) {
      return;
    }
    if (isDraggingSelection) {
      body.classList.add(noSelectClass);
    } else {
      body.classList.remove(noSelectClass);
    }
    return () => {
      body.classList.remove(noSelectClass);
    };
  }, [isDraggingSelection]);

  const registerFileBodyHeight = useCallback(
    (filePath: string, height: number) => {
      const normalizedHeight = Math.max(0, Math.round(height));
      const previous = fileBodyHeightsRef.current.get(filePath);
      if (previous !== undefined && Math.abs(previous - normalizedHeight) < 2) {
        return;
      }
      fileBodyHeightsRef.current.set(filePath, normalizedHeight);
      setFileHeightsVersion((version) => version + 1);
    },
    [],
  );

  useEffect(() => {
    const validPaths = new Set(files.map((f) => f.path));
    let didDelete = false;
    const heights = fileBodyHeightsRef.current;
    heights.forEach((_height, path) => {
      if (!validPaths.has(path)) {
        heights.delete(path);
        didDelete = true;
      }
    });
    if (didDelete) {
      setFileHeightsVersion((version) => version + 1);
    }
  }, [files]);

  useEffect(() => {
    const validPaths = new Set(files.map((f) => f.path));
    setRenderedFileSet((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      let mutated = false;
      const next = new Set<string>();
      prev.forEach((path) => {
        if (validPaths.has(path)) {
          next.add(path);
        } else {
          mutated = true;
        }
      });
      if (mutated) {
        recentlyVisibleRef.current = recentlyVisibleRef.current.filter((path) =>
          validPaths.has(path),
        );
      }
      return mutated ? next : prev;
    });
  }, [files]);

  useEffect(() => {
    setExpandedSections((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const validPaths = new Set(files.map((f) => f.path));
      let mutated = false;
      const next = new Map(prev);
      next.forEach((_set, path) => {
        if (!validPaths.has(path)) {
          next.delete(path);
          mutated = true;
        }
      });
      return mutated ? next : prev;
    });
  }, [files]);

  const toggleCollapsed = useCallback((filePath: string, index: number) => {
    setExpandedSections((prev) => {
      const next = new Map(prev);
      const current = next.get(filePath);
      const updated = new Set(current ?? []);
      if (updated.has(index)) {
        updated.delete(index);
      } else {
        updated.add(index);
      }
      if (updated.size === 0) {
        next.delete(filePath);
      } else {
        next.set(filePath, updated);
      }
      return next;
    });
  }, []);

  const toggleFileExpanded = useCallback((filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!compactDiffs) {
      setExpandedSections((prev) => {
        let mutated = false;
        const next = new Map(prev);
        allFileDiffs.forEach((fileDiff, path) => {
          if (!("diffResult" in fileDiff)) {
            return;
          }
          const previousSet = next.get(path);
          let workingSet = previousSet ?? new Set<number>();
          let localMutated = false;
          fileDiff.diffResult.forEach((line, index) => {
            if (line.isCollapsible && !workingSet.has(index)) {
              if (!localMutated) {
                workingSet = new Set(workingSet);
                localMutated = true;
              }
              workingSet.add(index);
            }
          });
          if (localMutated) {
            next.set(path, workingSet);
            mutated = true;
          } else if (!previousSet && workingSet.size > 0) {
            next.set(path, workingSet);
            mutated = true;
          }
        });
        return mutated ? next : prev;
      });
    } else {
      setExpandedSections(new Map());
    }
  }, [compactDiffs, allFileDiffs]);

  const handleSubmitComment = useCallback(
    async (text: string) => {
      if (!lineSelection.selection || !selectedFile) return;

      const [mainText, worktreeText] = await invoke<[string, string]>(
        TauriCommands.GetFileDiffFromMain,
        {
          sessionName,
          filePath: selectedFile,
        },
      );

      const lines =
        lineSelection.selection.side === "old"
          ? mainText.split("\n")
          : worktreeText.split("\n");

      const selectedText = lines
        .slice(
          lineSelection.selection.startLine - 1,
          lineSelection.selection.endLine,
        )
        .join("\n");

      addComment({
        filePath: selectedFile,
        lineRange: {
          start: lineSelection.selection.startLine,
          end: lineSelection.selection.endLine,
        },
        side: lineSelection.selection.side,
        selectedText,
        comment: text,
      });

      setShowCommentForm(false);
      setCommentFormPosition(null);
      clearActiveSelection();
    },
    [
      lineSelection,
      selectedFile,
      addComment,
      sessionName,
      clearActiveSelection,
    ],
  );

  const { formatReviewForPrompt, getConfirmationMessage } = useReviewComments();

  const handleFinishReview = useCallback(async () => {
    if (!currentReview || currentReview.comments.length === 0) return;

    const reviewText = formatReviewForPrompt(currentReview.comments);

    let useBracketedPaste = true;
    if (sessionName) {
      const session = sessions.find((s) => s.info.session_id === sessionName);
      const agentType = session?.info?.original_agent_type as
        | string
        | undefined;
      if (agentType === "claude" || agentType === "droid") {
        useBracketedPaste = false;
      }
    }

    try {
      if (selectedKind === "orchestrator") {
        const terminalId = terminalTop || "orchestrator-top";
        await invoke(TauriCommands.PasteAndSubmitTerminal, {
          id: terminalId,
          data: reviewText,
          useBracketedPaste,
        });
        await setSelection({ kind: "orchestrator" });
        setCurrentFocus("claude");
      } else if (sessionName) {
        const terminalId = stableSessionTerminalId(sessionName, "top");
        await invoke(TauriCommands.PasteAndSubmitTerminal, {
          id: terminalId,
          data: reviewText,
          useBracketedPaste,
        });
        await setSelection({ kind: "session", payload: sessionName });
        setFocusForSession(sessionName, "claude");
        setCurrentFocus("claude");
      } else {
        logger.warn("[UnifiedDiffView] Finish review had no valid target", {
          selection,
        });
        return;
      }

      clearReview();
      if (onClose) onClose();
    } catch (error) {
      logger.error("Failed to send review to terminal:", error);
    }
  }, [
    currentReview,
    selectedKind,
    terminalTop,
    sessionName,
    sessions,
    formatReviewForPrompt,
    clearReview,
    onClose,
    setSelection,
    setFocusForSession,
    setCurrentFocus,
    selection,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (
        isShortcutForAction(
          e,
          KeyboardShortcutAction.OpenDiffSearch,
          keyboardShortcutConfig,
          { platform },
        )
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const isEditable = (target as HTMLElement)?.isContentEditable;
        if (tag !== "textarea" && tag !== "input" && !isEditable) {
          e.preventDefault();
          e.stopPropagation();
          setIsSearchVisible(true);
          return;
        }
      }

      if (
        mode !== "history" &&
        isShortcutForAction(
          e,
          KeyboardShortcutAction.FinishReview,
          keyboardShortcutConfig,
          { platform },
        )
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const isEditable = (target as HTMLElement)?.isContentEditable;
        if (
          !showCommentForm &&
          tag !== "textarea" &&
          tag !== "input" &&
          !isEditable
        ) {
          e.preventDefault();
          e.stopPropagation();
          void handleFinishReview();
          return;
        }
      }

      if (e.key === "Escape") {
        const hasOpenDialog =
          document.querySelector('[role="dialog"]') !== null;
        if (hasOpenDialog) {
          return;
        }

        const shouldHandleEscape =
          !isSidebarMode || isSearchVisible || showCommentForm;
        if (!shouldHandleEscape) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (isSearchVisible) {
          setIsSearchVisible(false);
        } else if (showCommentForm) {
          setShowCommentForm(false);
          setCommentFormPosition(null);
          clearActiveSelection();
        } else if (mode === "session" && !isSidebarMode) {
          onClose();
        }
      } else if (
        isOpen &&
        !showCommentForm &&
        !isSearchVisible &&
        !isSidebarMode
      ) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          if (selectedFileIndex > 0) {
            const newIndex = selectedFileIndex - 1;
            void scrollToFile(files[newIndex].path, newIndex);
          }
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          if (selectedFileIndex < files.length - 1) {
            const newIndex = selectedFileIndex + 1;
            void scrollToFile(files[newIndex].path, newIndex);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    mode,
    isOpen,
    showCommentForm,
    isSearchVisible,
    onClose,
    lineSelection,
    selectedFileIndex,
    files,
    scrollToFile,
    handleFinishReview,
    setIsSearchVisible,
    setShowCommentForm,
    setCommentFormPosition,
    keyboardShortcutConfig,
    platform,
    clearActiveSelection,
    isSidebarMode,
  ]);

  if (!isOpen) return null;

  const sessionActions = ({
    headerActions,
  }: {
    headerActions: React.ReactNode;
  }) => (
    <>
      {headerActions}
      <button
        onClick={() => {
          toggleCompactDiffs();
        }}
        className="p-1.5 hover:bg-slate-800 rounded-lg"
        title={compactDiffs ? "Show full context" : "Collapse unchanged lines"}
        aria-label={
          compactDiffs ? "Show full context" : "Collapse unchanged lines"
        }
      ></button>
      {!isSidebarMode && (
        <button
          onClick={() => {
            void toggleContinuousScroll();
          }}
          className="p-1.5 hover:bg-slate-800 rounded-lg"
          title={
            continuousScroll
              ? "Switch to single file view"
              : "Switch to continuous scroll"
          }
        >
          {continuousScroll ? (
            <VscListFlat className="text-xl" />
          ) : (
            <VscListSelection className="text-xl" />
          )}
        </button>
      )}
    </>
  );

  const diffContent = (
    <div
      className={`flex-1 flex flex-col overflow-hidden min-h-0 w-full relative ${className || ""}`}
    >
      <DiffViewer
        files={files}
        selectedFile={selectedFile}
        allFileDiffs={allFileDiffs}
        fileError={fileError}
        branchInfo={branchInfo}
        expandedSectionsByFile={expandedSections}
        isLargeDiffMode={isLargeDiffMode}
        isCompactView={compactDiffs}
        visibleFileSet={visibleFileSet}
        renderedFileSet={renderedFileSet}
        loadingFiles={loadingFiles}
        observerRef={observerRef}
        scrollContainerRef={
          scrollContainerRef as React.RefObject<HTMLDivElement>
        }
        fileRefs={fileRefs}
        fileBodyHeights={fileBodyHeightsRef.current}
        alwaysShowLargeDiffs={alwaysShowLargeDiffs}
        expandedFiles={expandedFiles}
        onToggleFileExpanded={toggleFileExpanded}
        onFileBodyHeightChange={registerFileBodyHeight}
        getCommentsForFile={getThreadsForFile}
        highlightCode={highlightCode}
        toggleCollapsed={toggleCollapsed}
        handleLineMouseDown={handleLineMouseDown}
        handleLineMouseEnter={handleLineMouseEnter}
        handleLineMouseLeave={handleLineMouseLeave}
        handleLineMouseUp={handleLineMouseUp}
        lineSelection={lineSelection}
        onCopyLine={(payload) => {
          void handleCopyLineFromContext(payload);
        }}
        onCopyCode={(payload) => {
          void handleCopyCodeFromContext(payload);
        }}
        onCopyFilePath={(path) => {
          void handleCopyFilePath(path);
        }}
        onDiscardFile={handleDiscardFile}
        onStartCommentFromContext={handleStartCommentFromContext}
        onOpenFile={openFileHandler}
      />

      <SearchBox
        targetRef={scrollContainerRef}
        isVisible={isSearchVisible}
        onClose={() => setIsSearchVisible(false)}
      />

      {showCommentForm && lineSelection.selection && (
        <>
          <div
            className="fixed inset-0 z-[59]"
            onClick={(e) => {
              e.stopPropagation();
              setShowCommentForm(false);
              setCommentFormPosition(null);
              clearActiveSelection();
            }}
          />
          <div
            className="fixed right-4 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4 w-96 z-[60]"
            style={{
              top: commentFormPosition
                ? Math.min(commentFormPosition.y, window.innerHeight - 300)
                : "50%",
              transform: commentFormPosition ? "none" : "translateY(-50%)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm mb-3 text-slate-300">
              <div className="font-medium mb-1">Add Review Comment</div>
              <div className="text-xs text-slate-500">
                {lineSelection.selection.startLine ===
                lineSelection.selection.endLine
                  ? `Line ${lineSelection.selection.startLine}`
                  : `Lines ${lineSelection.selection.startLine}-${lineSelection.selection.endLine}`}{" "}
                •{" "}
                {lineSelection.selection.side === "old"
                  ? "Base version"
                  : "Current version"}
              </div>
            </div>
            <CommentForm
              onSubmit={(value) => {
                void handleSubmitComment(value);
              }}
              onCancel={() => {
                setShowCommentForm(false);
                setCommentFormPosition(null);
                clearActiveSelection();
              }}
              keyboardShortcutConfig={keyboardShortcutConfig}
              platform={platform}
            />
          </div>
        </>
      )}
    </div>
  );

  if (mode === "history") {
    const historyHeader2 = historyHeader ? (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <span>Commit Diff Viewer</span>
          <span className="text-xs text-slate-400 font-mono">
            {historyHeader.hash.slice(0, 12)}
          </span>
        </div>
        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-300 truncate">
            {historyHeader.subject}
          </span>
          <span>•</span>
          <span>{historyHeader.author}</span>
          {historyHeader.committedAt && (
            <>
              <span>•</span>
              <span>{historyHeader.committedAt}</span>
            </>
          )}
        </div>
        {selectedFile && (
          <div className="text-xs text-slate-500 truncate max-w-md">
            {selectedFile}
          </div>
        )}
      </div>
    ) : (
      "Commit Diff Viewer"
    );

    return (
      <ResizableModal
        isOpen={isOpen}
        onClose={onClose}
        title={historyHeader2}
        storageKey="diff-history"
        defaultWidth={Math.floor(window.innerWidth * 0.95)}
        defaultHeight={Math.floor(window.innerHeight * 0.9)}
        minWidth={800}
        minHeight={600}
        className="diff-modal-history"
      >
        <div className="flex h-full overflow-hidden">
          <div
            className="flex flex-col h-full"
            data-testid="diff-sidebar"
            style={{
              width: `${sidebarWidth}px`,
              minWidth: "200px",
              maxWidth: "600px",
            }}
          >
            <DiffFileExplorer
              files={files}
              selectedFile={selectedFile}
              visibleFilePath={visibleFilePath}
              onFileSelect={(path, index) => {
                void scrollToFile(path, index);
              }}
              getCommentsForFile={emptyReviewCommentsForFile}
              currentReview={null}
              onFinishReview={() => undefined}
              onCancelReview={() => undefined}
              removeComment={() => undefined}
              getConfirmationMessage={() => ""}
            />
          </div>
          <div
            data-testid="diff-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize file list"
            onMouseDown={beginSidebarResize}
            className="flex items-center justify-center"
            style={{
              width: "6px",
              cursor: "col-resize",
              backgroundColor: isResizingSidebar
                ? theme.colors.accent.blue.DEFAULT
                : theme.colors.border.subtle,
            }}
          >
            <div
              style={{
                width: "2px",
                height: "40px",
                borderRadius: "9999px",
                backgroundColor: theme.colors.border.strong,
                opacity: 0.6,
              }}
            />
          </div>
          <div
            className={`flex-1 flex flex-col overflow-hidden relative ${className || ""}`}
          >
            <DiffViewer
              files={files}
              selectedFile={selectedFile}
              allFileDiffs={allFileDiffs}
              fileError={fileError}
              branchInfo={null}
              expandedSectionsByFile={expandedSections}
              isLargeDiffMode={isLargeDiffMode}
              isCompactView={compactDiffs}
              visibleFileSet={visibleFileSet}
              renderedFileSet={renderedFileSet}
              loadingFiles={loadingFiles}
              observerRef={observerRef}
              scrollContainerRef={
                scrollContainerRef as React.RefObject<HTMLDivElement>
              }
              fileRefs={fileRefs}
              fileBodyHeights={fileBodyHeightsRef.current}
              alwaysShowLargeDiffs={alwaysShowLargeDiffs}
              expandedFiles={expandedFiles}
              onToggleFileExpanded={toggleFileExpanded}
              onFileBodyHeightChange={registerFileBodyHeight}
              getCommentsForFile={emptyThreadCommentsForFile}
              highlightCode={highlightCode}
              toggleCollapsed={toggleCollapsed}
              handleLineMouseDown={() => {}}
              handleLineMouseEnter={() => {}}
              handleLineMouseLeave={() => {}}
              handleLineMouseUp={() => {}}
              lineSelection={historyLineSelection}
              onCopyLine={(payload) => {
                void handleCopyLineFromContext(payload);
              }}
              onCopyCode={(payload) => {
                void handleCopyCodeFromContext(payload);
              }}
              onCopyFilePath={(path) => {
                void handleCopyFilePath(path);
              }}
              onStartCommentFromContext={handleStartCommentFromContext}
              onOpenFile={openFileHandler}
            />
            <SearchBox
              targetRef={scrollContainerRef}
              isVisible={isSearchVisible}
              onClose={() => setIsSearchVisible(false)}
            />
          </div>
        </div>
      </ResizableModal>
    );
  }

  const sessionTitle = selectedFile ? (
    <div className="flex items-center gap-4">
      <span>Git Diff Viewer</span>
      <div className="text-sm text-slate-400 font-mono">{selectedFile}</div>
    </div>
  ) : (
    "Git Diff Viewer"
  );

  return (
    <DiffSessionActions
      isSessionSelection={selection.kind === "session"}
      sessionName={sessionName}
      targetSession={targetSession}
      canMarkReviewed={canMarkReviewed}
      onClose={onClose}
      onReloadSessions={reloadSessions}
      onLoadChangedFiles={loadChangedFiles}
    >
      {({ headerActions, dialogs }) =>
        isSidebarMode ? (
          <div className="flex flex-col h-full w-full min-h-0 relative">
            <div className="flex items-center justify-between px-2 py-1 border-b border-slate-800 bg-slate-950 shrink-0">
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                {sessionActions({ headerActions })}
              </div>
            </div>
            <div className="flex-1 overflow-hidden min-h-0 w-full relative">
              {diffContent}
            </div>
            {dialogs}
          </div>
        ) : (
          <ResizableModal
            isOpen={isOpen}
            onClose={onClose}
            title={sessionTitle}
            storageKey="diff-session"
            defaultWidth={Math.floor(window.innerWidth * 0.95)}
            defaultHeight={Math.floor(window.innerHeight * 0.9)}
            minWidth={800}
            minHeight={600}
            className="diff-modal-session"
          >
            <div
              className="absolute top-3 right-14 flex items-center gap-2 z-10"
              data-testid="diff-modal"
              data-selected-file={selectedFile || ""}
            >
              {sessionActions({ headerActions })}
            </div>
            <div className="flex h-full overflow-hidden">
              <div
                className="flex flex-col h-full"
                data-testid="diff-sidebar"
                style={{
                  width: `${sidebarWidth}px`,
                  minWidth: "200px",
                  maxWidth: "600px",
                }}
              >
                <DiffFileExplorer
                  files={files}
                  selectedFile={selectedFile}
                  visibleFilePath={visibleFilePath}
                  onFileSelect={(path, index) => {
                    void scrollToFile(path, index);
                  }}
                  getCommentsForFile={getCommentsForFile}
                  currentReview={currentReview}
                  onFinishReview={() => {
                    void handleFinishReview();
                  }}
                  onCancelReview={clearReview}
                  removeComment={removeComment}
                  getConfirmationMessage={getConfirmationMessage}
                />
              </div>
              <div
                data-testid="diff-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize file list"
                onMouseDown={beginSidebarResize}
                className="flex items-center justify-center"
                style={{
                  width: "6px",
                  cursor: "col-resize",
                  backgroundColor: isResizingSidebar
                    ? theme.colors.accent.blue.DEFAULT
                    : theme.colors.border.subtle,
                }}
              >
                <div
                  style={{
                    width: "2px",
                    height: "40px",
                    borderRadius: "9999px",
                    backgroundColor: theme.colors.border.strong,
                    opacity: 0.6,
                  }}
                />
              </div>

              {diffContent}
            </div>
            {dialogs}
          </ResizableModal>
        )
      }
    </DiffSessionActions>
  );
}

export function shouldBypassHighlighting(
  fileDiff: FileDiffData | undefined,
  cap: number,
): boolean {
  if (!fileDiff) return false;
  const { changedLinesCount } = fileDiff;
  return typeof changedLinesCount === "number" && changedLinesCount > cap;
}

interface HighlightBlockDescriptor {
  cacheKey: string;
  lines: string[];
}

interface HighlightLocation {
  cacheKey: string;
  index: number;
}

interface FileHighlightPlan {
  blocks: HighlightBlockDescriptor[];
  lineMap: Map<string, HighlightLocation>;
  language: string | null;
  bypass: boolean;
}

interface LineDescriptor {
  key: string;
  content: string;
}

function collectLineDescriptors(
  filePath: string,
  diff: FileDiffData,
): LineDescriptor[] {
  if (!("diffResult" in diff)) {
    return [];
  }

  const descriptors: LineDescriptor[] = [];

  diff.diffResult.forEach((line, index) => {
    const baseKey = `${filePath}-${index}`;

    if (line.isCollapsible) {
      line.collapsedLines?.forEach((collapsedLine, collapsedIndex) => {
        if (collapsedLine.content !== undefined) {
          descriptors.push({
            key: `${baseKey}-expanded-${collapsedIndex}`,
            content: collapsedLine.content,
          });
        }
      });
      return;
    }

    if (line.content !== undefined) {
      descriptors.push({ key: baseKey, content: line.content });
    }
  });

  return descriptors;
}

function CommentForm({
  onSubmit,
  onCancel,
  keyboardShortcutConfig,
  platform,
}: {
  onSubmit: (text: string) => void;
  onCancel: () => void;
  keyboardShortcutConfig: KeyboardShortcutConfig;
  platform: Platform;
}) {
  const [text, setText] = useState("");

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim());
      setText("");
    }
  };

  return (
    <>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write your comment..."
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm focus:outline-none focus:border-cyan-400 resize-none"
        rows={4}
        autoFocus
        onKeyDown={(e) => {
          const nativeEvent = e.nativeEvent as KeyboardEvent;
          if (
            isShortcutForAction(
              nativeEvent,
              KeyboardShortcutAction.SubmitDiffComment,
              keyboardShortcutConfig,
              { platform },
            )
          ) {
            handleSubmit();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded text-sm font-medium flex items-center gap-2"
        >
          <VscSend />
          Submit
        </button>
      </div>
    </>
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) {
    return true;
  }
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

export function computeHistorySeedWindow(
  files: ChangedFile[],
  centerIndex: number,
  radius = 2,
): Set<string> {
  if (files.length === 0) {
    return new Set();
  }
  const clampedCenter = Math.min(Math.max(centerIndex, 0), files.length - 1);
  const start = Math.max(0, clampedCenter - Math.max(radius, 0));
  const end = Math.min(files.length - 1, clampedCenter + Math.max(radius, 0));
  const seeded = new Set<string>();
  for (let index = start; index <= end; index += 1) {
    seeded.add(files[index].path);
  }
  return seeded;
}

export function computeLargeDiffVisibleSet(
  files: ChangedFile[],
  selectedFile: string | null,
  includeNeighbors = false,
): Set<string> {
  const result = new Set<string>();
  if (!selectedFile) {
    return result;
  }
  result.add(selectedFile);
  if (!includeNeighbors) {
    return result;
  }
  const index = files.findIndex((file) => file.path === selectedFile);
  if (index > 0) {
    result.add(files[index - 1].path);
  }
  if (index >= 0 && index < files.length - 1) {
    result.add(files[index + 1].path);
  }
  return result;
}

function buildHistoryPrefetchQueue(
  files: ChangedFile[],
  centerIndex: number,
  seeded: Set<string>,
): string[] {
  if (files.length === 0) {
    return [];
  }
  const queue: string[] = [];
  const visited = new Set<number>();
  const enqueue = (index: number) => {
    if (index < 0 || index >= files.length) return;
    if (visited.has(index)) return;
    visited.add(index);
    const path = files[index].path;
    if (!seeded.has(path)) {
      queue.push(path);
    }
  };

  enqueue(centerIndex);

  let offset = 1;
  while (visited.size < files.length) {
    const left = centerIndex - offset;
    const right = centerIndex + offset;
    enqueue(left);
    enqueue(right);
    if (left < 0 && right >= files.length) {
      break;
    }
    offset += 1;
  }

  for (let index = 0; index < files.length; index += 1) {
    if (!visited.has(index)) {
      enqueue(index);
    }
  }

  return queue;
}
