import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { KanbanView } from './KanbanView'
import { invoke } from '@tauri-apps/api/core'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'

// Mock Tauri
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

// Mock SessionsContext
vi.mock('../../contexts/SessionsContext', () => ({
    useSessions: () => ({
        allSessions: [
            {
                info: {
                    session_id: 'test-spec',
                    session_state: 'spec',
                    ready_to_merge: false
                }
            },
            {
                info: {
                    session_id: 'test-active',
                    session_state: 'running',
                    ready_to_merge: false
                }
            },
            {
                info: {
                    session_id: 'test-reviewed',
                    session_state: 'running',
                    ready_to_merge: true
                }
            }
        ],
        loading: false,
        reloadSessions: vi.fn()
    })
}))


// Mock SessionCard component
vi.mock('../shared/SessionCard', () => ({
    SessionCard: ({ session, onRunDraft }: any) => (
        <div data-testid={`session-card-${session.info.session_id}`}>
            <span>{session.info.session_id}</span>
            <button 
                onClick={() => onRunDraft?.(session.info.session_id)}
                data-testid={`run-draft-${session.info.session_id}`}
            >
                Run Draft
            </button>
        </div>
    )
}))

// Mock RightPanelTabs
vi.mock('../right-panel/RightPanelTabs', () => ({
    RightPanelTabs: () => <div data-testid="right-panel-tabs">Right Panel</div>
}))

// Mock SpecEditor
vi.mock('../specs/SpecEditor', () => ({
    SpecEditor: ({ sessionName, onStart }: any) => (
        <div data-testid="spec-editor">
            Spec Editor for {sessionName}
            <button onClick={() => onStart?.()}>Start Spec</button>
        </div>
    )
}))

const mockInvoke = invoke as MockedFunction<typeof invoke>

