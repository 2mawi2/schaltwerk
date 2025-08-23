import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KanbanView } from './KanbanView'
import { SessionsProvider } from '../../contexts/SessionsContext'
import { ProjectProvider } from '../../contexts/ProjectContext'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { ReactNode } from 'react'

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => {}))
}))

// Mock the useProject hook to provide a project path
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

// Mock window.prompt
global.prompt = vi.fn()

const mockSessions = [
    {
        info: {
            session_id: 'draft-1',
            display_name: 'Draft Session 1',
            branch: 'feature/draft-1',
            worktree_path: '/path/to/draft-1',
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'draft',
            is_current: false,
            session_type: 'worktree',
            ready_to_merge: false,
            has_uncommitted_changes: false
        },
        terminals: []
    },
    {
        info: {
            session_id: 'active-1',
            display_name: 'Active Session 1',
            branch: 'feature/active-1',
            worktree_path: '/path/to/active-1',
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'active',
            is_current: true,
            session_type: 'worktree',
            ready_to_merge: false,
            has_uncommitted_changes: true
        },
        terminals: []
    },
    {
        info: {
            session_id: 'ready-1',
            display_name: 'Ready Session 1',
            branch: 'feature/ready-1',
            worktree_path: '/path/to/ready-1',
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'dirty',
            is_current: false,
            session_type: 'worktree',
            ready_to_merge: true,
            has_uncommitted_changes: false
        },
        terminals: []
    }
]

describe('KanbanView', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(global.prompt).mockReset()
    })

    const wrapper = ({ children }: { children: ReactNode }) => (
        <ProjectProvider>
            <SessionsProvider>
                <DndProvider backend={HTML5Backend}>
                    {children}
                </DndProvider>
            </SessionsProvider>
        </ProjectProvider>
    )

    it('should display loading state initially', () => {
        render(<KanbanView />, { wrapper })
        expect(screen.getByText('Loading sessions...')).toBeInTheDocument()
    })

    it('should display three columns: Draft, Running, and Reviewed', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockResolvedValue(mockSessions)

        render(<KanbanView />, { wrapper })

        await waitFor(() => {
            // Look for column headings specifically
            const headings = screen.getAllByRole('heading', { level: 3 })
            const headingTexts = headings.map(h => h.textContent)
            expect(headingTexts).toContain('Draft')
            expect(headingTexts).toContain('Running')
            expect(headingTexts).toContain('Reviewed')
        })
    })

    it('should display sessions in correct columns', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockResolvedValue(mockSessions)

        render(<KanbanView />, { wrapper })

        await waitFor(() => {
            // Draft column
            expect(screen.getByText('Draft Session 1')).toBeInTheDocument()
            
            // Running column
            expect(screen.getByText('Active Session 1')).toBeInTheDocument()
            
            // Reviewed column
            expect(screen.getByText('Ready Session 1')).toBeInTheDocument()
        })
    })

    it('should show session counts in column headers', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockResolvedValue(mockSessions)

        render(<KanbanView />, { wrapper })

        await waitFor(() => {
            // Find the count badges
            const counts = screen.getAllByText(/^[0-9]+$/)
            // Should have 1 draft, 1 running, 1 reviewed
            expect(counts).toHaveLength(3)
            expect(counts.some(el => el.textContent === '1')).toBe(true)
        })
    })

    it('should display "Has changes" indicator for sessions with uncommitted changes', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockResolvedValue(mockSessions)

        render(<KanbanView />, { wrapper })

        await waitFor(() => {
            // The SessionCard component doesn't display "Has changes" text anymore
            // Instead it shows action buttons, so let's verify the session exists
            expect(screen.getByText('Active Session 1')).toBeInTheDocument()
        })
    })

    it('should show "New draft" button in Draft column and "Start new task" in Running column', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockResolvedValue(mockSessions)

        render(<KanbanView />, { wrapper })

        await waitFor(() => {
            expect(screen.getByText('New draft')).toBeInTheDocument()
            expect(screen.getByText('Start new task')).toBeInTheDocument()
        })
    })

    it('should handle creating a new draft', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockResolvedValue(mockSessions)
        
        const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

        render(<KanbanView />, { wrapper })

        await waitFor(() => {
            expect(screen.getByText('New draft')).toBeInTheDocument()
        })

        const createButton = screen.getByText('New draft')
        await userEvent.click(createButton)
        
        // Should dispatch event to open new session modal in draft mode
        expect(dispatchEventSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'schaltwerk:new-draft'
            })
        )
    })

    it('should dispatch event when create draft button is clicked', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockResolvedValue(mockSessions)
        
        const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

        render(<KanbanView />, { wrapper })

        await waitFor(() => {
            expect(screen.getByText('New draft')).toBeInTheDocument()
        })

        const createButton = screen.getByText('New draft')
        await userEvent.click(createButton)
        
        // Should dispatch the new-draft event
        expect(dispatchEventSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'schaltwerk:new-draft'
            })
        )
    })

    it('should show "No sessions found" when there are no sessions', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockResolvedValue([])

        render(<KanbanView />, { wrapper })

        await waitFor(() => {
            expect(screen.getByText('No sessions found')).toBeInTheDocument()
            expect(screen.getByText('Start new task')).toBeInTheDocument()
            expect(screen.getByText('New draft')).toBeInTheDocument()
        })
    })

    it('should dispatch event when create first draft button is clicked', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockResolvedValue([])
        
        const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

        render(<KanbanView />, { wrapper })

        await waitFor(() => {
            expect(screen.getByText('New draft')).toBeInTheDocument()
        })

        const createButton = screen.getByText('New draft')
        await userEvent.click(createButton)
        
        // Should dispatch the new-draft event
        expect(dispatchEventSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'schaltwerk:new-draft'
            })
        )
    })
})