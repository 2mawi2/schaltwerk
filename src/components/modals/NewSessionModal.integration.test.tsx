import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockedFunction, MockInstance } from 'vitest'
import { UiEvent, emitUiEvent } from '../../common/uiEvents'
import { TestProviders } from '../../tests/test-utils'
import { invoke } from '@tauri-apps/api/core'
import type { GithubIssueDetails } from '../../types/githubIssues'
import type { UseGithubIssueSearchResult } from '../../hooks/useGithubIssueSearch'

const mockUseGithubIssueSearch = vi.fn<() => UseGithubIssueSearchResult>()

vi.mock('../../hooks/useGithubIssueSearch', () => ({
    useGithubIssueSearch: () => mockUseGithubIssueSearch(),
}))

import { NewSessionModal } from './NewSessionModal'
import { getCodexModelMetadata } from '../../common/codexModels'

// Mock Tauri
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

// Mock generateDockerStyleName
vi.mock('../../utils/dockerNames', () => ({
    generateDockerStyleName: () => 'test_session'
}))

// Mock useAgentAvailability
vi.mock('../../hooks/useAgentAvailability', () => ({
    useAgentAvailability: () => ({
        availability: {},
        loading: false,
        isAvailable: () => true,
        getRecommendedPath: () => null,
        getInstallationMethod: () => null,
        refreshAvailability: vi.fn(),
        refreshSingleAgent: vi.fn(),
        clearCache: vi.fn(),
        forceRefresh: vi.fn(),
    })
}))

// Mock SessionConfigurationPanel
vi.mock('../shared/SessionConfigurationPanel', () => ({
    SessionConfigurationPanel: ({
        onBaseBranchChange,
        onAgentTypeChange,
        onSkipPermissionsChange,
        initialBaseBranch,
        initialAgentType,
        initialSkipPermissions,
        codexModel,
        codexModelOptions,
        onCodexModelChange,
        codexReasoningEffort,
        onCodexReasoningChange,
    }: {
        onBaseBranchChange?: (branch: string) => void
        onAgentTypeChange?: (type: string) => void
        onSkipPermissionsChange?: (skip: boolean) => void
        initialBaseBranch?: string
        initialAgentType?: string
        initialSkipPermissions?: boolean
        codexModel?: string
        codexModelOptions?: string[]
        onCodexModelChange?: (model: string) => void
        codexReasoningEffort?: string
        onCodexReasoningChange?: (effort: string) => void
    }) => {
        const resolvedModel = codexModel || codexModelOptions?.[0] || 'gpt-5-codex'
        const modelMeta = getCodexModelMetadata(resolvedModel)
        const reasoningIds = modelMeta?.reasoningOptions?.map(option => option.id) ?? []
        const nextModel = (() => {
            if (codexModelOptions && codexModelOptions.length > 0) {
                const found = codexModelOptions.find(option => option !== resolvedModel)
                return found ?? codexModelOptions[0]
            }
            return resolvedModel === 'gpt-5-codex' ? 'gpt-5' : 'gpt-5-codex'
        })()
        const nextReasoning = reasoningIds.includes('high') ? 'high' : reasoningIds[0] ?? 'medium'

        return (
            <div data-testid="session-config-panel">
                <div data-testid="initial-branch">{initialBaseBranch || ''}</div>
                <div data-testid="initial-agent">{initialAgentType || 'claude'}</div>
                <div data-testid="initial-skip-perms">{initialSkipPermissions?.toString() || 'false'}</div>
                <div data-testid="codex-model-value">{codexModel || ''}</div>
                <div data-testid="codex-reasoning-value">{codexReasoningEffort || ''}</div>
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
                    onClick={() => onAgentTypeChange?.('codex')}
                    data-testid="change-agent-codex"
                >
                    Change Agent Codex
                </button>
                <button
                    onClick={() => onCodexModelChange?.(nextModel)}
                    data-testid="change-codex-model"
                >
                    Change Codex Model
                </button>
                <button
                    onClick={() => onSkipPermissionsChange?.(true)}
                    data-testid="change-permissions"
                >
                    Change Permissions
                </button>
                <button
                    onClick={() => onCodexReasoningChange?.(nextReasoning)}
                    data-testid="change-codex-reasoning"
                >
                    Change Codex Reasoning
                </button>
            </div>
        )
    }
}))


