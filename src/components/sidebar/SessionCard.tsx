import { memo, useCallback } from "react";
import { clsx } from "clsx";
import { SessionActions } from "../session/SessionActions";
import { SessionInfo, SessionMonitorStatus } from "../../types/session";
import { UncommittedIndicator } from "../common/UncommittedIndicator";
import { ProgressIndicator } from "../common/ProgressIndicator";
import { InlineEditableText } from "../common/InlineEditableText";
import { theme, getAgentColorScheme } from "../../common/theme";
import { typography } from "../../common/typography";
import type { MergeStatus } from "../../store/atoms/sessions";
import { getSessionDisplayName } from "../../utils/sessionDisplayName";
import { mapSessionUiState } from "../../utils/sessionFilters";
import { useMultipleShortcutDisplays } from "../../keyboardShortcuts/useShortcutDisplay";
import { KeyboardShortcutAction } from "../../keyboardShortcuts/config";
import { detectPlatformSafe } from "../../keyboardShortcuts/helpers";
import { useEpics } from "../../hooks/useEpics";

interface SessionCardProps {
  session: {
    info: SessionInfo;
    status?: SessionMonitorStatus;
    terminals: string[];
  };
  index: number;
  isSelected: boolean;

  hasFollowUpMessage: boolean;
  isWithinVersionGroup?: boolean;
  showPromoteIcon?: boolean;
  willBeDeleted?: boolean;
  isPromotionPreview?: boolean;
  onSelect: (sessionId: string) => void;
  onMarkReady: (sessionId: string) => void;
  onUnmarkReady: (sessionId: string) => void;
  onCancel: (sessionId: string, hasUncommitted: boolean) => void;
  onConvertToSpec?: (sessionId: string) => void;
  onRunDraft?: (sessionId: string) => void;
  onRefineSpec?: (sessionId: string) => void;
  onDeleteSpec?: (sessionId: string) => void;
  onPromoteVersion?: () => void;
  onPromoteVersionHover?: () => void;
  onPromoteVersionHoverEnd?: () => void;
  onReset?: (sessionId: string) => void;
  onSwitchModel?: (sessionId: string) => void;
  onCreatePullRequest?: (sessionId: string) => void;
  isResetting?: boolean;
  isRunning?: boolean;
  onMerge?: (sessionId: string) => void;
  onQuickMerge?: (sessionId: string) => void;
  disableMerge?: boolean;
  mergeStatus?: MergeStatus;
  isMarkReadyDisabled?: boolean;
  isBusy?: boolean;
  onRename?: (sessionId: string, newName: string) => Promise<void>;
  onLinkPr?: (sessionId: string, prNumber: number, prUrl: string) => void;
}

function getSessionStateColor(state?: string): "green" | "violet" | "gray" {
  switch (state) {
    case "active":
      return "green";
    case "review":
    case "ready":
      return "violet";
    case "stale":
    default:
      return "gray";
  }
}

type SessionCardSurfaceOptions = {
  sessionState: SessionInfo['session_state']
  isSelected: boolean
  isReviewedState: boolean
  isRunning: boolean
  hasFollowUpMessage?: boolean
  willBeDeleted?: boolean
  isPromotionPreview?: boolean
}

export function getSessionCardSurfaceClasses({
  sessionState,
  isSelected,
  isReviewedState,
  isRunning,
  hasFollowUpMessage,
  willBeDeleted,
  isPromotionPreview,
}: SessionCardSurfaceOptions) {
  const baseTone = (() => {
    if (willBeDeleted) {
      return "border-danger bg-danger-bg opacity-30 transition-all duration-200";
    }
    if (isPromotionPreview) {
      return "session-ring session-ring-green border-transparent shadow-lg shadow-success/20";
    }
    if (isSelected) return "session-ring session-ring-blue border-transparent";
    if (isReviewedState) return "session-ring session-ring-green border-transparent opacity-90";
    if (sessionState === "running") return "border-subtle bg-elevated/50 hover:bg-elevated/60";
    if (sessionState === "spec") return "border-muted bg-secondary/30 hover:bg-elevated/30 opacity-85";
    return "border-muted bg-secondary/40 hover:bg-elevated/30";
  })();

  return clsx(
    baseTone,
    hasFollowUpMessage && !isSelected &&
      "ring-2 ring-info/50 shadow-lg shadow-info/20 bg-info-bg",
    isRunning && !isSelected &&
      "ring-2 ring-warning/50 shadow-lg shadow-warning/20 bg-warning-bg"
  );
}

