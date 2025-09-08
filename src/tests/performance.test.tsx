import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from '../components/sidebar/Sidebar'
import { SelectionProvider } from '../contexts/SelectionContext'
import { FocusProvider } from '../contexts/FocusContext'
import { ProjectProvider } from '../contexts/ProjectContext'
import { SessionsProvider } from '../contexts/SessionsContext'
import { FontSizeProvider } from '../contexts/FontSizeContext'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => {}))
}))

// Mock the useProject hook to provide a project path
vi.mock('../contexts/ProjectContext', async () => {
    const actual = await vi.importActual<typeof import('../contexts/ProjectContext')>('../contexts/ProjectContext')
    return {
        ...actual,
        useProject: () => ({
            projectPath: '/test/project',
            setProjectPath: vi.fn()
        })
    }
})

function generateMockSessions(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        info: {
            session_id: `session-${i}`,
            branch: `feature-${i}`,
            worktree_path: `/path/to/worktree-${i}`,
            base_branch: 'main',
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
        terminals: [`session-${i}-top`, `session-${i}-bottom`]
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
            if (cmd === 'schaltwerk_core_list_enriched_sessions') {
                return mockSessions
            }
            if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') {
                return mockSessions
            }
            if (cmd === 'schaltwerk_core_list_sessions_by_state') return []
            if (cmd === 'get_current_directory') {
                return '/test/dir'
            }
            if (cmd === 'get_project_sessions_settings') {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            if (cmd === 'list_available_open_apps') return [{ id: 'finder', name: 'Finder', kind: 'system' }]
            if (cmd === 'get_default_open_app') return 'finder'
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
                <FontSizeProvider>
                    <SessionsProvider>
                        <SelectionProvider>
                            <FocusProvider>
                                {children}
                            </FocusProvider>
                        </SelectionProvider>
                    </SessionsProvider>
                </FontSizeProvider>
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

        void (performance.now() - startTime) // Track initial load time

        const session10Button = screen.getByText('session-10').closest('[role="button"]')
        expect(session10Button).toBeInTheDocument()

        const switchStartTime = performance.now()
        fireEvent.click(session10Button!)
        
        // Wait a moment for the click to process
        await new Promise(resolve => setTimeout(resolve, 100))

        const switchTime = performance.now() - switchStartTime

        expect(switchTime).toBeLessThan(500)

        const session25Button = screen.getByText('session-25').closest('[role="button"]')
        const secondSwitchStart = performance.now()
        fireEvent.click(session25Button!)
        
        // Wait a moment for the click to process  
        await new Promise(resolve => setTimeout(resolve, 100))

        const secondSwitchTime = performance.now() - secondSwitchStart

        // Allow a bit more headroom in CI and slower environments
        expect(secondSwitchTime).toBeLessThan(350)
    })

    it('should memoize sorted sessions properly', async () => {
        const mockSessions = generateMockSessions(30)
        let invokeCallCount = 0
        
        const calledCommands: string[] = []
        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === 'schaltwerk_core_list_enriched_sessions') {
                invokeCallCount++
                calledCommands.push(cmd)
                return mockSessions
            }
            if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') {
                invokeCallCount++
                calledCommands.push(cmd)
                return mockSessions
            }
            if (cmd === 'schaltwerk_core_list_sessions_by_state') return []
            if (cmd === 'get_current_directory') {
                return '/test/dir'
            }
            if (cmd === 'get_project_sessions_settings') {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            if (cmd === 'list_available_open_apps') return [{ id: 'finder', name: 'Finder', kind: 'system' }]
            if (cmd === 'get_default_open_app') return 'finder'
            if (cmd === 'terminal_exists') {
                return true
            }
            return undefined
        })

        const { rerender } = render(
            <ProjectProvider>
                <FontSizeProvider>
                    <SessionsProvider>
                        <SelectionProvider>
                            <FocusProvider>
                                <Sidebar />
                            </FocusProvider>
                        </SelectionProvider>
                    </SessionsProvider>
                </FontSizeProvider>
            </ProjectProvider>
        )

        await waitFor(() => {
            expect(screen.getByText('session-0')).toBeInTheDocument()
        })

        // Force re-render without changing data
        rerender(
            <ProjectProvider>
                <FontSizeProvider>
                    <SessionsProvider>
                        <SelectionProvider>
                            <FocusProvider>
                                <Sidebar />
                            </FocusProvider>
                        </SelectionProvider>
                    </SessionsProvider>
                </FontSizeProvider>
            </ProjectProvider>
        )

        // Debug: log what commands were actually called
        console.log('Called commands:', calledCommands)
        
        // With unified SessionsContext, sessions are loaded limited times
        // Account for potential migration where both old and new APIs might be called
        expect(invokeCallCount).toBeLessThanOrEqual(2)
        
        // All sessions should still be rendered
        expect(screen.getByText('session-0')).toBeInTheDocument()
        expect(screen.getByText('session-29')).toBeInTheDocument()
    })
})
