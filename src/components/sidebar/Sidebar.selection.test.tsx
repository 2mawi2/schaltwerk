import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Event } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { mockDraftSession, mockEnrichedSession } from '../../test-utils/sessionMocks'
import { TauriCommands } from '../../common/tauriCommands'
import { SchaltEvent } from '../../common/eventSystem'
import { MockTauriInvokeArgs } from '../../types/testing'
import type { EnrichedSession } from '../../types/session'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('../../contexts/ProjectContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/ProjectContext')>('../../contexts/ProjectContext')
  return {
    ...actual,
    useProject: () => ({
      projectPath: '/test/project',
      setProjectPath: vi.fn()
    })
  }
})

const listeners: Record<string, Array<(event: Event<unknown>) => void>> = {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation((eventName: string, callback: (event: Event<unknown>) => void) => {
    if (!listeners[eventName]) listeners[eventName] = []
    listeners[eventName].push(callback)
    return Promise.resolve(() => {
      listeners[eventName] = (listeners[eventName] || []).filter(fn => fn !== callback)
      if (listeners[eventName]?.length === 0) {
        delete listeners[eventName]
      }
    })
  })
}))

async function emitEvent(event: SchaltEvent, payload: unknown) {
  const handlers = listeners[event]
  if (!handlers || handlers.length === 0) {
    throw new Error(`No handler registered for ${event}`)
  }
  await act(async () => {
    for (const handler of handlers) {
      await handler({ event, id: 0, payload } as Event<unknown>)
    }
  })
}

function assignSessionsMock(stateRef: () => unknown[]) {
  const castSessions = (): EnrichedSession[] => stateRef().map(session => session as unknown as EnrichedSession)
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
    if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
      return castSessions()
    }
    if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) {
      const mode = (args as { filterMode?: string })?.filterMode || 'all'
      const list = castSessions()
      if (mode === 'spec') return list.filter(s => s.info.session_state === 'spec')
      if (mode === 'running') return list.filter(s => s.info.session_state !== 'spec' && !s.info.ready_to_merge)
      if (mode === 'reviewed') return list.filter(s => s.info.ready_to_merge)
      return list
    }
    if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
    if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
    if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
    return undefined
  })
}

