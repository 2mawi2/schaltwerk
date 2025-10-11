import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiffSessionActions } from '../DiffSessionActions'
import { TauriCommands } from '../../../common/tauriCommands'
import type { EnrichedSession } from '../../../types/session'

const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
  switch (command) {
    case TauriCommands.GetAutoCommitOnReview:
      return true
    case TauriCommands.SchaltwerkCoreMarkSessionReady:
      return true
    case TauriCommands.SchaltwerkCoreResetSessionWorktree:
      return undefined
    default:
      return null
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: Parameters<typeof invokeMock>) => invokeMock(...args)
}))

function createSession(overrides: Partial<EnrichedSession['info']> = {}): EnrichedSession {
  return {
    info: {
      session_id: 'demo',
      display_name: 'Demo Session',
      branch: 'feature/demo',
      worktree_path: '/tmp/demo',
      base_branch: 'main',
      status: 'active',
      is_current: true,
      session_type: 'worktree',
      session_state: 'running',
      ready_to_merge: false,
      has_uncommitted_changes: false,
      ...overrides
    },
    status: undefined,
    terminals: []
  }
}

describe('DiffSessionActions', () => {
  beforeEach(() => {
    invokeMock.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders session controls and marks session ready when auto-commit is enabled', async () => {
    const onClose = vi.fn()
    const onReloadSessions = vi.fn(async () => {})
    const onLoadChangedFiles = vi.fn(async () => {})

    render(
      <DiffSessionActions
        isSessionSelection={true}
        sessionName="demo"
        targetSession={createSession()}
        canMarkReviewed={true}
        onClose={onClose}
        onReloadSessions={onReloadSessions}
        onLoadChangedFiles={onLoadChangedFiles}
      >
        {({ headerActions, dialogs }) => (
          <>
            <div data-testid="header">{headerActions}</div>
            <div data-testid="content">{dialogs}</div>
          </>
        )}
      </DiffSessionActions>
    )

    const markButton = await screen.findByRole('button', { name: /mark as reviewed/i })
    fireEvent.click(markButton)

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetAutoCommitOnReview)
    })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreMarkSessionReady,
        expect.objectContaining({ name: 'demo', autoCommit: true })
      )
    })

    await waitFor(() => expect(onReloadSessions).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('hides mark reviewed when session cannot be marked', () => {
    render(
      <DiffSessionActions
        isSessionSelection={true}
        sessionName="demo"
        targetSession={createSession({ ready_to_merge: true })}
        canMarkReviewed={false}
        onClose={() => {}}
        onReloadSessions={async () => {}}
        onLoadChangedFiles={async () => {}}
      >
        {({ headerActions }) => <div data-testid="header">{headerActions}</div>}
      </DiffSessionActions>
    )

    expect(screen.queryByRole('button', { name: /mark as reviewed/i })).toBeNull()
  })

  it('resets the session worktree after confirmation', async () => {
    const onClose = vi.fn()
    const onLoadChangedFiles = vi.fn(async () => {})

    render(
      <DiffSessionActions
        isSessionSelection={true}
        sessionName="demo"
        targetSession={createSession()}
        canMarkReviewed={false}
        onClose={onClose}
        onReloadSessions={async () => {}}
        onLoadChangedFiles={onLoadChangedFiles}
      >
        {({ headerActions, dialogs }) => (
          <>
            <div data-testid="header">{headerActions}</div>
            <div data-testid="dialogs">{dialogs}</div>
          </>
        )}
      </DiffSessionActions>
    )

    const resetButton = await screen.findByRole('button', { name: /reset session/i })
    fireEvent.click(resetButton)

    await screen.findByText(/Reset Session Worktree/i)
    const confirm = await screen.findByRole('button', { name: /^Reset$/i })
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreResetSessionWorktree,
        expect.objectContaining({ sessionName: 'demo' })
      )
    })

    await waitFor(() => expect(onLoadChangedFiles).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
