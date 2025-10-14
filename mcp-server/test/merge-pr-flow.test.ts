import { beforeEach, afterEach, beforeAll, afterAll, describe, it, expect, mock, spyOn } from 'bun:test'
import path from 'path'
import { SchaltwerkBridge } from '../src/schaltwerk-bridge'

const fetchMock = mock(() => Promise.resolve({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => '{}'
}))

mock.module('node-fetch', () => ({
  default: fetchMock
}))

describe('SchaltwerkBridge merge/pr helpers', () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>

  beforeAll(() => {
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterAll(() => {
    consoleErrorSpy.mockRestore()
  })

  beforeEach(() => {
    fetchMock.mockReset()
    process.env.SCHALTWERK_PROJECT_PATH = path.resolve(__dirname, '..', '..')
  })

  afterEach(() => {
    delete process.env.SCHALTWERK_PROJECT_PATH
  })

  it('sends merge request payload and maps response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          session_name: 'feature-login',
          parent_branch: 'main',
          session_branch: 'schaltwerk/feature-login',
          mode: 'reapply',
          commit: 'abcdef1',
          cancel_requested: true,
          cancel_queued: true,
          cancel_error: null
        })
    })

    const bridge = new SchaltwerkBridge()
    const result = await bridge.mergeSession('feature-login', {
      commitMessage: 'review: feature-login – add login screen',
      mode: 'reapply',
      cancelAfterMerge: true
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({
      mode: 'reapply',
      commit_message: 'review: feature-login – add login screen',
      cancel_after_merge: true
    })
    expect(result).toEqual({
      sessionName: 'feature-login',
      parentBranch: 'main',
      sessionBranch: 'schaltwerk/feature-login',
      mode: 'reapply',
      commit: 'abcdef1',
      cancelRequested: true,
      cancelQueued: true,
      cancelError: undefined
    })
  })

  it('rejects squash merge without a commit message', async () => {
    const bridge = new SchaltwerkBridge()
    await expect(
      bridge.mergeSession('feature-login', { commitMessage: '   ' })
    ).rejects.toThrow('commitMessage is required and must be a non-empty string when performing a squash merge.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows reapply merge without a commit message', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          session_name: 'feature-login',
          parent_branch: 'main',
          session_branch: 'schaltwerk/feature-login',
          mode: 'reapply',
          commit: 'cafebabe',
          cancel_requested: false,
          cancel_queued: false,
          cancel_error: null
        })
    })

    const bridge = new SchaltwerkBridge()
    const result = await bridge.mergeSession('feature-login', { mode: 'reapply' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(JSON.parse(String(init?.body))).toEqual({
      mode: 'reapply',
      cancel_after_merge: false
    })
    expect(result.mode).toBe('reapply')
  })

  it('creates pull request with optional overrides', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          session_name: 'feature-login',
          branch: 'reviewed/feature-login',
          url: 'https://github.com/example/repo/pull/42',
          cancel_requested: true,
          cancel_queued: false,
          cancel_error: 'session has active terminals'
        })
    })

    const bridge = new SchaltwerkBridge()
    const result = await bridge.createPullRequest('feature-login', {
      commitMessage: 'review: login',
      defaultBranch: 'develop',
      repository: 'example/repo',
      cancelAfterPr: true
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      commit_message: 'review: login',
      default_branch: 'develop',
      repository: 'example/repo',
      cancel_after_pr: true
    })
    expect(result).toEqual({
      sessionName: 'feature-login',
      branch: 'reviewed/feature-login',
      url: 'https://github.com/example/repo/pull/42',
      cancelRequested: true,
      cancelQueued: false,
      cancelError: 'session has active terminals'
    })
  })
})
