import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useRunningServices } from './useRunningServices'
import { invoke } from '@tauri-apps/api/core'

// Mock Tauri's invoke
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}))

// Mock event listener
vi.mock('../common/eventSystem', () => ({
    SchaltEvent: {
        TerminalClosed: 'schaltwerk:terminal-closed',
    },
    listenEvent: vi.fn().mockResolvedValue(() => {}),
}))

describe('useRunningServices', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('should load services on mount', async () => {
        const mockServices = [
            {
                id: 'svc-1',
                name: 'Test Service',
                port: 3000,
                url: 'http://localhost:3000',
                terminal_id: 'term-1',
                session_name: 'session-1',
                started_at: Date.now() / 1000,
                pid: null,
                status: 'running' as const,
                metadata: {},
            },
        ]

        vi.mocked(invoke).mockResolvedValueOnce({ services: mockServices })

        const { result } = renderHook(() => useRunningServices())

        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })

        expect(result.current.services).toEqual(mockServices)
        expect(result.current.error).toBeNull()
    })

    it('should handle errors gracefully', async () => {
        vi.mocked(invoke).mockRejectedValueOnce(new Error('Network error'))

        const { result } = renderHook(() => useRunningServices())

        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })

        expect(result.current.services).toEqual([])
        expect(result.current.error).toBe('Network error')
    })

    it('should filter by session name when provided', async () => {
        const mockServices = [{ id: 'svc-1', name: 'Test' }]
        vi.mocked(invoke).mockResolvedValueOnce({ services: mockServices })

        renderHook(() => useRunningServices({ sessionName: 'my-session' }))

        await waitFor(() => {
            expect(invoke).toHaveBeenCalledWith(
                'list_running_services_by_session',
                { sessionName: 'my-session' }
            )
        })
    })
})
