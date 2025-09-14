import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import { SessionConfigurationPanel, useSessionConfiguration } from './SessionConfigurationPanel'
import { invoke } from '@tauri-apps/api/core'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'

// Mock Tauri
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

// Mock useClaudeSession hook
vi.mock('../../hooks/useClaudeSession', () => ({
    useClaudeSession: () => ({
        getSkipPermissions: vi.fn().mockResolvedValue(false),
        setSkipPermissions: vi.fn().mockResolvedValue(true),
        getAgentType: vi.fn().mockResolvedValue('claude'),
        setAgentType: vi.fn().mockResolvedValue(true)
    })
}))

// Mock child components
vi.mock('../inputs/BranchAutocomplete', () => ({
    BranchAutocomplete: ({
        value,
        onChange,
        branches,
        onValidationChange,
        disabled,
        placeholder
    }: {
        value?: string
        onChange?: (value: string) => void
        branches?: string[]
        onValidationChange?: (valid: boolean) => void
        disabled?: boolean
        placeholder?: string
    }) => (
        <div data-testid="branch-autocomplete">
            <input
                value={value ?? ''}
                onChange={(e) => onChange?.(e.target.value)}
                disabled={disabled}
                placeholder={placeholder}
            />
            <div data-testid="branch-count">{branches?.length ?? 0}</div>
            <button
                onClick={() => onValidationChange?.(true)}
                data-testid="validate-branch"
                disabled={!onValidationChange}
            >
                Validate
            </button>
        </div>
    )
}))

vi.mock('../inputs/ModelSelector', () => ({
    ModelSelector: ({
        value,
        onChange,
        disabled
    }: {
        value?: string
        onChange?: (value: string) => void
        disabled?: boolean
    }) => (
        <div data-testid="model-selector">
            <select
                value={value ?? ''}
                onChange={(e) => onChange?.(e.target.value)}
                disabled={disabled}
            >
                <option value="claude">Claude</option>
                <option value="cursor">Cursor</option>
                <option value="opencode">OpenCode</option>
                <option value="gemini">Gemini</option>
                <option value="codex">Codex</option>
            </select>
        </div>
    )
}))

const mockInvoke = invoke as MockedFunction<typeof invoke>

describe('SessionConfigurationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockInvoke.mockImplementation((command: string) => {
            switch (command) {
                case TauriCommands.ListProjectBranches:
                    return Promise.resolve(['main', 'develop', 'feature/test'])
                case TauriCommands.GetProjectDefaultBaseBranch:
                    return Promise.resolve('main')
                case TauriCommands.GetProjectDefaultBranch:
                    return Promise.resolve('main')
                case TauriCommands.RepositoryIsEmpty:
                    return Promise.resolve(false)
                case TauriCommands.SetProjectDefaultBaseBranch:
                    return Promise.resolve()
                default:
                    return Promise.resolve()
            }
        })
    })

    test('renders in modal variant', async () => {
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}
                onSkipPermissionsChange={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
            expect(screen.getByRole('checkbox')).toBeInTheDocument()
        })

        expect(screen.getByText('Base branch')).toBeInTheDocument()
        expect(screen.getByText('Agent')).toBeInTheDocument()
    })

    test('renders in compact variant', async () => {
        render(
            <SessionConfigurationPanel 
                variant="compact"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}
                onSkipPermissionsChange={vi.fn()}
                hideLabels={false}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
        })

        expect(screen.getByText('Branch:')).toBeInTheDocument()
        expect(screen.getByText('Agent:')).toBeInTheDocument()
    })

    test('hides labels when hideLabels is true', async () => {
        render(
            <SessionConfigurationPanel 
                variant="compact"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}
                onSkipPermissionsChange={vi.fn()}
                hideLabels={true}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        expect(screen.queryByText('Branch:')).not.toBeInTheDocument()
        expect(screen.queryByText('Agent:')).not.toBeInTheDocument()
    })

    test('calls onBaseBranchChange when branch changes', async () => {
        const onBaseBranchChange = vi.fn()
        
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={onBaseBranchChange}
                onAgentTypeChange={vi.fn()}
                onSkipPermissionsChange={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        const input = screen.getByDisplayValue('main')
        fireEvent.change(input, { target: { value: 'develop' } })

        expect(onBaseBranchChange).toHaveBeenCalledWith('develop')
    })

    test('calls onAgentTypeChange when agent changes', async () => {
        const onAgentTypeChange = vi.fn()
        
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={onAgentTypeChange}
                onSkipPermissionsChange={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
        })

        const select = screen.getByTestId('model-selector').querySelector('select')
        expect(select).toBeTruthy()
        fireEvent.change(select!, { target: { value: 'cursor' } })

        expect(onAgentTypeChange).toHaveBeenCalledWith('cursor')
    })

    test('calls onSkipPermissionsChange when checkbox changes', async () => {
        const onSkipPermissionsChange = vi.fn()
        
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}
                onSkipPermissionsChange={onSkipPermissionsChange}
            />
        )

        await waitFor(() => {
            expect(screen.getByRole('checkbox')).toBeInTheDocument()
        })

        const checkbox = screen.getByRole('checkbox')
        fireEvent.click(checkbox)

        expect(onSkipPermissionsChange).toHaveBeenCalledWith(true)
    })

    test('disables components when disabled prop is true', async () => {
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}
                onSkipPermissionsChange={vi.fn()}
                disabled={true}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        const input = screen.getByDisplayValue('main')
        const checkbox = screen.getByRole('checkbox')
        
        expect(input).toBeDisabled()
        expect(checkbox).toBeDisabled()
    })

    test('hides skip permissions for opencode agent', async () => {
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}
                onSkipPermissionsChange={vi.fn()}
                initialAgentType="opencode"
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('model-selector')).toBeInTheDocument()
        })

        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })

    test('loads branches and sets default branch on mount', async () => {
        const onBaseBranchChange = vi.fn()
        
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={onBaseBranchChange}
                onAgentTypeChange={vi.fn()}
                onSkipPermissionsChange={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.ListProjectBranches)
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetProjectDefaultBaseBranch)
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetProjectDefaultBranch)
        })

        await waitFor(() => {
            expect(screen.getByTestId('branch-count')).toHaveTextContent('3')
        })

        expect(onBaseBranchChange).toHaveBeenCalledWith('main')
    })

    test('saves branch as project default when changed', async () => {
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}
                onSkipPermissionsChange={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(screen.getByTestId('branch-autocomplete')).toBeInTheDocument()
        })

        const input = screen.getByDisplayValue('main')
        fireEvent.change(input, { target: { value: 'develop' } })

        await waitFor(() => {
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetProjectDefaultBaseBranch, { branch: 'develop' })
        })
    })

    test('handles branch loading errors gracefully', async () => {
        mockInvoke.mockImplementation((command: string) => {
            if (command === TauriCommands.ListProjectBranches) {
                return Promise.reject(new Error('Failed to load branches'))
            }
            return Promise.resolve()
        })

        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        
        render(
            <SessionConfigurationPanel 
                variant="modal"
                onBaseBranchChange={vi.fn()}
                onAgentTypeChange={vi.fn()}
                onSkipPermissionsChange={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith('Failed to load configuration:', expect.any(Error))
        })

        expect(screen.getByTestId('branch-count')).toHaveTextContent('0')
        
        consoleSpy.mockRestore()
    })
})

