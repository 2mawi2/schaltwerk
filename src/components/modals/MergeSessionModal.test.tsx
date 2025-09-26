import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MergeSessionModal, MergeModeOption } from './MergeSessionModal'
import { ModalProvider } from '../../contexts/ModalContext'

const preview = {
  sessionBranch: 'feature/test-session',
  parentBranch: 'main',
  squashCommands: ['git reset --soft main', 'git commit -m "message"'],
  reapplyCommands: ['git rebase main'],
  defaultCommitMessage: 'Merge test session',
  hasConflicts: false,
  conflictingPaths: [],
  isUpToDate: false,
}

function renderModal(
  props: Partial<React.ComponentProps<typeof MergeSessionModal>> = {}
) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  const {
    autoCancelEnabled = false,
    onToggleAutoCancel = vi.fn(),
    ...rest
  } = props

  render(
    <ModalProvider>
      <MergeSessionModal
        open
        sessionName="test-session"
        status="ready"
        preview={preview}
        onClose={onClose}
        onConfirm={onConfirm}
        autoCancelEnabled={autoCancelEnabled}
        onToggleAutoCancel={onToggleAutoCancel}
        {...rest}
      />
    </ModalProvider>
  )

  return { onConfirm, onClose, onToggleAutoCancel }
}

describe('MergeSessionModal', () => {
  it('prefills the commit message for squash mode', () => {
    renderModal()
    const input = screen.getByLabelText('Commit message') as HTMLInputElement
    expect(input.value).toBe('Merge test session')
  })

  it('requires commit message in squash mode', () => {
    renderModal()
    const input = screen.getByLabelText('Commit message') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    const confirm = screen.getByRole('button', { name: 'Merge session' })
    expect(confirm).toBeDisabled()
  })

  it('allows merge in reapply mode without commit message', () => {
    const { onConfirm } = renderModal()
    const reapplyButton = screen.getByRole('button', { name: 'Reapply commits' })
    fireEvent.click(reapplyButton)
    const confirm = screen.getByRole('button', { name: 'Merge session' })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('reapply' as MergeModeOption)
  })

  it('renders auto-cancel toggle reflecting disabled state', () => {
    renderModal({ autoCancelEnabled: false })
    const toggle = screen.getByRole('checkbox', { name: 'Auto-cancel after merge' }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
  })

  it('invokes toggle handler with next state', () => {
    const onToggleAutoCancel = vi.fn()
    renderModal({ autoCancelEnabled: false, onToggleAutoCancel })
    const toggle = screen.getByRole('checkbox', { name: 'Auto-cancel after merge' })
    fireEvent.click(toggle)
    expect(onToggleAutoCancel).toHaveBeenCalledWith(true)
  })

  it('marks toggle as pressed when enabled', () => {
    renderModal({ autoCancelEnabled: true })
    const toggle = screen.getByRole('checkbox', { name: 'Auto-cancel after merge' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })
})