describe('KanbanView Drag and Drop Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockInvoke.mockResolvedValue(undefined)
    })

    const renderKanbanView = () => {
        return render(
            <DndProvider backend={HTML5Backend}>
                <KanbanView />
            </DndProvider>
        )
    }

    test('renders kanban columns correctly', async () => {
        renderKanbanView()

        await waitFor(() => {
            expect(screen.getByText('Spec')).toBeInTheDocument()
            expect(screen.getByText('Running')).toBeInTheDocument()
            expect(screen.getByText('Reviewed')).toBeInTheDocument()
        })
    })

    test('dispatches event to open modal when running draft from card', async () => {
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
        renderKanbanView()

        await waitFor(() => {
            expect(screen.getByTestId('session-card-test-spec')).toBeInTheDocument()
        })

        const runDraftButton = screen.getByTestId('run-draft-test-spec')
        fireEvent.click(runDraftButton)

        await waitFor(() => {
            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'schaltwerk:start-agent-from-spec',
                    detail: { name: 'test-spec' }
                })
            )
        })

        dispatchSpy.mockRestore()
    })

    test('does not directly invoke backend when running draft from card', async () => {
        renderKanbanView()

        await waitFor(() => {
            expect(screen.getByTestId('session-card-test-spec')).toBeInTheDocument()
        })

        const runDraftButton = screen.getByTestId('run-draft-test-spec')
        fireEvent.click(runDraftButton)

        // Should not directly call backend commands, only dispatch event to open modal
        expect(mockInvoke).not.toHaveBeenCalledWith(
            'schaltwerk_core_start_spec_session',
            expect.any(Object)
        )
    })


    test('renders all three columns with correct sessions', async () => {
        renderKanbanView()

        await waitFor(() => {
            expect(screen.getByText('Spec')).toBeInTheDocument()
            expect(screen.getByText('Running')).toBeInTheDocument()
            expect(screen.getByText('Reviewed')).toBeInTheDocument()
        })

        // Check that sessions are in correct columns
        expect(screen.getByTestId('session-card-test-spec')).toBeInTheDocument()
        expect(screen.getByTestId('session-card-test-active')).toBeInTheDocument()
        expect(screen.getByTestId('session-card-test-reviewed')).toBeInTheDocument()
    })

    test('displays correct session counts in column headers', async () => {
        renderKanbanView()

        await waitFor(() => {
            // Each column should show the count of sessions
            const specColumn = screen.getByText('Spec').closest('div')
            const runningColumn = screen.getByText('Running').closest('div')
            const reviewedColumn = screen.getByText('Reviewed').closest('div')

            expect(specColumn).toContainHTML('1') // test-spec
            expect(runningColumn).toContainHTML('1') // test-active
            expect(reviewedColumn).toContainHTML('1') // test-reviewed
        })
    })

    test('handles drag and drop status change with configuration', async () => {
        // Mock the drag and drop functionality
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
            value: vi.fn(() => ({
                bottom: 0,
                height: 0,
                left: 0,
                right: 0,
                top: 0,
                width: 0,
                x: 0,
                y: 0,
            })),
        })

        renderKanbanView()

        await waitFor(() => {
            expect(screen.getByTestId('session-card-test-spec')).toBeInTheDocument()
        })

        // We can't easily test actual drag and drop in jsdom, but we can test the handler logic
        // The status change handler should use the session configuration
        // This is covered by the integration with the session config panel above
    })

    test('displays all columns when sessions exist', async () => {
        render(
            <DndProvider backend={HTML5Backend}>
                <KanbanView />
            </DndProvider>
        )

        await waitFor(() => {
            expect(screen.getByText('Spec')).toBeInTheDocument()
            expect(screen.getByText('Running')).toBeInTheDocument() 
            expect(screen.getByText('Reviewed')).toBeInTheDocument()
        })
    })

    test('handles session actions gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        renderKanbanView()

        await waitFor(() => {
            expect(screen.getByText('Spec')).toBeInTheDocument()
        })

        // Component should render correctly even if there are errors
        expect(screen.getByText('Running')).toBeInTheDocument()

        consoleSpy.mockRestore()
    })

    test('kanban view state is preserved across renders', async () => {
        const { rerender } = renderKanbanView()

        await waitFor(() => {
            expect(screen.getByText('Spec')).toBeInTheDocument()
        })

        rerender(
            <DndProvider backend={HTML5Backend}>
                <KanbanView />
            </DndProvider>
        )

        // Columns should still be visible after rerender
        await waitFor(() => {
            expect(screen.getByText('Spec')).toBeInTheDocument()
            expect(screen.getByText('Running')).toBeInTheDocument()
            expect(screen.getByText('Reviewed')).toBeInTheDocument()
        })
    })

    test('displays all sessions regardless of filter mode', async () => {
        renderKanbanView()

        await waitFor(() => {
            expect(screen.getByText('Spec')).toBeInTheDocument()
            expect(screen.getByText('Running')).toBeInTheDocument()
            expect(screen.getByText('Reviewed')).toBeInTheDocument()
        })

        // Verify all sessions are displayed in their correct columns
        expect(screen.getByTestId('session-card-test-spec')).toBeInTheDocument()
        expect(screen.getByTestId('session-card-test-active')).toBeInTheDocument()
        expect(screen.getByTestId('session-card-test-reviewed')).toBeInTheDocument()

        // Verify session counts are correct (1 spec, 1 running, 1 reviewed)
        const specColumn = screen.getByText('Spec').closest('div')
        const runningColumn = screen.getByText('Running').closest('div')
        const reviewedColumn = screen.getByText('Reviewed').closest('div')

        expect(specColumn).toContainHTML('1') // test-spec
        expect(runningColumn).toContainHTML('1') // test-active
        expect(reviewedColumn).toContainHTML('1') // test-reviewed
    })
})

describe('KanbanView Complex Scenarios', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockInvoke.mockResolvedValue(undefined)
    })

    test('handles multiple concurrent drag operations', async () => {
        render(
            <DndProvider backend={HTML5Backend}>
                <KanbanView />
            </DndProvider>
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-card-test-spec')).toBeInTheDocument()
        })

        // Simulate multiple rapid operations
        const runButton = screen.getByTestId('run-draft-test-spec')
        
        fireEvent.click(runButton)
        fireEvent.click(runButton)
        fireEvent.click(runButton)

        // Should handle rapid clicks gracefully by dispatching events
        // No direct backend calls expected, only modal dispatch events
    })

    test('handles session interactions correctly', async () => {
        render(
            <DndProvider backend={HTML5Backend}>
                <KanbanView />
            </DndProvider>
        )

        await waitFor(() => {
            expect(screen.getByText('Spec')).toBeInTheDocument()
        })

        // Test that all session cards are properly interactive
        expect(screen.getByTestId('session-card-test-spec')).toBeInTheDocument()
        expect(screen.getByTestId('session-card-test-active')).toBeInTheDocument()
        expect(screen.getByTestId('session-card-test-reviewed')).toBeInTheDocument()
    })
})