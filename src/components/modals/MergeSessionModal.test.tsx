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

function findConfirmButton(): HTMLButtonElement {
  const button = screen.getAllByRole('button').find(el => el.textContent?.includes('Merge session'))
  if (!button) {
    throw new Error('Confirm button not found')
  }
  return button as HTMLButtonElement
}

describe('MergeSessionModal', () => {
  it('renders an empty, focused commit message field even when a default is provided', () => {
    renderModal()
    const input = screen.getByLabelText('Commit message') as HTMLInputElement
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
  })

  it('hides the command preview list', () => {
    renderModal()
    expect(screen.queryByText('Commands')).toBeNull()
  })

  it('requires commit message in squash mode', () => {
    renderModal()
    const input = screen.getByLabelText('Commit message') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    const confirm = findConfirmButton()
    expect(confirm).toBeDisabled()
  })

  it('allows merge in reapply mode without commit message', () => {
    const { onConfirm } = renderModal()
    const reapplyButton = screen.getByRole('button', { name: 'Reapply commits' })
    fireEvent.click(reapplyButton)
    const confirm = findConfirmButton()
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

  it('surfaces keyboard hints for cancel and confirm actions', () => {
    renderModal()
    const cancel = screen.getAllByRole('button').find(button => button.textContent?.includes('Cancel'))
    expect(cancel).toBeDefined()
    expect(cancel!.textContent).toMatch(/Esc/)
    const confirm = findConfirmButton()
    expect(confirm.textContent).toMatch(/⌘↵/)
  })
})
