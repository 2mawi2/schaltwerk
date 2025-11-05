import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi, MockedFunction } from 'vitest'
import type { ReactNode } from 'react'
import { useGithubIntegration } from '../useGithubIntegration'
import { TauriCommands } from '../../common/tauriCommands'
import { GitHubStatusPayload, GitHubPrPayload } from '../../common/events'
import { invoke } from '@tauri-apps/api/core'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { Provider, createStore } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

const eventHandlers: Partial<Record<SchaltEvent, (payload: unknown) => void>> = {}

vi.mock('../../common/eventSystem', async () => {
  const actual = await vi.importActual<typeof import('../../common/eventSystem')>('../../common/eventSystem')
  return {
    ...actual,
    listenEvent: vi.fn(async (event: SchaltEvent, handler: (payload: unknown) => void) => {
      eventHandlers[event] = handler
      return async () => {
        delete eventHandlers[event]
      }
    })
  }
})

describe('useGithubIntegration', () => {
  const mockInvoke = invoke as MockedFunction<typeof invoke>
  const mockListenEvent = listenEvent as unknown as MockedFunction<typeof listenEvent>

  const createWrapper = (projectPath?: string) => {
    const store = createStore()
    if (typeof projectPath === 'string') {
      store.set(projectPathAtom, projectPath)
    }
    return ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(eventHandlers).forEach((key) => delete eventHandlers[key as SchaltEvent])
  })

  it('fetches status on mount', async () => {
    const status: GitHubStatusPayload = {
      installed: true,
      authenticated: true,
      userLogin: 'octocat',
      repository: {
        nameWithOwner: 'octo/hello',
        defaultBranch: 'main'
      }
    }

    mockInvoke.mockResolvedValueOnce(status)

    const { result } = renderHook(() => useGithubIntegration(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.status).toEqual(status)
      expect(result.current.loading).toBe(false)
    })

    expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GitHubGetStatus)
    expect(mockListenEvent).toHaveBeenCalledWith(SchaltEvent.GitHubStatusChanged, expect.any(Function))
  })

  it('updates status through authenticate', async () => {
    const initialStatus: GitHubStatusPayload = {
      installed: true,
      authenticated: false,
      userLogin: null,
      repository: null
    }
    const authenticatedStatus: GitHubStatusPayload = {
      installed: true,
      authenticated: true,
      userLogin: 'octocat',
      repository: null
    }

    mockInvoke
      .mockResolvedValueOnce(initialStatus) // initial fetch
      .mockResolvedValueOnce(authenticatedStatus)

    const { result } = renderHook(() => useGithubIntegration(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.status).toEqual(initialStatus)
    })

    await act(async () => {
      await result.current.authenticate()
    })

    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.GitHubAuthenticate)
    await waitFor(() => {
      expect(result.current.status).toEqual(authenticatedStatus)
    })
  })

  it('stores cached PR URLs after creation', async () => {
    const initialStatus: GitHubStatusPayload = {
      installed: true,
      authenticated: true,
      userLogin: 'octocat',
      repository: {
        nameWithOwner: 'octo/hello',
        defaultBranch: 'main'
      }
    }

    const prPayload: GitHubPrPayload = {
      branch: 'reviewed/session-1',
      url: 'https://github.com/octo/hello/pull/42'
    }

    mockInvoke
      .mockResolvedValueOnce(initialStatus) // initial status
      .mockResolvedValueOnce(prPayload)

    const { result } = renderHook(() => useGithubIntegration(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.status).toEqual(initialStatus)
    })

    await act(async () => {
      await result.current.createReviewedPr({
        sessionId: 'session-1',
        sessionSlug: 'session-1',
        worktreePath: '/tmp/worktree',
      })
    })

    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.GitHubCreateReviewedPr, {
      args: {
        sessionSlug: 'session-1',
        worktreePath: '/tmp/worktree',
        defaultBranch: 'main',
        commitMessage: undefined,
        repository: 'octo/hello'
      }
    })

    expect(result.current.isCreatingPr('session-1')).toBe(false)
    expect(result.current.getCachedPrUrl('session-1')).toBe(prPayload.url)
  })
  it('reinitializes the active project before refreshing status when a project is open', async () => {
    const projectPath = '/tmp/project'
    const status: GitHubStatusPayload = {
      installed: true,
      authenticated: true,
      userLogin: 'octocat',
      repository: null,
    }
    const refreshedStatus: GitHubStatusPayload = {
      ...status,
      authenticated: true,
    }

    mockInvoke
      .mockResolvedValueOnce(undefined) // initial project initialize
      .mockResolvedValueOnce(status) // initial status fetch

    const { result } = renderHook(() => useGithubIntegration(), {
      wrapper: createWrapper(projectPath),
    })

    await waitFor(() => {
      expect(result.current.status).toEqual(status)
    })

    mockInvoke
      .mockResolvedValueOnce(undefined) // ensure registration before manual refresh
      .mockResolvedValueOnce(refreshedStatus)

    await act(async () => {
      await result.current.refreshStatus()
    })

    await waitFor(() => {
      expect(result.current.status).toEqual(refreshedStatus)
    })

    const initCalls = mockInvoke.mock.calls.filter(
      ([command]) => command === TauriCommands.InitializeProject
    )
    expect(initCalls).toHaveLength(2)
    initCalls.forEach(([, args]) => {
      expect(args).toEqual({ path: projectPath })
    })
  })

  it('reinitializes the active project before authenticating when a project is open', async () => {
    const projectPath = '/tmp/project'
    const initialStatus: GitHubStatusPayload = {
      installed: true,
      authenticated: false,
      userLogin: null,
      repository: null,
    }
    const authenticatedStatus: GitHubStatusPayload = {
      installed: true,
      authenticated: true,
      userLogin: 'octocat',
      repository: null,
    }

    mockInvoke
      .mockResolvedValueOnce(undefined) // initial initialize
      .mockResolvedValueOnce(initialStatus) // initial status fetch
      .mockResolvedValueOnce(undefined) // ensure registration before authenticate
      .mockResolvedValueOnce(authenticatedStatus)

    const { result } = renderHook(() => useGithubIntegration(), {
      wrapper: createWrapper(projectPath),
    })

    await waitFor(() => {
      expect(result.current.status).toEqual(initialStatus)
    })

    await act(async () => {
      await result.current.authenticate()
    })

    await waitFor(() => {
      expect(result.current.status).toEqual(authenticatedStatus)
    })

    const initCalls = mockInvoke.mock.calls.filter(
      ([command]) => command === TauriCommands.InitializeProject
    )
    expect(initCalls).toHaveLength(2)
    initCalls.forEach(([, args]) => {
      expect(args).toEqual({ path: projectPath })
    })
  })

  it('reinitializes the active project before connecting when a project is open', async () => {
    const projectPath = '/tmp/project'
    const initialStatus: GitHubStatusPayload = {
      installed: true,
      authenticated: true,
      userLogin: 'octocat',
      repository: null,
    }
    const repositoryPayload = {
      nameWithOwner: 'octo/hello',
      defaultBranch: 'main',
    }

    mockInvoke
      .mockResolvedValueOnce(undefined) // initial initialize
      .mockResolvedValueOnce(initialStatus) // initial status fetch

    const { result } = renderHook(() => useGithubIntegration(), {
      wrapper: createWrapper(projectPath),
    })

    await waitFor(() => {
      expect(result.current.status).toEqual(initialStatus)
    })

    mockInvoke
      .mockResolvedValueOnce(undefined) // ensure registration before connect
      .mockResolvedValueOnce(repositoryPayload)

    await act(async () => {
      await result.current.connectProject()
    })

    await waitFor(() => {
      expect(result.current.status?.repository).toEqual(repositoryPayload)
    })

    const initCalls = mockInvoke.mock.calls.filter(
      ([command]) => command === TauriCommands.InitializeProject
    )
    expect(initCalls).toHaveLength(2)
    initCalls.forEach(([, args]) => {
      expect(args).toEqual({ path: projectPath })
    })
  })
})
