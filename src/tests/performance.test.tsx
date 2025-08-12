import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from '../components/Sidebar'
import { SelectionProvider } from '../contexts/SelectionContext'
import { FocusProvider } from '../contexts/FocusContext'
import { ProjectProvider } from '../contexts/ProjectContext'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => {}))
}))

function generateMockSessions(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        info: {
            session_id: `session-${i}`,
            branch: `feature-${i}`,
            worktree_path: `/path/to/worktree-${i}`,
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'active',
            last_modified: new Date(Date.now() - i * 1000000).toISOString(),
            has_uncommitted_changes: i % 3 === 0,
            is_current: false,
            session_type: 'worktree',
            session_state: i % 4 === 0 ? 'idle' : 'active',
            todo_percentage: Math.floor(Math.random() * 100),
            diff_stats: {
                files_changed: Math.floor(Math.random() * 20),
                additions: Math.floor(Math.random() * 100),
                deletions: Math.floor(Math.random() * 50),
                insertions: Math.floor(Math.random() * 100)
            },
            ready_to_merge: i % 5 === 0
        },
        terminals: [`session-${i}-top`, `session-${i}-bottom`, `session-${i}-right`]
    }))
}

describe('Session Switching Performance', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
    })

    it('should handle switching between many sessions efficiently', async () => {
        const mockSessions = generateMockSessions(50)
        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === 'para_core_list_enriched_sessions') {
                return mockSessions
            }
            if (cmd === 'get_current_directory') {
                return '/test/dir'
            }
            if (cmd === 'terminal_exists') {
                return true
            }
            if (cmd === 'create_terminal') {
                return undefined
            }
            return undefined
        })

        const TestWrapper = ({ children }: { children: React.ReactNode }) => (
            <ProjectProvider>
                <SelectionProvider>
                    <FocusProvider>
                        {children}
                    </FocusProvider>
                </SelectionProvider>
            </ProjectProvider>
        )

        const startTime = performance.now()
        
        render(
            <TestWrapper>
                <Sidebar />
            </TestWrapper>
        )

        await waitFor(() => {
            expect(screen.getByText('session-0')).toBeInTheDocument()
        })

        performance.now() - startTime // Track initial load time

        const session10Button = screen.getByText('session-10').closest('button')
        expect(session10Button).toBeInTheDocument()

        const switchStartTime = performance.now()
        fireEvent.click(session10Button!)
        
        // Wait a moment for the click to process
        await new Promise(resolve => setTimeout(resolve, 100))

        const switchTime = performance.now() - switchStartTime

        expect(switchTime).toBeLessThan(500)

        const session25Button = screen.getByText('session-25').closest('button')
        const secondSwitchStart = performance.now()
        fireEvent.click(session25Button!)
        
        // Wait a moment for the click to process  
        await new Promise(resolve => setTimeout(resolve, 100))

        const secondSwitchTime = performance.now() - secondSwitchStart

        expect(secondSwitchTime).toBeLessThan(200)
    })

    it('should memoize sorted sessions properly', async () => {
        const mockSessions = generateMockSessions(30)
        let invokeCallCount = 0
        
        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === 'para_core_list_enriched_sessions') {
                invokeCallCount++
                return mockSessions
            }
            if (cmd === 'get_current_directory') {
                return '/test/dir'
            }
            if (cmd === 'terminal_exists') {
                return true
            }
            return undefined
        })

        const { rerender } = render(
            <ProjectProvider>
                <SelectionProvider>
                    <FocusProvider>
                        <Sidebar />
                    </FocusProvider>
                </SelectionProvider>
            </ProjectProvider>
        )

        await waitFor(() => {
            expect(screen.getByText('session-0')).toBeInTheDocument()
        })

        // Force re-render without changing data
        rerender(
            <ProjectProvider>
                <SelectionProvider>
                    <FocusProvider>
                        <Sidebar />
                    </FocusProvider>
                </SelectionProvider>
            </ProjectProvider>
        )

        // Sessions should only be loaded once
        expect(invokeCallCount).toBe(1)
        
        // All sessions should still be rendered
        expect(screen.getByText('session-0')).toBeInTheDocument()
        expect(screen.getByText('session-29')).toBeInTheDocument()
    })
})