describe('Sidebar selection persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(listeners).forEach(key => delete listeners[key])
    localStorage.clear()
  })

  it('restores the last selected session per filter when switching filters', async () => {
    const specOne = mockDraftSession('spec-one')
    const specTwo = mockDraftSession('spec-two')
    const runOne = mockEnrichedSession('run-one', 'active', false)
    const runTwo = mockEnrichedSession('run-two', 'active', false)

    let sessionsState = [specOne, specTwo, runOne, runTwo]
    assignSessionsMock(() => sessionsState)

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      expect(screen.getByText('spec-one')).toBeInTheDocument()
      expect(screen.getByText('run-one')).toBeInTheDocument()
    })

    const runningFilterButton = screen.getByTitle('Show running agents')
    await userEvent.click(runningFilterButton)

    await waitFor(() => {
      expect(screen.getByText('run-two')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('run-two'))

    await waitFor(() => {
      const runTwoButton = screen.getByText('run-two').closest('[role="button"]')
      expect(runTwoButton).toHaveClass('session-ring-blue')
    })

    const specFilterButton = screen.getByTitle('Show spec agents')
    await userEvent.click(specFilterButton)

    await userEvent.click(screen.getByText('spec-two'))

    await waitFor(() => {
      const specTwoButton = screen.getByText('spec-two').closest('[role="button"]')
      expect(specTwoButton).toHaveClass('session-ring-blue')
    })

    await userEvent.click(runningFilterButton)

    await waitFor(() => {
      const runTwoButton = screen.getByText('run-two').closest('[role="button"]')
      expect(runTwoButton).toHaveClass('session-ring-blue')
    })

    await userEvent.click(specFilterButton)

    await waitFor(() => {
      const specTwoButton = screen.getByText('spec-two').closest('[role="button"]')
      expect(specTwoButton).toHaveClass('session-ring-blue')
    })
  })

  it('selects the next neighbour in the filter when the active session is removed', async () => {
    const specA = mockDraftSession('spec-a')
    const specB = mockDraftSession('spec-b')
    const specC = mockDraftSession('spec-c')

    let sessionsState = [specA, specB, specC]
    assignSessionsMock(() => sessionsState)

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      expect(screen.getByText('spec-b')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('spec-b'))

    await waitFor(() => {
      const specBButton = screen.getByText('spec-b').closest('[role="button"]')
      expect(specBButton).toHaveClass('session-ring-blue')
    })

    sessionsState = [specA, specC]
    await emitEvent(SchaltEvent.SessionRemoved, { session_name: 'spec-b' })

    await waitFor(() => {
      const specCButton = screen.getByText('spec-c').closest('[role="button"]')
      expect(specCButton).toHaveClass('session-ring-blue')
    })
  })

  it('falls back to orchestrator when the last session in a filter disappears', async () => {
    const specOnly = mockDraftSession('solo-spec')
    let sessionsState = [specOnly]

    assignSessionsMock(() => sessionsState)

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      expect(screen.getByText('solo-spec')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('solo-spec'))

    await waitFor(() => {
      const soloButton = screen.getByText('solo-spec').closest('[role="button"]')
      expect(soloButton).toHaveClass('session-ring-blue')
    })

    sessionsState = []
    await emitEvent(SchaltEvent.SessionRemoved, { session_name: 'solo-spec' })

    await waitFor(() => {
      const orchestratorButton = screen.getByText('orchestrator').closest('button')
      expect(orchestratorButton).toHaveClass('session-ring-blue')
    })
  })

  it('keeps focus on a neighbouring spec when the selected one starts running', async () => {
    const specOne = mockDraftSession('draft-one')
    const specTwo = mockDraftSession('draft-two')
    let sessionsState: Array<ReturnType<typeof mockDraftSession> | ReturnType<typeof mockEnrichedSession>> = [specOne, specTwo]

    assignSessionsMock(() => sessionsState)

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      expect(screen.getByText('draft-one')).toBeInTheDocument()
      expect(screen.getByText('draft-two')).toBeInTheDocument()
    })

    const specFilterButton = screen.getByTitle('Show spec agents')
    await userEvent.click(specFilterButton)

    await userEvent.click(screen.getByText('draft-two'))

    await waitFor(() => {
      const selected = screen.getByText('draft-two').closest('[role="button"]')
      expect(selected).toHaveClass('session-ring-blue')
    })

    const runningVersion = mockEnrichedSession('draft-two', 'running', false)
    sessionsState = [specOne, runningVersion]
    await emitEvent(SchaltEvent.SessionsRefreshed, sessionsState.map(session => session as unknown as EnrichedSession))

    await waitFor(() => {
      const fallback = screen.getByText('draft-one').closest('[role="button"]')
      expect(fallback).toHaveClass('session-ring-blue')
    })
  })

  it('keeps the current selection when a new spec is added to the list', async () => {
    const specOne = mockDraftSession('alpha-spec')
    const specTwo = mockDraftSession('beta-spec')
    let sessionsState: Array<ReturnType<typeof mockDraftSession> | ReturnType<typeof mockEnrichedSession>> = [specOne, specTwo]

    assignSessionsMock(() => sessionsState)

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      expect(screen.getByText('alpha-spec')).toBeInTheDocument()
      expect(screen.getByText('beta-spec')).toBeInTheDocument()
    })

    const specFilterButton = screen.getByTitle('Show spec agents')
    await userEvent.click(specFilterButton)

    await userEvent.click(screen.getByText('alpha-spec'))

    await waitFor(() => {
      const selected = screen.getByText('alpha-spec').closest('[role="button"]')
      expect(selected).toHaveClass('session-ring-blue')
    })

    const gammaSpec = mockDraftSession('gamma-spec')
    sessionsState = [specOne, specTwo, gammaSpec]
    await emitEvent(SchaltEvent.SessionsRefreshed, sessionsState.map(session => session as unknown as EnrichedSession))

    await waitFor(() => {
      expect(screen.getByText('gamma-spec')).toBeInTheDocument()
    })

    const stillSelected = screen.getByText('alpha-spec').closest('[role="button"]')
    expect(stillSelected).toHaveClass('session-ring-blue')
  })

})
