import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOnboarding } from './useOnboarding'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('useOnboarding', () => {
  const mockInvoke = invoke as MockedFunction<typeof invoke>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0))

  it('opens onboarding automatically when fetching tutorial status fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('database unavailable'))

    const { result } = renderHook(() => useOnboarding())

    expect(result.current.isOnboardingOpen).toBe(false)

    await act(async () => {
      await flushPromises()
    })

    expect(result.current.isOnboardingOpen).toBe(true)
  })

  it('marks onboarding as completed when the modal is closed', async () => {
    mockInvoke.mockResolvedValueOnce(false)
    mockInvoke.mockResolvedValue(undefined)

    const { result } = renderHook(() => useOnboarding())

    await act(async () => {
      await flushPromises()
    })

    act(() => {
      result.current.closeOnboarding()
    })

    await act(async () => {
      await flushPromises()
    })

    expect(result.current.isOnboardingOpen).toBe(false)
    expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetTutorialCompleted, { completed: true })
  })

  it('does not rewrite completion when already completed', async () => {
    mockInvoke.mockResolvedValueOnce(true)

    const { result } = renderHook(() => useOnboarding())

    await act(async () => {
      await flushPromises()
    })

    act(() => {
      result.current.closeOnboarding()
    })

    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })
})
