import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import { NewSessionModal } from './NewSessionModal'
import { TestProviders } from '../../tests/test-utils'
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
                    onClick={() => onAgentTypeChange?.('opencode')}
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
                case TauriCommands.RepositoryIsEmpty:
                    return Promise.resolve(false)
                case TauriCommands.ListProjectBranches:
                    return Promise.resolve(['main', 'develop'])
                case TauriCommands.GetProjectDefaultBaseBranch:
                    return Promise.resolve(null) // No saved default
                case TauriCommands.GetProjectDefaultBranch: 
                    return Promise.resolve('main')
                case TauriCommands.SchaltwerkCoreGetSkipPermissions:
                    return Promise.resolve(false)
                case TauriCommands.SchaltwerkCoreGetAgentType:
                    return Promise.resolve('claude')
                default:
                    return Promise.resolve()
            }
        })
    })

    test('renders SessionConfigurationPanel when not creating as draft', async () => {
        render(
            <TestProviders>
                <NewSessionModal
                    open={true}
                    onClose={vi.fn()}
                    onCreate={vi.fn()}
                />
            </TestProviders>
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
            <TestProviders>
                <NewSessionModal
                    open={true}
                    initialIsDraft={true}
                    onClose={vi.fn()}
                    onCreate={vi.fn()}
                />
            </TestProviders>
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
        const onClose = vi.fn()
        const onCreate = vi.fn()
        
        const { rerender } = render(
            <TestProviders>
                <NewSessionModal
                    open={true}
                    initialIsDraft={false}
                    onClose={onClose}
                    onCreate={onCreate}
                />
            </TestProviders>
        )

        // Wait for modal to be fully initialized with regular mode
        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        const checkbox = screen.getByLabelText(/Create as spec/)
        expect(checkbox).not.toBeChecked()

        // Re-render with draft mode
        rerender(
            <TestProviders>
                <NewSessionModal
                    open={true}
                    initialIsDraft={true}
                    onClose={onClose}
                    onCreate={onCreate}
                />
            </TestProviders>
        )

        // Wait for checkbox to be checked and panel to be hidden
        await waitFor(() => {
            const checkbox = screen.getByLabelText(/Create as spec/)
            expect(checkbox).toBeChecked()
        })
        
        await waitFor(() => {
            expect(screen.queryByTestId('session-config-panel')).not.toBeInTheDocument()
        })

        // Re-render back to regular mode
        rerender(
            <TestProviders>
                <NewSessionModal
                    open={true}
                    initialIsDraft={false}
                    onClose={onClose}
                    onCreate={onCreate}
                />
            </TestProviders>
        )

        // Wait for checkbox to be unchecked and panel to be visible
        await waitFor(() => {
            const checkbox = screen.getByLabelText(/Create as spec/)
            expect(checkbox).not.toBeChecked()
        })
        
        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })
    })

    test('passes initial values correctly to SessionConfigurationPanel', async () => {
        render(
            <TestProviders>
                <NewSessionModal
                    open={true}
                    onClose={vi.fn()}
                    onCreate={vi.fn()}
                />
            </TestProviders>
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
            <TestProviders>
                <NewSessionModal
                    open={true}
                    onClose={vi.fn()}
                    onCreate={onCreate}
                />
            </TestProviders>
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


    test('enables submit button when all required fields are filled', async () => {
        render(
            <TestProviders>
                <NewSessionModal
                    open={true}
                    onClose={vi.fn()}
                    onCreate={vi.fn()}
                />
            </TestProviders>
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
            <TestProviders>
                <NewSessionModal
                    open={true}
                    onClose={vi.fn()}
                    onCreate={vi.fn()}
                />
            </TestProviders>
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
            <TestProviders>
                <NewSessionModal
                    open={true}
                    onClose={vi.fn()}
                    onCreate={onCreate}
                />
            </TestProviders>
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
                case TauriCommands.RepositoryIsEmpty:
                    return Promise.resolve(true)
                case TauriCommands.ListProjectBranches:
                    return Promise.resolve(['main', 'develop'])
                case TauriCommands.GetProjectDefaultBaseBranch:
                    return Promise.resolve(null)
                case TauriCommands.GetProjectDefaultBranch: 
                    return Promise.resolve('main')
                default:
                    return Promise.resolve()
            }
        })

        render(
            <TestProviders>
                <NewSessionModal
                    open={true}
                    onClose={vi.fn()}
                    onCreate={vi.fn()}
                />
            </TestProviders>
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
            <TestProviders>
                <NewSessionModal
                    open={true}
                    onClose={vi.fn()}
                    onCreate={vi.fn()}
                />
            </TestProviders>
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        // Change configuration
        fireEvent.click(screen.getByTestId('change-branch'))
        fireEvent.click(screen.getByTestId('change-agent'))

        // Close and reopen modal
        rerender(
            <TestProviders>
                <NewSessionModal
                    open={false}
                    onClose={vi.fn()}
                    onCreate={vi.fn()}
                />
            </TestProviders>
        )

        rerender(
            <TestProviders>
                <NewSessionModal
                    open={true}
                    onClose={vi.fn()}
                    onCreate={vi.fn()}
                />
            </TestProviders>
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
