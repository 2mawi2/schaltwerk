import { renderHook, act, waitFor } from '@testing-library/react'
import { useAgentBinarySnapshot } from './useAgentBinarySnapshot'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('useAgentBinarySnapshot', () => {
  const mockInvoke = vi.mocked(invoke)

  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('computes status and allMissing when no binaries are found', async () => {
    mockInvoke.mockResolvedValueOnce([
      { agent_name: 'claude', custom_path: null, auto_detect: true, detected_binaries: [] },
      { agent_name: 'copilot', custom_path: null, auto_detect: true, detected_binaries: [] },
    ])

    const { result } = renderHook(() => useAgentBinarySnapshot())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetAllAgentBinaryConfigs)
    expect(result.current.allMissing).toBe(true)
    expect(result.current.statusByAgent.claude.status).toBe('missing')
  })

  it('marks agents as present when a path is detected', async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        agent_name: 'claude',
        custom_path: null,
        auto_detect: true,
        detected_binaries: [{ path: '/usr/bin/claude', installation_method: 'system' }],
      },
    ])

    const { result } = renderHook(() => useAgentBinarySnapshot())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.allMissing).toBe(false)
    expect(result.current.statusByAgent.claude.preferredPath).toBe('/usr/bin/claude')
    expect(result.current.statusByAgent.claude.status).toBe('present')
  })

  it('prefers custom_path over detected binaries', async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        agent_name: 'claude',
        custom_path: '/custom/claude',
        auto_detect: false,
        detected_binaries: [{ path: '/usr/bin/claude', installation_method: 'system' }],
      },
    ])

    const { result } = renderHook(() => useAgentBinarySnapshot())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.statusByAgent.claude.preferredPath).toBe('/custom/claude')
  })

  it('allows manual refresh', async () => {
    mockInvoke
      .mockResolvedValueOnce([
        { agent_name: 'claude', custom_path: null, auto_detect: true, detected_binaries: [] },
      ])
      .mockResolvedValueOnce([
        {
          agent_name: 'claude',
          custom_path: null,
          auto_detect: true,
          detected_binaries: [{ path: '/usr/bin/claude', installation_method: 'system' }],
        },
      ])

    const { result } = renderHook(() => useAgentBinarySnapshot())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.statusByAgent.claude.status).toBe('missing')

    await act(async () => {
      await result.current.refresh()
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.statusByAgent.claude.status).toBe('present')
  })
})
