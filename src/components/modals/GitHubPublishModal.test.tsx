import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { ModalProvider } from '../../contexts/ModalContext'
import { GitHubPublishModal } from './GitHubPublishModal'
import { SessionInfo, SessionState } from '../../types/session'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('../../common/eventSystem', () => ({
  listenEvent: vi.fn().mockResolvedValue(() => {}),
  SchaltEvent: {
    GitHubPublishCompleted: 'schaltwerk:github-publish-completed',
    GitHubPublishFailed: 'schaltwerk:github-publish-failed',
  }
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd: string, args: Record<string, unknown>) => {
    switch (cmd) {
      case TauriCommands.GitHubPublishGetContext:
        expect(args).toMatchObject({ sessionName: 'session-123' })
        return Promise.resolve({
          remotes: [
            { remote_name: 'origin', owner: 'acme', repo: 'widgets', host: 'github.com' },
            { remote_name: 'upstream', owner: 'acme', repo: 'widgets', host: 'github.com' }
          ],
          linked: null,
          session_branch: 'session/feature-work',
          session_display_name: 'Feature Work',
          session_base_branch: 'main',
          default_base_branch: 'main',
          suggested_target_branch: 'feature/feature-work',
          available_branches: ['main', 'develop'],
          last_publish_mode: 'squash',
          has_uncommitted_changes: false,
          commit_message_suggestion: 'Feature Work'
        })
      case TauriCommands.GitHubPublishPrepare:
        expect(args).toMatchObject({
          sessionName: 'session-123',
          remoteName: 'origin',
          targetBranch: 'feature/custom',
          baseBranch: 'develop',
          mode: 'keep',
          commitMessage: 'Custom Commit'
        })
        return Promise.resolve({
          compare_url: 'https://github.com/acme/widgets/compare/develop...feature%2Fcustom?expand=1&quick_pull=1',
          pushed_branch: 'feature/custom',
          mode: 'keep'
        })
      default:
        return Promise.resolve(null)
    }
  })
}))

const sampleSession: SessionInfo = {
  session_id: 'session-123',
  branch: 'session/feature-work',
  base_branch: 'main',
  worktree_path: '/tmp/worktree',
  status: 'active',
  created_at: new Date().toISOString(),
  last_modified: new Date().toISOString(),
  has_uncommitted_changes: false,
  is_current: false,
  session_type: 'worktree',
  session_state: SessionState.Reviewed,
  ready_to_merge: true,
  display_name: 'Feature Work'
}

function renderModal() {
  const onClose = vi.fn()
  const onCancelSession = vi.fn()
  vi.spyOn(window, 'open').mockImplementation(() => null)
  render(
    <ModalProvider>
      <GitHubPublishModal
        open={true}
        session={sampleSession}
        onClose={onClose}
        onCancelSession={onCancelSession}
      />
    </ModalProvider>
  )
  return { onClose, onCancelSession }
}

describe('GitHubPublishModal', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

  it('loads context, allows configuration, and triggers publish', async () => {
    const { onCancelSession } = renderModal()

    await waitFor(() => {
      expect(screen.getByText(/Create Pull Request/i)).toBeInTheDocument()
    })

    expect(await screen.findByDisplayValue('main')).toBeInTheDocument()

    const baseSelect = screen.getByLabelText(/Base branch/i) as HTMLSelectElement
    fireEvent.change(baseSelect, { target: { value: 'develop' } })
    expect(baseSelect.value).toBe('develop')

    const branchInput = screen.getByLabelText(/Target branch/i) as HTMLInputElement
    fireEvent.change(branchInput, { target: { value: 'feature/custom' } })
    expect(branchInput.value).toBe('feature/custom')

    const modeToggle = screen.getByRole('button', { name: /Keep existing commits/i })
    fireEvent.click(modeToggle)

    const commitInput = screen.getByLabelText(/Commit title/i) as HTMLInputElement
    fireEvent.change(commitInput, { target: { value: 'Custom Commit' } })
    expect(commitInput.value).toBe('Custom Commit')

    const confirmCheckbox = screen.getByLabelText(/I understand Schaltwerk will push this branch/i) as HTMLInputElement
    fireEvent.click(confirmCheckbox)
    expect(confirmCheckbox.checked).toBe(true)

    const submitButton = screen.getByRole('button', { name: /Create Branch & Open PR/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/Branch pushed successfully/i)).toBeInTheDocument()
    })

    const link = screen.getByRole('link', { name: /Open compare view/i }) as HTMLAnchorElement
    expect(link.href).toBe('https://github.com/acme/widgets/compare/develop...feature%2Fcustom?expand=1&quick_pull=1')

    expect(window.open).toHaveBeenCalledWith('https://github.com/acme/widgets/compare/develop...feature%2Fcustom?expand=1&quick_pull=1', '_blank', 'noopener,noreferrer')

    const cancelButton = screen.getByRole('button', { name: /PR created – cancel session/i })
    fireEvent.click(cancelButton)
    expect(onCancelSession).toHaveBeenCalledWith('session-123')
  })
})
