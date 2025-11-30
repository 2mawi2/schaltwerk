import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import userEvent from '@testing-library/user-event'
import { SetupScriptApprovalModal } from './SetupScriptApprovalModal'

describe('SetupScriptApprovalModal', () => {
  const script = '#!/bin/bash\necho "hi"'

  it('renders the script preview when open', () => {
    render(
      <SetupScriptApprovalModal
        open={true}
        script={script}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText(/Approve worktree setup script/i)).toBeInTheDocument()
    expect(screen.getByText(/runs for every new worktree/i)).toBeInTheDocument()
    expect(screen.getByTestId('setup-script-preview')).toHaveTextContent('echo "hi"')
  })

  it('invokes confirm and cancel handlers', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <SetupScriptApprovalModal
        open={true}
        script={script}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    await user.click(screen.getByRole('button', { name: /Apply script/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /Reject/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
