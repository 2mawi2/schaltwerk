import { useCallback } from 'react'
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
  VscWarning,
  VscBeaker,
  VscComment,
} from 'react-icons/vsc';
import { FaGithub } from 'react-icons/fa'
import { IconButton } from '../common/IconButton';
import type { MergeStatus } from '../../store/atoms/sessions';
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useToast } from '../../common/toast/ToastProvider'
import { usePrComments } from '../../hooks/usePrComments'
import type { Epic } from '../../types/session'
import { EpicSelect } from '../shared/EpicSelect'

const spinnerIcon = (
  <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
)

interface SessionActionsProps {
  sessionState: 'spec' | 'processing' | 'running' | 'reviewed';
  isReadyToMerge?: boolean;
  sessionId: string;
  hasUncommittedChanges?: boolean;
  branch?: string;
  sessionSlug?: string;
  worktreePath?: string;
  defaultBranch?: string;
  showPromoteIcon?: boolean;
  onCreatePullRequest?: (sessionId: string) => void;
  prNumber?: number;
  prUrl?: string;
  onRunSpec?: (sessionId: string) => void;
  onRefineSpec?: (sessionId: string) => void;
  onDeleteSpec?: (sessionId: string) => void;
  onMarkReviewed?: (sessionId: string) => void;
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
  onQuickMerge?: (sessionId: string) => void;
  disableMerge?: boolean;
  mergeStatus?: MergeStatus;
  isMarkReadyDisabled?: boolean;
  mergeConflictingPaths?: string[];
  onLinkPr?: (sessionId: string, prNumber: number, prUrl: string) => void;
  epic?: Epic | null;
  onEpicChange?: (epicId: string | null) => void;
  epicDisabled?: boolean;
}

