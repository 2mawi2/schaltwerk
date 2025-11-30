import { ConfirmModal } from './ConfirmModal'
import { theme } from '../../common/theme'

interface Props {
  open: boolean
  script: string
  isApplying?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function SetupScriptApprovalModal({
  open,
  script,
  isApplying = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <ConfirmModal
      open={open}
      title="Approve worktree setup script"
      confirmText={isApplying ? 'Saving…' : 'Apply script'}
      cancelText="Reject"
      confirmDisabled={isApplying}
      loading={isApplying}
      onConfirm={onConfirm}
      onCancel={onCancel}
      body={
        <div className="space-y-3 text-slate-200">
          <p className="text-body text-slate-300">
            This script runs automatically for every new session worktree. Review and approve before applying.
          </p>
          <div
            className="rounded border border-slate-700 overflow-auto"
            style={{ backgroundColor: theme.colors.background.tertiary }}
          >
            <pre
              data-testid="setup-script-preview"
              className="p-3 text-sm font-mono whitespace-pre-wrap"
              style={{ color: theme.colors.text.primary }}
            >
              {script || '(empty script)'}
            </pre>
          </div>
        </div>
      }
    />
  )
}
