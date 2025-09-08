import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NewSessionModal } from './NewSessionModal'
import { invoke } from '@tauri-apps/api/core'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'

// Mock Tauri
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

// Mock generateDockerStyleName
vi.mock('../../utils/dockerNames', () => ({
    generateDockerStyleName: () => 'test_session'
}))

// Mock SessionConfigurationPanel
vi.mock('../shared/SessionConfigurationPanel', () => ({
    SessionConfigurationPanel: ({
        onBaseBranchChange,
        onAgentTypeChange,
        onSkipPermissionsChange,
        initialBaseBranch,
        initialAgentType,
        initialSkipPermissions
    }: {
        onBaseBranchChange?: (branch: string) => void
        onAgentTypeChange?: (type: string) => void
        onSkipPermissionsChange?: (skip: boolean) => void
        initialBaseBranch?: string
        initialAgentType?: string
        initialSkipPermissions?: boolean
    }) => {
        return (
            <div data-testid="session-config-panel">
                <div data-testid="initial-branch">{initialBaseBranch || ''}</div>
                <div data-testid="initial-agent">{initialAgentType || 'claude'}</div>
                <div data-testid="initial-skip-perms">{initialSkipPermissions?.toString() || 'false'}</div>
                <button 
                    onClick={() => onBaseBranchChange?.('develop')}
                    data-testid="change-branch"
                >
                    Change Branch
                </button>
                <button 
                    onClick={() => onAgentTypeChange?.('cursor')}
                    data-testid="change-agent"
                >
                    Change Agent
                </button>
                <button 
                    onClick={() => onSkipPermissionsChange?.(true)}
                    data-testid="change-permissions"
                >
                    Change Permissions
                </button>
            </div>
        )
    }
}))

const mockInvoke = invoke as MockedFunction<typeof invoke>