export function SessionActions({
  sessionState,
  isReadyToMerge: _isReadyToMerge = false,
  sessionId,
  hasUncommittedChanges = false,
  showPromoteIcon = false,
  onCreatePullRequest,
  prNumber,
  onRunSpec,
  onRefineSpec,
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
  onQuickMerge,
  isResetting = false,
  disableMerge = false,
  mergeStatus = 'idle',
  isMarkReadyDisabled = false,
  mergeConflictingPaths,
  onLinkPr: _onLinkPr,
  epic,
  onEpicChange,
  epicDisabled = false,
}: SessionActionsProps) {
  const github = useGithubIntegrationContext()
  const { pushToast } = useToast()
  const { fetchingComments, fetchAndCopyToClipboard } = usePrComments()
  const spacing = 'gap-0.5';
  const conflictCount = mergeConflictingPaths?.length ?? 0;
  const conflictLabel = conflictCount > 0 ? `Resolve conflicts (${conflictCount})` : 'Resolve conflicts';
  const conflictTooltip = conflictCount > 0
    ? `Resolve conflicts (⌘⇧M)${mergeConflictingPaths?.length ? ` • ${mergeConflictingPaths.slice(0, 3).join(', ')}${mergeConflictingPaths.length > 3 ? '…' : ''}` : ''}`
    : 'Resolve conflicts (⌘⇧M)';

  const canCreatePr = github.canCreatePr;
  const prTooltip = canCreatePr
    ? 'Create pull request'
    : github.isGhMissing
      ? 'Install the GitHub CLI to enable PR automation'
      : github.hasRepository
        ? 'Sign in with GitHub to enable PR automation'
        : 'Connect this project to a GitHub repository first';
  const handleOpenPullRequest = useCallback(() => {
    if (!onCreatePullRequest) return
    onCreatePullRequest(sessionId)
  }, [onCreatePullRequest, sessionId])

  const handleFetchAndCopyComments = useCallback(async () => {
    if (!prNumber) {
      pushToast({ tone: 'error', title: 'No PR linked', description: 'Link a PR first before fetching comments' })
      return
    }
    await fetchAndCopyToClipboard(prNumber)
  }, [prNumber, pushToast, fetchAndCopyToClipboard])

  return (
    <div className={`flex items-center ${spacing}`} data-onboarding="session-actions">
      {/* Spec state actions */}
      {sessionState === 'spec' && (
        <>
          {onEpicChange && (
            <EpicSelect
              value={epic ?? null}
              onChange={onEpicChange}
              disabled={epicDisabled}
              stopPropagation
              variant="icon"
            />
          )}
          {onRefineSpec && (
            <IconButton
              icon={<VscBeaker />}
              onClick={() => onRefineSpec(sessionId)}
              ariaLabel="Refine spec"
              tooltip="Refine in orchestrator (⌘⇧R)"
            />
          )}
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
          {onEpicChange && (
            <EpicSelect
              value={epic ?? null}
              onChange={onEpicChange}
              disabled={epicDisabled}
              stopPropagation
              variant="icon"
            />
          )}
          <IconButton
            icon={<FaGithub />}
            onClick={handleOpenPullRequest}
            ariaLabel="Create pull request"
            tooltip={canCreatePr ? 'Create pull request (⌘⇧P)' : prTooltip}
            disabled={!canCreatePr || !onCreatePullRequest}
            className={!canCreatePr ? 'opacity-60' : undefined}
          />
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
          {onQuickMerge && (
            <IconButton
              icon={<VscGitMerge />}
              onClick={() => onQuickMerge(sessionId)}
              ariaLabel="Quick merge session"
              tooltip="Merge session (⌘⇧M)"
            />
          )}
          {onMarkReviewed && (
            <IconButton
              icon={<VscCheck />}
              onClick={() => onMarkReviewed(sessionId)}
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
          {onEpicChange && (
            <EpicSelect
              value={epic ?? null}
              onChange={onEpicChange}
              disabled={epicDisabled}
              stopPropagation
              variant="icon"
            />
          )}
          {prNumber && (
            <IconButton
              icon={fetchingComments ? spinnerIcon : <VscComment />}
              onClick={() => { void handleFetchAndCopyComments() }}
              ariaLabel="Copy PR comments"
              tooltip={`Fetch & copy PR #${prNumber} review comments to clipboard`}
              disabled={fetchingComments}
            />
          )}
          <IconButton
            icon={<FaGithub />}
            onClick={handleOpenPullRequest}
            ariaLabel="Create pull request"
            tooltip={canCreatePr ? 'Create pull request (⌘⇧P)' : prTooltip}
            disabled={!canCreatePr || !onCreatePullRequest}
            className={!canCreatePr ? 'opacity-60' : undefined}
          />
          {onMerge && (
            mergeStatus === 'merged' ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border"
                style={{
                  backgroundColor: 'var(--color-accent-green-bg)',
                  borderColor: 'var(--color-accent-green-border)',
                  color: 'var(--color-accent-green-light)',
                }}
                title="Session already merged"
              >
                <VscCheck />
                Merged
              </span>
            ) : mergeStatus === 'conflict' ? (
              <button
                type="button"
                onClick={() => { void onMerge(sessionId) }}
                disabled={disableMerge}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border"
                style={{
                  backgroundColor: 'var(--color-accent-red-bg)',
                  borderColor: 'var(--color-accent-red-border)',
                  color: 'var(--color-accent-red-light)',
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
                onClick={() => { void onMerge(sessionId) }}
                ariaLabel="Merge session"
                tooltip="Merge session (⌘⇧M merges instantly)"
                disabled={disableMerge}
              />
            )
          )}
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
          {onUnmarkReviewed && (
            <IconButton
              icon={<VscDiscard />}
              onClick={() => { void onUnmarkReviewed(sessionId) }}
              ariaLabel="Unmark as reviewed"
              tooltip="Unmark as reviewed (⌘R)"
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
              onClick={() => { void onCancel(sessionId, hasUncommittedChanges) }}
              ariaLabel="Cancel session"
              tooltip="Cancel session (⌘D)"
              variant="danger"
            />
          )}
        </>
      )}
    </div>
  );
}