export const getAgentColorKey = (
  agent: string,
): "blue" | "green" | "orange" | "violet" | "red" | "yellow" => {
  switch (agent) {
    case "claude":
      return "blue";
    case "opencode":
      return "green";
    case "gemini":
      return "orange";
    case "droid":
      return "violet";
    case "codex":
      return "red";
    case "amp":
      return "yellow";
    case "kilocode":
      return "yellow";
    default:
      return "red";
  }
};

const sessionText = {
  title: {
    ...typography.heading,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
  },
  badge: {
    ...typography.caption,
    fontWeight: 600,
    lineHeight: theme.lineHeight.compact,
  },
  meta: {
    ...typography.caption,
    color: 'var(--color-text-tertiary)',
  },
  metaEmphasis: {
    ...typography.caption,
    color: 'var(--color-text-secondary)',
  },
  agent: {
    ...typography.body,
    color: 'var(--color-text-secondary)',
  },
  agentMuted: {
    ...typography.caption,
    color: 'var(--color-text-secondary)',
  },
  statsLabel: {
    ...typography.caption,
    color: 'var(--color-text-tertiary)',
  },
  statsNumber: {
    ...typography.caption,
    fontWeight: 600,
  },
};

export const SessionCard = memo<SessionCardProps>(
  ({
    session,
    index,
    isSelected,

    hasFollowUpMessage,
    isWithinVersionGroup = false,
    showPromoteIcon = false,
    willBeDeleted = false,
    isPromotionPreview = false,
    onSelect,
    onMarkReady,
    onUnmarkReady,
    onCancel,
    onConvertToSpec,
    onRunDraft,
    onRefineSpec,
    onDeleteSpec,
    onPromoteVersion,
    onPromoteVersionHover,
    onPromoteVersionHoverEnd,
    onReset,
    onSwitchModel,
    onCreatePullRequest,
    isResetting = false,
    isRunning = false,
    onMerge,
    onQuickMerge,
    disableMerge = false,
    mergeStatus = "idle",
    isMarkReadyDisabled = false,
    isBusy = false,
    onRename,
    onLinkPr,
  }) => {
    const { setItemEpic } = useEpics();
    const shortcuts = useMultipleShortcutDisplays([
      KeyboardShortcutAction.OpenDiffViewer,
      KeyboardShortcutAction.CancelSession,
      KeyboardShortcutAction.MarkSessionReady,
      KeyboardShortcutAction.SwitchToSession1,
      KeyboardShortcutAction.SwitchToSession2,
      KeyboardShortcutAction.SwitchToSession3,
      KeyboardShortcutAction.SwitchToSession4,
      KeyboardShortcutAction.SwitchToSession5,
      KeyboardShortcutAction.SwitchToSession6,
      KeyboardShortcutAction.SwitchToSession7,
      KeyboardShortcutAction.ForceCancelSession,
    ]);
    const platform = detectPlatformSafe();
    const modKey = platform === "mac" ? "⌘" : "Ctrl";
    const shiftModKey = platform === "mac" ? "⇧⌘" : "Ctrl+Shift";

    const getAccessibilityLabel = (isSelected: boolean, index: number) => {
      if (isSelected) {
        return `Selected session • Diff: ${shortcuts[KeyboardShortcutAction.OpenDiffViewer] || `${modKey}G`} • Cancel: ${shortcuts[KeyboardShortcutAction.CancelSession] || `${modKey}D`} (${shortcuts[KeyboardShortcutAction.ForceCancelSession] || `${shiftModKey}D`} force) • Mark Reviewed: ${shortcuts[KeyboardShortcutAction.MarkSessionReady] || `${modKey}R`}`;
      }
      if (index < 8) {
        const sessionActions = [
          KeyboardShortcutAction.SwitchToSession1,
          KeyboardShortcutAction.SwitchToSession2,
          KeyboardShortcutAction.SwitchToSession3,
          KeyboardShortcutAction.SwitchToSession4,
          KeyboardShortcutAction.SwitchToSession5,
          KeyboardShortcutAction.SwitchToSession6,
          KeyboardShortcutAction.SwitchToSession7,
        ];
        const sessionAction = sessionActions[index];
        return `Select session (${shortcuts[sessionAction] || `${modKey}${index + 2}`})`;
      }
      return "Select session";
    };
    const s = session.info;
    const color = getSessionStateColor(s.session_state);
    const sessionName = getSessionDisplayName(s);
    const taskDescription = s.current_task || s.spec_content;
    const progressPercent = s.todo_percentage || 0;
    const additions = s.diff_stats?.insertions || s.diff_stats?.additions || 0;
    const deletions = s.diff_stats?.deletions || 0;
    const isBlocked = s.is_blocked || false;
    const isReadyToMerge = s.ready_to_merge || false;
    const sessionState = mapSessionUiState(s);
    const isReviewedState = sessionState === "reviewed";
    const agentType =
      s.original_agent_type as SessionInfo["original_agent_type"];
    const agentKey = (agentType || "").toLowerCase();
    const agentLabel = agentKey;

    const agentColor = getAgentColorKey(agentKey);
    const colorScheme = getAgentColorScheme(agentColor);
    const showReviewedDirtyBadge =
      isReviewedState && !isReadyToMerge && !!s.has_uncommitted_changes;

    const handleEpicChange = useCallback(
      (nextEpicId: string | null) => {
        void setItemEpic(s.session_id, nextEpicId);
      },
      [setItemEpic, s.session_id],
    );

    // State icon removed - no longer using emojis

    return (
      <div
        role="button"
        tabIndex={isBusy ? -1 : 0}
        aria-disabled={isBusy}
        aria-busy={isBusy}
        onClick={() => {
          if (isBusy) return;
          onSelect(session.info.session_id);
        }}
        onKeyDown={(e) => {
          if (isBusy) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(session.info.session_id);
          }
        }}
        data-session-id={session.info.session_id}
        data-session-selected={isSelected ? "true" : "false"}
        className={clsx(
          "group relative w-full text-left px-3 py-2.5 rounded-md mb-2 border transition-all duration-300",
          getSessionCardSurfaceClasses({
            sessionState,
            isSelected,
            isReviewedState,
            isRunning: Boolean(isRunning),
            hasFollowUpMessage,
            willBeDeleted,
            isPromotionPreview,
          }),
          isBusy ? "cursor-progress opacity-60" : "cursor-pointer",
        )}
        aria-label={getAccessibilityLabel(isSelected, index)}
      >
        {isBusy && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-md pointer-events-none"
            data-testid="session-busy-indicator"
            style={{
              backgroundColor: 'var(--color-bg-primary)',
              opacity: 0.72,
            }}
          >
            <span
              className="h-4 w-4 border-2 border-solid rounded-full animate-spin"
              style={{
                borderColor: 'var(--color-accent-blue-border)',
                borderTopColor: "transparent",
              }}
            />
          </div>
        )}
        <div
          className="flex items-start justify-between gap-2"
          style={{ marginBottom: "8px" }}
        >
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <div className="truncate flex items-center gap-2" style={sessionText.title}>
              {onRename ? (
                <InlineEditableText
                  value={sessionName}
                  onSave={(newName) => onRename(s.session_id, newName)}
                  textStyle={sessionText.title}
                  disabled={isBusy}
                />
              ) : (
                sessionName
              )}
            </div>
            {sessionState !== "spec" && (
              <div className="flex-shrink-0 flex items-center">
                {!s.attention_required &&
                  sessionState === "running" &&
                  !isReadyToMerge && <ProgressIndicator size="sm" />}
                {s.attention_required && (
                  <span
                    className="idle-indicator"
                    style={{
                      fontSize: theme.fontSize.caption,
                      lineHeight: theme.lineHeight.compact,
                      fontFamily: theme.fontFamily.sans,
                      fontWeight: 600,
                      color: 'var(--color-accent-yellow-light)',
                    }}
                  >
                    ⏸︎ Idle
                  </span>
                )}
                {isRunning && isReviewedState && (
                  <span
                    className="px-1.5 py-0.5 rounded border"
                    style={{
                      ...sessionText.badge,
                      backgroundColor: 'var(--color-accent-magenta-bg)',
                      color: 'var(--color-accent-magenta)',
                      borderColor: 'var(--color-accent-magenta-border)',
                    }}
                  >
                    Running
                  </span>
                )}
              </div>
            )}
            {isReviewedState && (
              <span
                className="flex-shrink-0"
                style={{
                  ...sessionText.badge,
                  color: 'var(--color-accent-green-light)',
                }}
              >
                ✓ Reviewed
              </span>
            )}
            {isBlocked && (
              <span
                className="flex-shrink-0"
                style={{
                  ...sessionText.badge,
                  color: 'var(--color-accent-red-light)',
                }}
              >
                ⚠ blocked
              </span>
            )}

            {showReviewedDirtyBadge && (
              <UncommittedIndicator
                className="flex-shrink-0"
                sessionName={sessionName}
                samplePaths={s.top_uncommitted_paths}
              />
            )}

            {hasFollowUpMessage && !isReadyToMerge && (
              <span
                className="flex-shrink-0 inline-flex items-center gap-1"
                title="New follow-up message received"
              >
                <span className="flex h-4 w-4 relative">
                  <span
                    className="absolute inline-flex h-full w-full rounded-full opacity-75"
                    style={{
                      backgroundColor: 'var(--color-accent-blue-light)',
                    }}
                  ></span>
                  <span
                    className="relative inline-flex rounded-full h-4 w-4 text-white items-center justify-center font-bold"
                    style={{
                      ...sessionText.badge,
                      fontSize: theme.fontSize.caption,
                      backgroundColor: 'var(--color-accent-blue)',
                    }}
                  >
                    !
                  </span>
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {index < 8 && (
              <span
                className="px-1.5 py-0.5 rounded bg-elevated/50"
                style={sessionText.meta}
              >
                {(() => {
                  const sessionActions = [
                    KeyboardShortcutAction.SwitchToSession1,
                    KeyboardShortcutAction.SwitchToSession2,
                    KeyboardShortcutAction.SwitchToSession3,
                    KeyboardShortcutAction.SwitchToSession4,
                    KeyboardShortcutAction.SwitchToSession5,
                    KeyboardShortcutAction.SwitchToSession6,
                    KeyboardShortcutAction.SwitchToSession7,
                  ];
                  const sessionAction = sessionActions[index];
                  return shortcuts[sessionAction] || `${modKey}${index + 2}`;
                })()}
              </span>
            )}
          </div>
        </div>
        {taskDescription && (
          <div
            className="truncate"
            style={{
              ...sessionText.agent,
              color: 'var(--color-text-primary)',
            }}
            title={taskDescription}
          >
            {taskDescription}
          </div>
        )}
        <div
          className="mt-1 flex items-center gap-2"
          style={sessionText.meta}
        >
          {sessionState === "spec" ? (
            <span
              className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-[1px] rounded border"
              style={{
                ...sessionText.badge,
                backgroundColor: 'var(--color-accent-amber-bg)',
                color: 'var(--color-accent-amber-light)',
                borderColor: 'var(--color-accent-amber-border)',
              }}
            >
              Spec
            </span>
          ) : (
            <>
              {agentType && !isWithinVersionGroup && (
                <span
                  className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-[1px] rounded border"
                  style={{
                    ...sessionText.badge,
                    backgroundColor: colorScheme.bg,
                    color: colorScheme.light,
                    borderColor: colorScheme.border,
                  }}
                  title={`Agent: ${agentLabel}`}
                >
                  <span
                    className="w-1 h-1 rounded-full"
                    style={{
                      backgroundColor: colorScheme.DEFAULT,
                    }}
                  />
                  {agentLabel}
                </span>
              )}
              <span className="text-success">+{additions}</span>
              <span className="text-danger">-{deletions}</span>
              <span className="truncate max-w-[120px]" title={s.branch}>
                {s.branch}
              </span>
            </>
          )}
        </div>
        {progressPercent > 0 && (
          <>
            <div className="mt-3 h-2 bg-elevated rounded">
              <div
                className={clsx(
                  "h-2 rounded",
                  color === "green" && "bg-success",
                  color === "violet" && "bg-info",
                  color === "gray" && "bg-muted",
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-1" style={sessionText.meta}>
              {progressPercent}% complete
            </div>
          </>
        )}
        <div className="mt-2 flex items-center justify-between">
          <SessionActions
            sessionState={sessionState as "spec" | "running" | "reviewed"}
            isReadyToMerge={isReadyToMerge}
            sessionId={s.session_id}
            sessionSlug={s.session_id}
            worktreePath={s.worktree_path}
            branch={s.branch}
            defaultBranch={s.parent_branch ?? undefined}
            showPromoteIcon={showPromoteIcon}
            onCreatePullRequest={onCreatePullRequest}
            prNumber={s.pr_number}
            prUrl={s.pr_url}
            onRunSpec={onRunDraft}
            onRefineSpec={onRefineSpec}
            onDeleteSpec={onDeleteSpec}
            onMarkReviewed={onMarkReady}
            onUnmarkReviewed={onUnmarkReady}
            onCancel={onCancel}
            onConvertToSpec={onConvertToSpec}
            onPromoteVersion={onPromoteVersion}
            onPromoteVersionHover={onPromoteVersionHover}
            onPromoteVersionHoverEnd={onPromoteVersionHoverEnd}
            onReset={onReset}
            onSwitchModel={onSwitchModel}
            isResetting={isResetting}
            onMerge={onMerge}
            onQuickMerge={onQuickMerge}
            disableMerge={disableMerge}
            mergeStatus={mergeStatus}
            mergeConflictingPaths={s.merge_conflicting_paths}
            isMarkReadyDisabled={isMarkReadyDisabled}
            onLinkPr={onLinkPr}
            epic={s.epic}
            onEpicChange={handleEpicChange}
            epicDisabled={isBusy}
          />
        </div>
      </div>
    );
});
