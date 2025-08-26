import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useClaudeSession } from './useClaudeSession'
import { renderHook, act } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

describe('useClaudeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts commander when isCommander is true', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useClaudeSession())
    await act(async () => result.current.startClaude({ isCommander: true }))
    expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_start_claude_orchestrator', { 
      terminalId: 'commander-default-top' 
    })
  })

  it('starts session when sessionName is provided', async () => {
    mockInvoke.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useClaudeSession())
    await act(async () => result.current.startClaude({ sessionName: 's1' }))
    expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_start_claude', { sessionName: 's1' })
  })

  it('returns failure when options are invalid', async () => {
    const { result } = renderHook(() => useClaudeSession())
    const out = await act(async () => result.current.startClaude({} as any))
    expect(out).toEqual({ success: false, error: 'Invalid options' })
  })

  it('gets and sets skip permissions', async () => {
    mockInvoke.mockResolvedValueOnce(true)
    mockInvoke.mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useClaudeSession())
    const val = await result.current.getSkipPermissions()
    expect(val).toBe(true)

    const setOk = await result.current.setSkipPermissions(false)
    expect(setOk).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_set_skip_permissions', { enabled: false })
  })

  it('gets and sets agent type with defaults on error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    mockInvoke.mockResolvedValueOnce('cursor')
    const { result } = renderHook(() => useClaudeSession())

    const agent = await result.current.getAgentType()
    expect(agent).toBe('cursor')

    mockInvoke.mockRejectedValueOnce(new Error('boom'))
    const agentOnError = await result.current.getAgentType()
    expect(agentOnError).toBe('claude')

    mockInvoke.mockResolvedValueOnce(undefined)
    const setOk = await result.current.setAgentType('cursor')
    expect(setOk).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_set_agent_type', { agentType: 'cursor' })
    
    consoleErrorSpy.mockRestore()
  })
})
