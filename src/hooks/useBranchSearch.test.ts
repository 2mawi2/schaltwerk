import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBranchSearch } from './useBranchSearch'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

const mockInvoke = vi.mocked(invoke)

describe('useBranchSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches branches on mount', async () => {
    const branches = ['main', 'develop', 'feature/auth']
    mockInvoke.mockResolvedValueOnce(branches)

    const { result } = renderHook(() => useBranchSearch())

    expect(result.current.loading).toBe(true)

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockInvoke).toHaveBeenCalledWith('list_project_branches')
    expect(result.current.branches).toEqual(branches)
    expect(result.current.filteredBranches).toEqual(branches)
    expect(result.current.error).toBeNull()
  })

  it('does not fetch when enabled is false', () => {
    const { result } = renderHook(() => useBranchSearch({ enabled: false }))

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.branches).toEqual([])
  })

  it('filters branches by query with priority: exact > startsWith > contains', async () => {
    const branches = ['main', 'feature/main-page', 'hotfix/login', 'main-release', 'develop']
    mockInvoke.mockResolvedValueOnce(branches)

    const { result } = renderHook(() => useBranchSearch())

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setQuery('main')
    })

    const filtered = result.current.filteredBranches
    expect(filtered[0]).toBe('main')
    expect(filtered).toContain('main-release')
    expect(filtered).toContain('feature/main-page')
    expect(filtered).not.toContain('hotfix/login')
    expect(filtered).not.toContain('develop')
  })

  it('filters case-insensitively', async () => {
    const branches = ['Main', 'DEVELOP', 'feature/AUTH']
    mockInvoke.mockResolvedValueOnce(branches)

    const { result } = renderHook(() => useBranchSearch())

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setQuery('auth')
    })

    expect(result.current.filteredBranches).toContain('feature/AUTH')
  })

  it('returns all branches when query is empty', async () => {
    const branches = ['main', 'develop']
    mockInvoke.mockResolvedValueOnce(branches)

    const { result } = renderHook(() => useBranchSearch())

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setQuery('')
    })

    expect(result.current.filteredBranches).toEqual(branches)
  })

  it('limits results to 50', async () => {
    const branches = Array.from({ length: 100 }, (_, i) => `branch-${i}`)
    mockInvoke.mockResolvedValueOnce(branches)

    const { result } = renderHook(() => useBranchSearch())

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setQuery('branch')
    })

    expect(result.current.filteredBranches.length).toBe(50)
  })

  it('handles fetch error', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useBranchSearch())

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network error')
    expect(result.current.branches).toEqual([])
  })

  it('handles string error', async () => {
    mockInvoke.mockRejectedValueOnce('Connection failed')

    const { result } = renderHook(() => useBranchSearch())

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Connection failed')
  })
})
