import { useState, useEffect, useCallback, useRef, RefObject } from "react";

export interface KeyboardFocusState {
  filePath: string;
  lineNum: number;
  side: "old" | "new";
}

interface SmoothScrollState {
  raf: number | null;
  direction: 1 | -1;
  velocity: number;
  lastTs: number | null;
}

interface UseDiffKeyboardNavigationOptions {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  selectedFileRef: RefObject<string | null>;
  filePathToIndexRef: RefObject<Map<string, number>>;
  userScrollingRef: RefObject<boolean>;
  onFocusChange: (focus: KeyboardFocusState) => void;
  onFileChange?: (filePath: string, index: number) => void;
}

interface UseDiffKeyboardNavigationResult {
  keyboardFocus: KeyboardFocusState | null;
  keyboardFocusRef: RefObject<KeyboardFocusState | null>;
  setKeyboardFocus: React.Dispatch<
    React.SetStateAction<KeyboardFocusState | null>
  >;
  moveKeyboardFocus: (direction: 1 | -1) => void;
  scheduleHoldScroll: (direction: 1 | -1) => void;
  stopSmoothScroll: () => void;
  isSmoothScrolling: () => boolean;
}

const SCROLL_ACCEL = 1200;
const SCROLL_MAX_VELOCITY = 1400;
const FOCUS_UPDATE_INTERVAL_MS = 80;
const HOLD_DELAY_MS = 250;