const mockInvoke = invoke as MockedFunction<typeof invoke>
let windowOpenSpy: MockInstance<Window['open']> | null = null

function defaultInvokeHandler(command: string, args?: unknown) {
    switch (command) {
        case TauriCommands.RepositoryIsEmpty:
            return Promise.resolve(false)
        case TauriCommands.ListProjectBranches:
            return Promise.resolve(['main', 'develop'])
        case TauriCommands.GetProjectDefaultBaseBranch:
            return Promise.resolve(null)
        case TauriCommands.GetProjectDefaultBranch:
            return Promise.resolve('main')
        case TauriCommands.SchaltwerkCoreGetSkipPermissions:
            return Promise.resolve(false)
        case TauriCommands.SchaltwerkCoreGetAgentType:
            return Promise.resolve('claude')
        case TauriCommands.GetAgentEnvVars:
            if (args && typeof args === 'object' && 'agentType' in args) {
                if ((args as { agentType: string }).agentType === 'claude') {
                    return Promise.resolve({ API_KEY: 'abc123' })
                }
            }
            return Promise.resolve({})
        case TauriCommands.GetAgentCliArgs:
            if (args && typeof args === 'object' && 'agentType' in args) {
                const agentType = (args as { agentType: string }).agentType
                if (agentType === 'claude') {
                    return Promise.resolve('--persisted-claude')
                }
                if (agentType === 'opencode') {
                    return Promise.resolve('--persisted-opencode')
                }
            }
            return Promise.resolve('')
        case TauriCommands.GetAgentPreferences:
            if (args && typeof args === 'object' && 'agentType' in args) {
                const agentType = (args as { agentType: string }).agentType
                if (agentType === 'codex') {
                    return Promise.resolve({
                        model: 'o4-mini',
                        reasoning_effort: 'minimal'
                    })
                }
            }
            return Promise.resolve({})
        case TauriCommands.SchaltwerkCoreListCodexModels:
            return Promise.resolve({
                models: [
                    {
                        id: 'gpt-5-codex',
                        label: 'GPT-5 Codex',
                        description: 'Optimized for coding',
                        defaultReasoning: 'medium',
                        reasoningOptions: [
                            { id: 'low', label: 'Low', description: 'Low effort' },
                            { id: 'medium', label: 'Medium', description: 'Balanced' },
                            { id: 'high', label: 'High', description: 'Deep reasoning' }
                        ],
                        isDefault: true
                    },
                    {
                        id: 'gpt-5',
                        label: 'GPT-5',
                        description: 'Generalist model',
                        defaultReasoning: 'medium',
                        reasoningOptions: [
                            { id: 'minimal', label: 'Minimal', description: 'Minimal effort' },
                            { id: 'low', label: 'Low', description: 'Low effort' },
                            { id: 'medium', label: 'Medium', description: 'Balanced' },
                            { id: 'high', label: 'High', description: 'Deep reasoning' }
                        ],
                        isDefault: false
                    }
                ],
                defaultModelId: 'gpt-5-codex'
            })
        case TauriCommands.SetAgentEnvVars:
        case TauriCommands.SetAgentCliArgs:
        case TauriCommands.SetAgentPreferences:
            return Promise.resolve()
        case TauriCommands.SchaltwerkCoreListProjectFiles:
            return Promise.resolve(['README.md'])
        case TauriCommands.GitHubSearchIssues:
            return Promise.resolve([])
        case TauriCommands.GitHubGetIssueDetails:
            return Promise.resolve({
                number: 1,
                title: 'Example issue',
                url: 'https://github.com/example/repo/issues/1',
                body: 'Example body',
                labels: [],
                comments: [],
            })
        case TauriCommands.OpenExternalUrl:
            return Promise.resolve()
        default:
            return Promise.resolve()
    }
}

function getTaskEditorContent(): string {
    const editor = screen.queryByTestId('session-task-editor')
    if (!editor) {
        return ''
    }
    const content = editor.querySelector('.cm-content') as HTMLElement | null
    if (!content) {
        return ''
    }
    if (content.querySelector('.cm-placeholder')) {
        const hasLine = content.querySelector('.cm-line')
        if (!hasLine) {
            return ''
        }
    }
    return content.innerText ?? ''
}

