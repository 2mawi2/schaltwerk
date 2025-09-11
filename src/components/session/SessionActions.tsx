import { 
  VscPlay, 
  VscTrash, 
  VscCheck, 
  VscClose, 
  VscDiscard, 
  VscArchive,
  VscStarFull,
  VscRefresh,
  VscCode
} from 'react-icons/vsc';
import { IconButton } from '../common/IconButton';

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
  isResetting = false,
}: SessionActionsProps) {
  // Use moderate spacing for medium-sized buttons
  const spacing = sessionState === 'spec' ? 'gap-1' : 'gap-0.5';
  
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
              tooltip="Switch model"
            />
          )}
          {onReset && (
            <IconButton
              icon={<VscRefresh />}
              onClick={() => onReset(sessionId)}
              ariaLabel="Reset session"
              tooltip="Reset session"
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
          {onUnmarkReviewed && (
            <IconButton
              icon={<VscDiscard />}
              onClick={() => onUnmarkReviewed(sessionId)}
              ariaLabel="Unmark as reviewed"
              tooltip="Unmark as reviewed (⌘R)"
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
