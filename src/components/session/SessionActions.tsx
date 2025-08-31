import { 
  VscPlay, 
  VscTrash, 
  VscCheck, 
  VscClose, 
  VscDiscard, 
  VscArchive
} from 'react-icons/vsc';
import { IconButton } from '../common/IconButton';

interface SessionActionsProps {
  sessionState: 'spec' | 'running' | 'reviewed';
  sessionId: string;
  hasUncommittedChanges?: boolean;
  branch?: string;
  onRunSpec?: (sessionId: string) => void;
  onDeleteSpec?: (sessionId: string) => void;
  onMarkReviewed?: (sessionId: string, hasUncommitted: boolean) => void;
  onUnmarkReviewed?: (sessionId: string) => void;
  onCancel?: (sessionId: string, hasUncommitted: boolean) => void;
  onConvertToSpec?: (sessionId: string) => void;
}

export function SessionActions({
  sessionState,
  sessionId,
  hasUncommittedChanges = false,
  onRunSpec,
  onDeleteSpec,
  onMarkReviewed,
  onUnmarkReviewed,
  onCancel,
  onConvertToSpec,
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
              tooltip="Unmark as reviewed"
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