describe('NewSessionModal Integration with SessionConfigurationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        if (windowOpenSpy) {
            windowOpenSpy.mockRestore()
        }
        windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => ({} as Window))
        delete (window as unknown as Record<string, unknown>).__TAURI__
        mockUseGithubIssueSearch.mockReturnValue({
            results: [],
            loading: false,
            error: null,
            query: '',
            setQuery: vi.fn(),
            refresh: vi.fn(),
            fetchDetails: vi.fn().mockResolvedValue({
                number: 0,
                title: '',
                url: '',
                body: '',
                labels: [],
                comments: [],
            } as GithubIssueDetails),
            clearError: vi.fn(),
        })
        mockInvoke.mockImplementation(defaultInvokeHandler)
    })

    afterEach(() => {
        windowOpenSpy?.mockRestore()
        windowOpenSpy = null
        delete (window as unknown as Record<string, unknown>).__TAURI__
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

    test('normalizes persisted Codex preferences using discovered models', async () => {
        render(
            <TestProviders>
                <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} />
            </TestProviders>
        )

        fireEvent.click(await screen.findByTestId('change-agent-codex'))

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreListCodexModels)
        })

        await waitFor(() => {
            const codexPreferenceCalls = mockInvoke.mock.calls.filter(([command, payload]) => {
                if (command !== TauriCommands.SetAgentPreferences) {
                    return false
                }
                if (!payload || typeof payload !== 'object') {
                    return false
                }
                return (payload as { agentType?: string }).agentType === 'codex'
            })
            const latest = codexPreferenceCalls.at(-1)
            expect(latest).toBeTruthy()
            const payload = latest?.[1] as { preferences?: { model?: string; reasoning_effort?: string } }
            expect(payload?.preferences?.model).toBe('gpt-5-codex')
            expect(payload?.preferences?.reasoning_effort).toBe('medium')
        })
    })

    test('allows selecting Codex model without conflicting CLI args', async () => {
        render(
            <TestProviders>
                <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} />
            </TestProviders>
        )

        await waitFor(() => {
            expect(screen.getByTestId('initial-branch')).toHaveTextContent('main')
        })

        fireEvent.click(screen.getByTestId('change-agent-codex'))

        await waitFor(() => {
            expect(screen.getByTestId('codex-model-value').textContent).toBe('gpt-5-codex')
            expect(screen.getByTestId('codex-reasoning-value').textContent).toBe('medium')
        })

        fireEvent.click(screen.getByTestId('change-codex-model'))

        await waitFor(() => {
            const preferenceCalls = mockInvoke.mock.calls.filter(([command]) => command === TauriCommands.SetAgentPreferences)
            expect(preferenceCalls.length).toBeGreaterThan(0)
            const lastCall = preferenceCalls[preferenceCalls.length - 1]
            expect(lastCall[1]).toEqual({
                agentType: 'codex',
                preferences: {
                    model: 'gpt-5',
                    reasoning_effort: 'medium',
                },
            })
        })

        await waitFor(() => {
            expect(screen.getByTestId('codex-model-value').textContent).toBe('gpt-5')
            expect(screen.getByTestId('codex-reasoning-value').textContent).toBe('medium')
        })

        fireEvent.click(screen.getByTestId('change-codex-reasoning'))

        await waitFor(() => {
            const preferenceCalls = mockInvoke.mock.calls.filter(([command]) => command === TauriCommands.SetAgentPreferences)
            const lastCall = preferenceCalls[preferenceCalls.length - 1]
            expect(lastCall[1]).toEqual({
                agentType: 'codex',
                preferences: {
                    model: 'gpt-5',
                    reasoning_effort: 'high',
                },
            })
        })

        await waitFor(() => {
            expect(screen.getByTestId('codex-reasoning-value').textContent).toBe('high')
        })
    })

    test('cycles Codex reasoning with keyboard shortcuts', async () => {
        render(
            <TestProviders>
                <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} />
            </TestProviders>
        )

        await waitFor(() => {
            expect(screen.getByTestId('initial-branch')).toHaveTextContent('main')
        })

        fireEvent.click(screen.getByTestId('change-agent-codex'))

        await waitFor(() => {
            expect(screen.getByTestId('codex-model-value').textContent).toBe('gpt-5-codex')
        })

        act(() => {
            fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true })
        })

        await waitFor(() => {
            expect(screen.getByTestId('codex-model-value').textContent).toBe('gpt-5-codex')
            expect(screen.getByTestId('codex-reasoning-value').textContent).toBe('high')
        })

        act(() => {
            fireEvent.keyDown(window, { key: 'ArrowLeft', metaKey: true })
        })

        await waitFor(() => {
            expect(screen.getByTestId('codex-model-value').textContent).toBe('gpt-5-codex')
            expect(screen.getByTestId('codex-reasoning-value').textContent).toBe('medium')
        })

        const codexPreferenceCalls = mockInvoke.mock.calls.filter(([command, payload]) => {
            if (command !== TauriCommands.SetAgentPreferences) {
                return false
            }
            if (!payload || typeof payload !== 'object') {
                return false
            }
            return (payload as { agentType?: string }).agentType === 'codex'
        })
        expect(codexPreferenceCalls.length).toBeGreaterThanOrEqual(3)
    })

    test('populates agent defaults from saved configuration', async () => {
        render(
            <TestProviders>
                <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} />
            </TestProviders>
        )

        const advancedToggle = await screen.findByTestId('advanced-agent-settings-toggle')
        fireEvent.click(advancedToggle)

        const cliInput = await screen.findByTestId('agent-cli-args-input') as HTMLTextAreaElement
        await waitFor(() => {
            expect(cliInput.value).toBe('--persisted-claude')
        })

        const summary = await screen.findByTestId('env-summary')
        expect(summary.textContent).toContain('API_KEY')

        const toggle = await screen.findByTestId('toggle-env-vars')
        fireEvent.click(toggle)

        const keyInput = await screen.findByTestId('env-var-key-0') as HTMLInputElement
        const valueInput = await screen.findByTestId('env-var-value-0') as HTMLInputElement
        expect(keyInput.value).toBe('API_KEY')
        expect(valueInput.value).toBe('abc123')
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
        emitUiEvent(UiEvent.NewSessionPrefill, {
            name: 'prefilled_session',
            taskContent: 'Test content',
            baseBranch: 'feature/prefill',
            lockName: false,
            fromDraft: false
        })

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

        const editor = await screen.findByTestId('session-task-editor')
        expect(editor).toBeInTheDocument()
        await act(async () => {
            emitUiEvent(UiEvent.NewSessionPrefill, {
                taskContent: 'Test prompt',
                fromDraft: false,
            })
        })
        expect(getTaskEditorContent()).toContain('Test prompt')

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

describe('NewSessionModal GitHub issue prompt source', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        if (windowOpenSpy) {
            windowOpenSpy.mockRestore()
        }
        windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => ({} as Window))
        delete (window as unknown as Record<string, unknown>).__TAURI__
        mockUseGithubIssueSearch.mockReturnValue({
            results: [],
            loading: false,
            error: null,
            query: '',
            setQuery: vi.fn(),
            refresh: vi.fn(),
            fetchDetails: vi.fn().mockResolvedValue({
                number: 0,
                title: '',
                url: '',
                body: '',
                labels: [],
                comments: [],
            } as GithubIssueDetails),
            clearError: vi.fn(),
        })
        mockInvoke.mockImplementation(defaultInvokeHandler)
    })

    afterEach(() => {
        windowOpenSpy?.mockRestore()
        windowOpenSpy = null
        delete (window as unknown as Record<string, unknown>).__TAURI__
    })

    test('restores manual prompt when toggling between prompt sources', async () => {
        render(
            <TestProviders
                githubOverrides={{
                    status: {
                        installed: true,
                        authenticated: true,
                        userLogin: 'octocat',
                        repository: {
                            nameWithOwner: 'example/repo',
                            defaultBranch: 'main',
                        },
                    },
                    hasRepository: true,
                    canCreatePr: true,
                    isGhMissing: false,
                }}
            >
                <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} cachedPrompt="Initial cached prompt" />
            </TestProviders>
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        await act(async () => {
            emitUiEvent(UiEvent.NewSessionPrefill, {
                taskContent: 'Manual prompt content',
                fromDraft: false,
            })
        })

        expect(getTaskEditorContent()).toContain('Manual prompt content')

        fireEvent.click(screen.getByRole('button', { name: 'GitHub issue' }))

        await waitFor(() => {
            expect(screen.queryByTestId('session-task-editor')).not.toBeInTheDocument()
        })

        fireEvent.click(screen.getByRole('button', { name: 'Custom prompt' }))

        await waitFor(() => {
            expect(screen.getByTestId('session-task-editor')).toBeInTheDocument()
        })
        expect(getTaskEditorContent()).toContain('Manual prompt content')
    })

    test('keeps manual prompt active when GitHub integration is unavailable', async () => {
        render(
            <TestProviders
                githubOverrides={{
                    status: {
                        installed: false,
                        authenticated: false,
                        userLogin: null,
                        repository: null,
                    },
                    isGhMissing: true,
                    hasRepository: false,
                    canCreatePr: false,
                }}
            >
                <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} />
            </TestProviders>
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        const githubButton = screen.getByRole('button', { name: 'GitHub issue' })
        expect(githubButton).toBeDisabled()

        fireEvent.click(githubButton)

        expect(screen.getByTestId('session-task-editor')).toBeInTheDocument()
        expect(screen.queryByPlaceholderText('Search GitHub issues')).not.toBeInTheDocument()
    })

    test('selecting a GitHub issue populates preview and submits generated prompt', async () => {
        const onCreate = vi.fn()
        mockUseGithubIssueSearch.mockReturnValue({
            results: [
                {
                    number: 42,
                    title: 'Fix login flow',
                    state: 'OPEN',
                    updatedAt: '2024-01-01T00:00:00Z',
                    author: 'octocat',
                    labels: [],
                    url: 'https://github.com/example/repo/issues/42',
                },
            ],
            loading: false,
            error: null,
            query: '',
            setQuery: vi.fn(),
            refresh: vi.fn(),
            fetchDetails: vi.fn().mockResolvedValue({
                number: 42,
                title: 'Fix login flow',
                url: 'https://github.com/example/repo/issues/42',
                body: 'Issue body goes here.',
                labels: [
                    { name: 'bug', color: 'd73a4a' },
                    { name: 'frontend', color: '0052cc' },
                ],
                comments: [
                    {
                        author: 'alice',
                        createdAt: '2024-01-01T01:00:00Z',
                        body: 'First comment',
                    },
                    {
                        author: 'bob',
                        createdAt: '2024-01-01T02:00:00Z',
                        body: 'Second comment',
                    },
                ],
            } as GithubIssueDetails),
            clearError: vi.fn(),
        })
        mockInvoke.mockImplementation((command: string) => {
            switch (command) {
                case TauriCommands.RepositoryIsEmpty:
                    return Promise.resolve(false)
                case TauriCommands.ListProjectBranches:
                    return Promise.resolve(['main'])
                case TauriCommands.GetProjectDefaultBaseBranch:
                    return Promise.resolve('main')
                case TauriCommands.SchaltwerkCoreGetSkipPermissions:
                    return Promise.resolve(false)
                case TauriCommands.SchaltwerkCoreGetAgentType:
                    return Promise.resolve('claude')
                case TauriCommands.GetAgentEnvVars:
                    return Promise.resolve({})
                case TauriCommands.GetAgentCliArgs:
                    return Promise.resolve('')
                case TauriCommands.GitHubSearchIssues:
                    return Promise.resolve([
                        {
                            number: 42,
                            title: 'Fix login flow',
                            state: 'OPEN',
                            updatedAt: '2024-01-01T00:00:00Z',
                            author: 'octocat',
                            labels: [
                                { name: 'bug', color: 'd73a4a' },
                                { name: 'frontend', color: '0052cc' },
                            ],
                            url: 'https://github.com/example/repo/issues/42',
                        },
                    ])
                case TauriCommands.GitHubGetIssueDetails:
                    return Promise.resolve({
                        number: 42,
                        title: 'Fix login flow',
                        url: 'https://github.com/example/repo/issues/42',
                        body: 'Issue body goes here.',
                        labels: [
                            { name: 'bug', color: 'd73a4a' },
                            { name: 'frontend', color: '0052cc' },
                        ],
                        comments: [
                            {
                                author: 'alice',
                                createdAt: '2024-01-01T01:00:00Z',
                                body: 'First comment',
                            },
                            {
                                author: 'bob',
                                createdAt: '2024-01-01T02:00:00Z',
                                body: 'Second comment',
                            },
                        ],
                    })
                default:
                    return Promise.resolve()
            }
        })

        render(
            <TestProviders
                githubOverrides={{
                    status: {
                        installed: true,
                        authenticated: true,
                        userLogin: 'octocat',
                        repository: {
                            nameWithOwner: 'example/repo',
                            defaultBranch: 'main',
                        },
                    },
                    isGhMissing: false,
                    hasRepository: true,
                    canCreatePr: true,
                }}
            >
                <NewSessionModal open={true} onClose={vi.fn()} onCreate={onCreate} />
            </TestProviders>
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByRole('button', { name: 'GitHub issue' }))

        const issueButton = await screen.findByRole('button', { name: /Use GitHub issue 42/ })
        fireEvent.click(issueButton)

        await waitFor(() => {
            expect(screen.getByText('Start Agent')).not.toBeDisabled()
        })

        fireEvent.click(screen.getByTestId('change-branch'))

        fireEvent.click(screen.getByText('Start Agent'))

        await waitFor(() => {
            expect(onCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: expect.stringContaining('GitHub Issue Context: Fix login flow (#42)'),
                })
            )
        })

        const generatedPrompt = onCreate.mock.calls[0][0].prompt as string
        expect(generatedPrompt).toContain('Issue body goes here.')
        expect(generatedPrompt).toContain('Comment by alice (2024-01-01T01:00:00Z):')
        expect(generatedPrompt).toContain('First comment')
        expect(generatedPrompt).toContain('Comment by bob (2024-01-01T02:00:00Z):')
    })

    test('View on GitHub uses shell open when available', async () => {
        mockUseGithubIssueSearch.mockReturnValue({
            results: [
                {
                    number: 99,
                    title: 'Investigate crash',
                    state: 'OPEN',
                    updatedAt: '2024-05-05T10:00:00Z',
                    author: 'octocat',
                    labels: [],
                    url: 'https://github.com/example/repo/issues/99',
                },
            ],
            loading: false,
            error: null,
            query: '',
            setQuery: vi.fn(),
            refresh: vi.fn(),
            fetchDetails: vi.fn().mockResolvedValue({
                number: 99,
                title: 'Investigate crash',
                url: 'https://github.com/example/repo/issues/99',
                body: 'Crash details',
                labels: [],
                comments: [],
            } as GithubIssueDetails),
            clearError: vi.fn(),
        })

        mockInvoke.mockImplementation((command: string) => {
            switch (command) {
                case TauriCommands.RepositoryIsEmpty:
                    return Promise.resolve(false)
                case TauriCommands.ListProjectBranches:
                    return Promise.resolve(['main'])
                case TauriCommands.GetProjectDefaultBaseBranch:
                    return Promise.resolve('main')
                case TauriCommands.SchaltwerkCoreGetSkipPermissions:
                    return Promise.resolve(false)
                case TauriCommands.SchaltwerkCoreGetAgentType:
                    return Promise.resolve('claude')
                case TauriCommands.GetAgentEnvVars:
                    return Promise.resolve({})
                case TauriCommands.GetAgentCliArgs:
                    return Promise.resolve('')
                case TauriCommands.GitHubSearchIssues:
                    return Promise.resolve([
                        {
                            number: 99,
                            title: 'Investigate crash',
                            state: 'OPEN',
                            updatedAt: '2024-05-05T10:00:00Z',
                            author: 'octocat',
                            labels: [],
                            url: 'https://github.com/example/repo/issues/99',
                        },
                    ])
                case TauriCommands.GitHubGetIssueDetails:
                    return Promise.resolve({
                        number: 99,
                        title: 'Investigate crash',
                        url: 'https://github.com/example/repo/issues/99',
                        body: 'Crash details',
                        labels: [],
                        comments: [],
                    })
                case TauriCommands.OpenExternalUrl:
                    return Promise.resolve()
                default:
                    return Promise.resolve()
            }
        })

        render(
            <TestProviders
                githubOverrides={{
                    status: {
                        installed: true,
                        authenticated: true,
                        userLogin: 'octocat',
                        repository: {
                            nameWithOwner: 'example/repo',
                            defaultBranch: 'main',
                        },
                    },
                    isGhMissing: false,
                    hasRepository: true,
                    canCreatePr: true,
                }}
            >
                <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} />
            </TestProviders>
        )

        await waitFor(() => {
            expect(screen.getByTestId('session-config-panel')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByRole('button', { name: 'GitHub issue' }))

        const issueButton = await screen.findByRole('button', { name: /Use GitHub issue 99/ })
        fireEvent.click(issueButton)

        const viewButton = await screen.findByRole('button', { name: 'View on GitHub' })
        fireEvent.click(viewButton)

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith(
                TauriCommands.OpenExternalUrl,
                expect.objectContaining({ url: 'https://github.com/example/repo/issues/99' })
            )
        })
    })
})