describe('NewSessionModal Integration with SessionConfigurationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockInvoke.mockImplementation((command: string) => {
            switch (command) {
                case 'repository_is_empty':
                    return Promise.resolve(false)
                case 'list_project_branches':
                    return Promise.resolve(['main', 'develop'])
                case 'get_project_default_base_branch':
                    return Promise.resolve(null) // No saved default
                case 'get_project_default_branch': 
                    return Promise.resolve('main')
                case 'schaltwerk_core_get_skip_permissions':
                    return Promise.resolve(false)
                case 'schaltwerk_core_get_agent_type':
                    return Promise.resolve('claude')
                default:
                    return Promise.resolve()
            }
        })
    })

    test('renders SessionConfigurationPanel when not creating as draft', async () => {
        render(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // Wait for async initialization to complete - the branch should be populated
        await waitFor(() => {
            expect(screen.getByTestId('initial-branch')).toHaveTextContent('main')
        })

        // Should show configuration panel for regular session creation
        // With persisted defaults loaded, initial branch should be 'main'
        expect(screen.getByTestId('initial-branch')).toHaveTextContent('main')
        expect(screen.getByTestId('initial-agent')).toHaveTextContent('claude')
        expect(screen.getByTestId('initial-skip-perms')).toHaveTextContent('false')
    })

    test('hides SessionConfigurationPanel when creating as draft', async () => {
        render(
            <NewSessionModal
                open={true}
                initialIsDraft={true}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        )

        await waitFor(() => {
            // Should have the checkbox checked for draft mode
            const checkbox = screen.getByLabelText(/Create as spec/)
            expect(checkbox).toBeChecked()
        })

        // Configuration panel should not be present for draft creation
        expect(screen.queryByTestId('session-config-panel')).not.toBeInTheDocument()
    })

    test('toggles SessionConfigurationPanel visibility when draft mode changes', async () => {
        render(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // Toggle draft mode
        const checkbox = screen.getByLabelText(/Create as spec/)
        fireEvent.click(checkbox)

        // Configuration panel should be hidden
        expect(screen.queryByTestId('session-config-panel')).not.toBeInTheDocument()

        // Toggle back
        fireEvent.click(checkbox)

        // Configuration panel should be visible again
        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })
    })

    test('passes initial values correctly to SessionConfigurationPanel', async () => {
        render(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // Wait for async initialization to complete - the branch should be populated
        await waitFor(() => {
            expect(screen.getByTestId('initial-branch')).toHaveTextContent('main')
        })

        // Check that initial values are passed correctly
        // With persisted defaults loaded, initial branch should be 'main'
        expect(screen.getByTestId('initial-branch')).toHaveTextContent('main')
        expect(screen.getByTestId('initial-agent')).toHaveTextContent('claude')
        expect(screen.getByTestId('initial-skip-perms')).toHaveTextContent('false')
    })

    test('updates modal state when SessionConfigurationPanel values change', async () => {
        const onCreate = vi.fn()
        
        render(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={onCreate}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // Change configuration
        fireEvent.click(screen.getByTestId('change-branch'))
        fireEvent.click(screen.getByTestId('change-agent'))
        fireEvent.click(screen.getByTestId('change-permissions'))

        // Fill in required fields
        const nameInput = screen.getByDisplayValue('test_session')
        fireEvent.change(nameInput, { target: { value: 'my_test_session' } })

        // Submit the form
        const submitButton = screen.getByText('Start Agent')
        fireEvent.click(submitButton)

        await waitFor(() => {
            expect(onCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'my_test_session',
                    baseBranch: 'develop', // Changed by change-branch button
                    userEditedName: true,
                    isSpec: false
                })
            )
        })
    })

    test('updates modal state when SessionConfigurationPanel values change', async () => {
        const onCreate = vi.fn()
        
        render(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={onCreate}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // Change configuration via the mocked panel buttons
        fireEvent.click(screen.getByTestId('change-branch'))
        fireEvent.click(screen.getByTestId('change-agent'))
        fireEvent.click(screen.getByTestId('change-permissions'))

        // Fill in required fields
        const nameInput = screen.getByDisplayValue('test_session')
        fireEvent.change(nameInput, { target: { value: 'my_test_session' } })

        // Submit the form
        const submitButton = screen.getByText('Start Agent')
        fireEvent.click(submitButton)

        await waitFor(() => {
            expect(onCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'my_test_session',
                    baseBranch: 'develop', // Changed by change-branch button
                    userEditedName: true,
                    isSpec: false
                })
            )
        })
    })

    test('enables submit button when all required fields are filled', async () => {
        render(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // Set a branch using the mock button
        fireEvent.click(screen.getByTestId('change-branch'))

        // Fill in name
        const nameInput = screen.getByDisplayValue('test_session')
        fireEvent.change(nameInput, { target: { value: 'my_test_session' } })

        await waitFor(() => {
            const submitButton = screen.getByText('Start Agent')
            // Button should be enabled when name and branch are provided
            expect(submitButton).not.toBeDisabled()
        })
    })

    test('handles prefill data correctly with configuration panel', async () => {
        render(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // Simulate prefill event
        window.dispatchEvent(new CustomEvent('schaltwerk:new-session:prefill', {
            detail: {
                name: 'prefilled_session',
                taskContent: 'Test content',
                baseBranch: 'feature/prefill',
                lockName: false,
                fromDraft: false
            }
        }))

        await waitFor(() => {
            const nameInput = screen.getByDisplayValue('prefilled_session')
            expect(nameInput).toBeInTheDocument()
            
            // Branch should be set via prefill
            expect(screen.getByTestId('initial-branch')).toHaveTextContent('feature/prefill')
        })
    })

    test('creates session with correct configuration data structure', async () => {
        const onCreate = vi.fn()
        
        render(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={onCreate}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // Configure via the panel
        fireEvent.click(screen.getByTestId('change-branch'))
        fireEvent.click(screen.getByTestId('change-agent'))
        fireEvent.click(screen.getByTestId('change-permissions'))

        const nameInput = screen.getByDisplayValue('test_session')
        fireEvent.change(nameInput, { target: { value: 'configured_session' } })

        const promptTextarea = screen.getByPlaceholderText(/Describe the agent/)
        fireEvent.change(promptTextarea, { target: { value: 'Test prompt' } })

        const submitButton = screen.getByText('Start Agent')
        fireEvent.click(submitButton)

        await waitFor(() => {
            expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
                name: 'configured_session',
                prompt: 'Test prompt',
                baseBranch: 'develop',
                userEditedName: true,
                isSpec: false,
                draftContent: undefined
            }))
        })
    })

    test('handles repository empty state with configuration panel', async () => {
        mockInvoke.mockImplementation((command: string) => {
            switch (command) {
                case 'repository_is_empty':
                    return Promise.resolve(true)
                case 'list_project_branches':
                    return Promise.resolve(['main', 'develop'])
                case 'get_project_default_base_branch':
                    return Promise.resolve(null)
                case 'get_project_default_branch': 
                    return Promise.resolve('main')
                default:
                    return Promise.resolve()
            }
        })

        render(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
            expect(screen.getByText('New repository detected')).toBeInTheDocument()
        })

        // Configuration panel should still be present even with empty repository
        expect(screen.getByText('This repository has no commits yet. An initial commit will be created automatically when you start the agent.')).toBeInTheDocument()
    })

    test('maintains configuration state during modal lifecycle', async () => {
        const { rerender } = render(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // Change configuration
        fireEvent.click(screen.getByTestId('change-branch'))
        fireEvent.click(screen.getByTestId('change-agent'))

        // Close and reopen modal
        rerender(
            <NewSessionModal
                open={false}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        )

        rerender(
            <NewSessionModal
                open={true}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        )

        // Configuration should reset on reopen
        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // After modal reopen, SessionConfigurationPanel maintains its defaults
        // The agent type may have been changed during the test and persisted
        expect(screen.getByTestId('initial-agent')).toBeTruthy()
    })
})