describe('useSessionConfiguration', () => {
    test('returns initial configuration and update function', () => {
        const TestComponent = () => {
            const [config, updateConfig] = useSessionConfiguration()
            
            return (
                <div>
                    <div data-testid="base-branch">{config.baseBranch}</div>
                    <div data-testid="agent-type">{config.agentType}</div>
                    <div data-testid="skip-permissions">{config.skipPermissions.toString()}</div>
                    <div data-testid="is-valid">{config.isValid.toString()}</div>
                    <button 
                        onClick={() => updateConfig({ baseBranch: 'develop', isValid: true })}
                        data-testid="update-config"
                    >
                        Update
                    </button>
                </div>
            )
        }

        render(<TestComponent />)
        
        expect(screen.getByTestId('base-branch')).toHaveTextContent('')
        expect(screen.getByTestId('agent-type')).toHaveTextContent('claude')
        expect(screen.getByTestId('skip-permissions')).toHaveTextContent('false')
        expect(screen.getByTestId('is-valid')).toHaveTextContent('false')

        fireEvent.click(screen.getByTestId('update-config'))

        expect(screen.getByTestId('base-branch')).toHaveTextContent('develop')
        expect(screen.getByTestId('is-valid')).toHaveTextContent('true')
    })

    test('preserves existing config when updating partial values', () => {
        const TestComponent = () => {
            const [config, updateConfig] = useSessionConfiguration()
            
            return (
                <div>
                    <div data-testid="agent-type">{config.agentType}</div>
                    <div data-testid="skip-permissions">{config.skipPermissions.toString()}</div>
                    <button 
                        onClick={() => updateConfig({ skipPermissions: true })}
                        data-testid="update-skip-permissions"
                    >
                        Update Skip Permissions
                    </button>
                </div>
            )
        }

        render(<TestComponent />)
        
        expect(screen.getByTestId('agent-type')).toHaveTextContent('claude')
        expect(screen.getByTestId('skip-permissions')).toHaveTextContent('false')

        fireEvent.click(screen.getByTestId('update-skip-permissions'))

        expect(screen.getByTestId('agent-type')).toHaveTextContent('claude') // Preserved
        expect(screen.getByTestId('skip-permissions')).toHaveTextContent('true') // Updated
    })
})