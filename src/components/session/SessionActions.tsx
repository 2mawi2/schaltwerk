import { useCallback, useEffect } from 'react'
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
import { FaGithub } from 'react-icons/fa'
import { IconButton } from '../common/IconButton';
import { theme } from '../../common/theme';
import type { MergeStatus } from '../../contexts/SessionsContext';
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useToast } from '../../common/toast/ToastProvider'
import { UiEvent, listenUiEvent } from '../../common/uiEvents'

const spinnerIcon = (
  <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
)

interface SessionActionsProps {
  sessionState: 'spec' | 'running' | 'reviewed';
  isReadyToMerge?: boolean;
  sessionId: string;
  hasUncommittedChanges?: boolean;
  branch?: string;
  sessionSlug?: string;
  worktreePath?: string;
  defaultBranch?: string;
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
  isReadyToMerge = false,
  sessionId,
  hasUncommittedChanges = false,
  sessionSlug,
  worktreePath,
  defaultBranch,
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
  const github = useGithubIntegrationContext()
  const { pushToast } = useToast()
  // Use moderate spacing for medium-sized buttons
  const spacing = sessionState === 'spec' ? 'gap-1' : 'gap-0.5';
  const conflictCount = mergeConflictingPaths?.length ?? 0;
  const conflictLabel = conflictCount > 0 ? `Resolve conflicts (${conflictCount})` : 'Resolve conflicts';
  const conflictTooltip = conflictCount > 0
    ? `Resolve conflicts (⌘⇧M)${mergeConflictingPaths?.length ? ` • ${mergeConflictingPaths.slice(0, 3).join(', ')}${mergeConflictingPaths.length > 3 ? '…' : ''}` : ''}`
    : 'Resolve conflicts (⌘⇧M)';

  const canCreatePr = github.canCreatePr && Boolean(worktreePath);
  const creatingPr = github.isCreatingPr(sessionId);
  const cachedUrl = github.getCachedPrUrl(sessionId);
  const prTooltip = canCreatePr
    ? cachedUrl
      ? `Push changes and update PR (${cachedUrl})`
      : 'Create GitHub pull request'
    : github.isGhMissing
      ? 'Install the GitHub CLI to enable PR automation'
      : github.hasRepository
        ? 'Sign in with GitHub to enable PR automation'
        : 'Connect this project to a GitHub repository first';

  const handleCreateGithubPr = useCallback(async () => {
    if (!worktreePath) {
      pushToast({ tone: 'error', title: 'Unable to open pull request', description: 'Session worktree path is unavailable.' })
      return
    }

    try {
      const result = await github.createReviewedPr({
        sessionId,
        sessionSlug: sessionSlug ?? sessionId,
        worktreePath,
        defaultBranch,
      })

      if (result.url) {
        pushToast({
          tone: 'success',
          title: 'Pull request created',
          description: result.url,
        })
      } else {
        pushToast({
          tone: 'success',
          title: 'Pull request form opened',
          description: 'Review and create the PR in your browser',
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushToast({ tone: 'error', title: 'GitHub pull request failed', description: message })
    }
  }, [worktreePath, github, sessionId, sessionSlug, defaultBranch, pushToast])

  useEffect(() => {
    if (!isReadyToMerge) return
    const cleanup = listenUiEvent(UiEvent.CreatePullRequest, (detail) => {
      if (detail.sessionId === sessionId) {
        handleCreateGithubPr()
      }
    })
    return cleanup
  }, [isReadyToMerge, sessionId, handleCreateGithubPr])

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
      {sessionState === 'running' && !isReadyToMerge && (
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
      {isReadyToMerge && (
        <>
          <IconButton
            icon={creatingPr ? spinnerIcon : <FaGithub />}
            onClick={handleCreateGithubPr}
            ariaLabel="Create GitHub pull request"
            tooltip={canCreatePr ? 'Create GitHub pull request (⌘⇧P)' : prTooltip}
            disabled={!canCreatePr || creatingPr}
            className={!canCreatePr ? 'opacity-60' : undefined}
          />
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
