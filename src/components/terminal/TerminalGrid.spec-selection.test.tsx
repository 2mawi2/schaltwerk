import { render, screen, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

import { TerminalGrid } from './TerminalGrid'
import { TestProviders } from '../../tests/test-utils'
import { mockEnrichedSession } from '../../test-utils/sessionMocks'
import { TauriCommands } from '../../common/tauriCommands'
import type { MockTauriInvokeArgs } from '../../types/testing'
import type { RawSession } from '../../types/session'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from '../../contexts/SelectionContext'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {})
}))

vi.mock('./Terminal', () => ({
  Terminal: ({ terminalId }: { terminalId: string }) => <div data-testid={`terminal-${terminalId}`} />
}))

vi.mock('./TerminalTabs', () => ({
  TerminalTabs: ({ baseTerminalId }: { baseTerminalId: string }) => <div data-testid={`terminal-tabs-${baseTerminalId}`} />
}))

vi.mock('./RunTerminal', () => ({
  RunTerminal: ({ sessionName }: { sessionName?: string }) => (
    <div data-testid={`run-terminal-${sessionName ?? 'orchestrator'}`} />
  )
}))

vi.mock('../plans/SpecPlaceholder', async () => {
  const React = await import('react')
  const { useSelection } = await import('../../contexts/SelectionContext')
  return {
    SpecPlaceholder: () => {
      const { selection } = useSelection()
      const label = selection.kind === 'session' ? selection.payload ?? 'unknown' : 'none'
      return React.createElement('div', { 'data-testid': 'spec-placeholder' }, `Spec: ${label}`)
    }
  }
})

const mockedInvoke = vi.mocked(invoke)

type MockSession = ReturnType<typeof mockEnrichedSession>

let currentSessions: MockSession[] = []
let rawSessions: Record<string, RawSession> = {}

function toRaw(session: MockSession): RawSession {
  const now = new Date().toISOString()
  const state = session.info.session_state === 'spec'
    ? 'spec'
    : session.info.ready_to_merge
      ? 'reviewed'
      : 'running'
  return {
    id: `${session.info.session_id}-id`,
    name: session.info.session_id,
    display_name: session.info.display_name,
    repository_path: '/test/project',
    repository_name: 'project',
    branch: session.info.branch,
    parent_branch: 'main',
    worktree_path: session.info.worktree_path,
    status: state === 'spec' ? 'spec' : 'active',
    created_at: now,
    updated_at: now,
    ready_to_merge: session.info.ready_to_merge ?? false,
    pending_name_generation: false,
    was_auto_generated: false,
    session_state: state,
  }
}

function setSessionData(next: MockSession[]) {
  currentSessions = next
  rawSessions = Object.fromEntries(next.map(session => [session.info.session_id, toRaw(session)]))
}

function SelectionDriver({ onReady }: { onReady: (controller: { setSelection: ReturnType<typeof useSelection>['setSelection'] }) => void }) {
  const { setSelection } = useSelection()
  useEffect(() => {
    onReady({ setSelection })
  }, [onReady, setSelection])
  return null
}

describe('TerminalGrid spec fallback when backend metadata missing', () => {
  let controller: { setSelection: ReturnType<typeof useSelection>['setSelection'] } | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    controller = null

    const spec1 = mockEnrichedSession('spec-1', 'spec', false)
    const spec2 = mockEnrichedSession('spec-2', 'spec', false)
    const spec3 = mockEnrichedSession('spec-3', 'spec', false)
    setSessionData([spec1, spec2, spec3])

    mockedInvoke.mockImplementation(async (command: string, args?: MockTauriInvokeArgs) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
        case TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted:
          return currentSessions
        case TauriCommands.SchaltwerkCoreListSessionsByState:
          return []
        case TauriCommands.SchaltwerkCoreGetSession: {
          const sessionName = (args as { name?: string } | undefined)?.name
          if (!sessionName) return null
          return rawSessions[sessionName] ?? null
        }
        case TauriCommands.GetProjectSessionsSettings:
          return { filter_mode: 'all', sort_mode: 'name' }
        case TauriCommands.SetProjectSessionsSettings:
          return undefined
        case TauriCommands.GetProjectActionButtons:
          return []
        case TauriCommands.GetCurrentDirectory:
          return '/tmp/project'
        case TauriCommands.TerminalExists:
          return false
        case TauriCommands.CreateTerminal:
        case TauriCommands.CreateTerminalWithSize:
        case TauriCommands.RegisterSessionTerminals:
        case TauriCommands.SuspendSessionTerminals:
        case TauriCommands.ResumeSessionTerminals:
        case TauriCommands.CloseTerminal:
        case TauriCommands.ResizeTerminal:
        case TauriCommands.WriteTerminal:
        case TauriCommands.SchaltwerkCoreUpdateSpecContent:
        case TauriCommands.SchaltwerkCoreArchiveSpecSession:
          return undefined
        case TauriCommands.SchaltwerkCoreGetFontSizes:
          return [13, 14]
        default:
          return undefined
      }
    })
  })

  it('should keep showing spec placeholder when selection lacks metadata', async () => {
    render(
      <TestProviders>
        <SelectionDriver onReady={(c) => { controller = c }} />
        <TerminalGrid />
      </TestProviders>
    )

    await waitFor(() => {
      expect(controller).not.toBeNull()
    }, { timeout: 10000 })

    await act(async () => {
      await controller!.setSelection({ kind: 'session', payload: 'spec-2', sessionState: 'spec' }, false, true)
    })

    await waitFor(() => {
      expect(screen.getByTestId('spec-placeholder')).toHaveTextContent('spec-2')
    }, { timeout: 10000 })

    await act(async () => {
      await controller!.setSelection({ kind: 'session', payload: 'spec-3', sessionState: 'running' }, false, true)
    })

    await waitFor(() => {
      expect(screen.getByTestId('spec-placeholder')).toHaveTextContent('spec-3')
    }, { timeout: 10000 })
  })
})