export function useDiffKeyboardNavigation({
  scrollContainerRef,
  selectedFileRef,
  filePathToIndexRef,
  userScrollingRef,
  onFocusChange,
  onFileChange,
}: UseDiffKeyboardNavigationOptions): UseDiffKeyboardNavigationResult {
  const [keyboardFocus, setKeyboardFocus] =
    useState<KeyboardFocusState | null>(null);
  const keyboardFocusRef = useRef<KeyboardFocusState | null>(null);
  const smoothScrollRef = useRef<SmoothScrollState | null>(null);
  const holdScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    keyboardFocusRef.current = keyboardFocus;
  }, [keyboardFocus]);

  const getOrderedLineElements = useCallback((): HTMLElement[] => {
    const container = scrollContainerRef.current;
    if (!container) return [];
    return Array.from(
      container.querySelectorAll("tr[data-line-num][data-side]")
    ) as HTMLElement[];
  }, [scrollContainerRef]);

  const applyKeyboardFocusFromElement = useCallback(
    (element: HTMLElement, skipScrollAdjust = false) => {
      const lineNumAttr = element.getAttribute("data-line-num");
      const sideAttr = element.getAttribute("data-side") as
        | "old"
        | "new"
        | null;
      const lineNum = lineNumAttr ? Number(lineNumAttr) : NaN;
      const filePath =
        element.closest("[data-file-path]")?.getAttribute("data-file-path") ??
        selectedFileRef.current;

      if (!filePath || !sideAttr || Number.isNaN(lineNum)) return;

      const newFocus = { filePath, lineNum, side: sideAttr };
      setKeyboardFocus(newFocus);
      onFocusChange(newFocus);

      if (selectedFileRef.current !== filePath && onFileChange) {
        const idx = filePathToIndexRef.current.get(filePath);
        if (idx !== undefined) {
          onFileChange(filePath, idx);
        }
      }

      const isSmoothScrolling = smoothScrollRef.current !== null;
      if (!isSmoothScrolling && !skipScrollAdjust) {
        const container = scrollContainerRef.current;
        if (container) {
          const rowRect = element.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const padding = 24;
          if (rowRect.top < containerRect.top + padding) {
            container.scrollTop -= containerRect.top + padding - rowRect.top;
          } else if (rowRect.bottom > containerRect.bottom - padding) {
            container.scrollTop +=
              rowRect.bottom - (containerRect.bottom - padding);
          }
        }
      }
    },
    [
      scrollContainerRef,
      selectedFileRef,
      filePathToIndexRef,
      onFocusChange,
      onFileChange,
    ]
  );

  const moveKeyboardFocus = useCallback(
    (direction: 1 | -1) => {
      const rows = getOrderedLineElements();
      if (rows.length === 0) return;

      const current = keyboardFocusRef.current;
      const findMatchIndex = () => {
        if (!current) return -1;
        return rows.findIndex((row) => {
          const rowLine = Number(row.getAttribute("data-line-num"));
          const rowSide = row.getAttribute("data-side");
          const rowFile =
            row.closest("[data-file-path]")?.getAttribute("data-file-path") ??
            null;
          return (
            rowFile === current.filePath &&
            rowLine === current.lineNum &&
            rowSide === current.side
          );
        });
      };

      const currentIndex = findMatchIndex();
      let nextIndex = currentIndex;
      if (currentIndex === -1) {
        nextIndex = direction === 1 ? 0 : rows.length - 1;
      } else {
        nextIndex = Math.min(
          rows.length - 1,
          Math.max(0, currentIndex + direction)
        );
      }

      const target = rows[nextIndex];
      applyKeyboardFocusFromElement(target);
    },
    [applyKeyboardFocusFromElement, getOrderedLineElements]
  );

  const snapKeyboardFocusToCenter = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const rows = getOrderedLineElements();
    if (rows.length === 0) return;
    const containerRect = container.getBoundingClientRect();
    const targetY = containerRect.top + container.clientHeight / 2;
    let bestEl: HTMLElement | null = null;
    let bestDist = Infinity;
    rows.forEach((row) => {
      const rect = row.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const dist = Math.abs(centerY - targetY);
      if (dist < bestDist) {
        bestEl = row;
        bestDist = dist;
      }
    });
    if (bestEl) {
      applyKeyboardFocusFromElement(bestEl, true);
    }
  }, [
    scrollContainerRef,
    applyKeyboardFocusFromElement,
    getOrderedLineElements,
  ]);

  const stopSmoothScroll = useCallback(() => {
    if (holdScrollTimeoutRef.current) {
      clearTimeout(holdScrollTimeoutRef.current);
      holdScrollTimeoutRef.current = null;
    }
    const loop = smoothScrollRef.current;
    if (loop && loop.raf !== null) {
      cancelAnimationFrame(loop.raf);
    }
    smoothScrollRef.current = null;
    userScrollingRef.current = false;
  }, [userScrollingRef]);

  const startSmoothScroll = useCallback(
    (direction: 1 | -1) => {
      const existing = smoothScrollRef.current;
      if (existing && existing.direction === direction) {
        return;
      }
      stopSmoothScroll();
      userScrollingRef.current = true;
      let lastFocusUpdate = 0;
      const step = (ts: number) => {
        const container = scrollContainerRef.current;
        if (!container) {
          stopSmoothScroll();
          return;
        }
        const state = smoothScrollRef.current;
        const lastTs = state?.lastTs ?? ts;
        const dt = Math.max(0, ts - lastTs) / 1000;
        const prevV = state?.velocity ?? 0;
        const nextV = Math.min(SCROLL_MAX_VELOCITY, prevV + SCROLL_ACCEL * dt);
        const delta = nextV * dt;
        container.scrollTop += direction * delta;
        if (ts - lastFocusUpdate > FOCUS_UPDATE_INTERVAL_MS) {
          lastFocusUpdate = ts;
          snapKeyboardFocusToCenter();
        }
        smoothScrollRef.current = {
          raf: requestAnimationFrame(step),
          direction,
          velocity: nextV,
          lastTs: ts,
        };
      };
      smoothScrollRef.current = {
        raf: requestAnimationFrame(step),
        direction,
        velocity: 0,
        lastTs: null,
      };
    },
    [
      scrollContainerRef,
      userScrollingRef,
      snapKeyboardFocusToCenter,
      stopSmoothScroll,
    ]
  );

  const scheduleHoldScroll = useCallback(
    (direction: 1 | -1) => {
      if (holdScrollTimeoutRef.current) {
        clearTimeout(holdScrollTimeoutRef.current);
      }
      holdScrollTimeoutRef.current = setTimeout(() => {
        holdScrollTimeoutRef.current = null;
        startSmoothScroll(direction);
      }, HOLD_DELAY_MS);
    },
    [startSmoothScroll]
  );

  const isSmoothScrolling = useCallback(() => {
    return smoothScrollRef.current !== null;
  }, []);

  return {
    keyboardFocus,
    keyboardFocusRef,
    setKeyboardFocus,
    moveKeyboardFocus,
    scheduleHoldScroll,
    stopSmoothScroll,
    isSmoothScrolling,
  };
}
