import {
  VscPlay,
  VscTrash,
  VscCheck,
  VscClose,
  VscDiscard,
  VscArchive,
  VscStarFull,
  VscRefresh,
  VscCode,
  VscGitMerge,
  VscWarning
} from 'react-icons/vsc';
import { IconButton } from '../common/IconButton';
import { theme } from '../../common/theme';
import type { MergeStatus } from '../../contexts/SessionsContext';

interface SessionActionsProps {
  sessionState: 'spec' | 'running' | 'reviewed';
  sessionId: string;
  hasUncommittedChanges?: boolean;
  branch?: string;
  showPromoteIcon?: boolean;
  onRunSpec?: (sessionId: string) => void;
  onDeleteSpec?: (sessionId: string) => void;
  onMarkReviewed?: (sessionId: string, hasUncommitted: boolean) => void;
  onUnmarkReviewed?: (sessionId: string) => void;
  onCancel?: (sessionId: string, hasUncommitted: boolean) => void;
  onConvertToSpec?: (sessionId: string) => void;
  onPromoteVersion?: () => void;
  onPromoteVersionHover?: () => void;
  onPromoteVersionHoverEnd?: () => void;
  onReset?: (sessionId: string) => void;
  onSwitchModel?: (sessionId: string) => void;
  isResetting?: boolean;
  onMerge?: (sessionId: string) => void;
  disableMerge?: boolean;
  mergeStatus?: MergeStatus;
  isMarkReadyDisabled?: boolean;
  mergeConflictingPaths?: string[];
}

export function SessionActions({
  sessionState,
  sessionId,
  hasUncommittedChanges = false,
  showPromoteIcon = false,
  onRunSpec,
  onDeleteSpec,
  onMarkReviewed,
  onUnmarkReviewed,
  onCancel,
  onConvertToSpec,
  onPromoteVersion,
  onPromoteVersionHover,
  onPromoteVersionHoverEnd,
  onReset,
  onSwitchModel,
  onMerge,
  isResetting = false,
  disableMerge = false,
  mergeStatus = 'idle',
  isMarkReadyDisabled = false,
  mergeConflictingPaths,
}: SessionActionsProps) {
  // Use moderate spacing for medium-sized buttons
  const spacing = sessionState === 'spec' ? 'gap-1' : 'gap-0.5';
  const conflictCount = mergeConflictingPaths?.length ?? 0;
  const conflictLabel = conflictCount > 0 ? `Resolve conflicts (${conflictCount})` : 'Resolve conflicts';
  const conflictTooltip = conflictCount > 0
    ? `Resolve conflicts (⌘⇧M)${mergeConflictingPaths?.length ? ` • ${mergeConflictingPaths.slice(0, 3).join(', ')}${mergeConflictingPaths.length > 3 ? '…' : ''}` : ''}`
    : 'Resolve conflicts (⌘⇧M)';
  return (
    <div className={`flex items-center ${spacing}`}>
      {/* Spec state actions */}
      {sessionState === 'spec' && (
        <>
          {onRunSpec && (
            <IconButton
              icon={<VscPlay />}
              onClick={() => onRunSpec(sessionId)}
              ariaLabel="Run spec"
              tooltip="Run spec"
              variant="success"
            />
          )}
          {onDeleteSpec && (
            <IconButton
              icon={<VscTrash />}
              onClick={() => onDeleteSpec(sessionId)}
              ariaLabel="Delete spec"
              tooltip="Delete spec"
              variant="danger"
            />
          )}
        </>
      )}

      {/* Running state actions */}
      {sessionState === 'running' && (
        <>
          {showPromoteIcon && onPromoteVersion && (
            <div
              onMouseEnter={onPromoteVersionHover}
              onMouseLeave={onPromoteVersionHoverEnd}
              className="inline-block"
            >
              <IconButton
                icon={<VscStarFull />}
                onClick={onPromoteVersion}
                ariaLabel="Promote as best version"
                tooltip="Promote as best version and delete others (⌘B)"
                variant="warning"
              />
            </div>
          )}
          {onSwitchModel && (
            <IconButton
              icon={<VscCode />}
              onClick={() => onSwitchModel(sessionId)}
              ariaLabel="Switch model"
              tooltip="Switch model (⌘P)"
            />
          )}
          {onReset && (
            <IconButton
              icon={<VscRefresh />}
              onClick={() => onReset(sessionId)}
              ariaLabel="Reset session"
              tooltip="Reset session (⌘Y)"
              disabled={isResetting}
            />
          )}
          {onMarkReviewed && (
            <IconButton
              icon={<VscCheck />}
              onClick={() => onMarkReviewed(sessionId, hasUncommittedChanges)}
              ariaLabel="Mark as reviewed"
              tooltip="Mark as reviewed (⌘R)"
              variant="success"
              disabled={isMarkReadyDisabled}
            />
          )}
          {onConvertToSpec && (
            <IconButton
              icon={<VscArchive />}
              onClick={() => onConvertToSpec(sessionId)}
              ariaLabel="Move to spec"
              tooltip="Move to spec (⌘S)"
            />
          )}
          {onCancel && (
            <IconButton
              icon={<VscClose />}
              onClick={() => onCancel(sessionId, hasUncommittedChanges)}
              ariaLabel="Cancel session"
              tooltip="Cancel session (⌘D)"
              variant="danger"
            />
          )}
        </>
      )}

      {/* Reviewed state actions */}
      {sessionState === 'reviewed' && (
        <>
          {onMerge && (
            mergeStatus === 'merged' ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border"
                style={{
                  backgroundColor: theme.colors.accent.green.bg,
                  borderColor: theme.colors.accent.green.border,
                  color: theme.colors.accent.green.light,
                }}
                title="Session already merged"
              >
                <VscCheck />
                Merged
              </span>
            ) : mergeStatus === 'conflict' ? (
              <button
                type="button"
                onClick={() => onMerge(sessionId)}
                disabled={disableMerge}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border"
                style={{
                  backgroundColor: theme.colors.accent.red.bg,
                  borderColor: theme.colors.accent.red.border,
                  color: theme.colors.accent.red.light,
                  cursor: disableMerge ? 'not-allowed' : 'pointer',
                  opacity: disableMerge ? 0.6 : 1,
                }}
                title={conflictTooltip}
                aria-label="Resolve merge conflicts"
              >
                <VscWarning />
                {conflictLabel}
              </button>
            ) : (
              <IconButton
                icon={<VscGitMerge />}
                onClick={() => onMerge(sessionId)}
                ariaLabel="Merge session"
                tooltip="Merge session (⌘⇧M)"
                disabled={disableMerge}
              />
            )
          )}
          {onUnmarkReviewed && (
            <IconButton
              icon={<VscDiscard />}
              onClick={() => onUnmarkReviewed(sessionId)}
              ariaLabel="Unmark as reviewed"
              tooltip="Unmark as reviewed (⌘R)"
              disabled={isMarkReadyDisabled}
            />
          )}
          {onCancel && (
            <IconButton
              icon={<VscClose />}
              onClick={() => onCancel(sessionId, hasUncommittedChanges)}
              ariaLabel="Cancel session"
              tooltip="Cancel session"
              variant="danger"
            />
          )}
        </>
      )}
    </div>
  );
}
