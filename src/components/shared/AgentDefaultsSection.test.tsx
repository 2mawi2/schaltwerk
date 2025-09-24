import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { type ComponentProps } from 'react'
import { AgentDefaultsSection } from './AgentDefaultsSection'
import { AgentEnvVar } from './agentDefaults'

describe('AgentDefaultsSection', () => {
    const renderComponent = (overrides?: Partial<ComponentProps<typeof AgentDefaultsSection>>) => {
        const envVars: AgentEnvVar[] = [
            { key: 'API_KEY', value: '123' },
            { key: 'TIMEOUT', value: '30' },
        ]

        const props = {
            agentType: 'claude' as const,
            cliArgs: '--max-tokens 4000',
            onCliArgsChange: vi.fn(),
            envVars,
            onEnvVarChange: vi.fn(),
            onAddEnvVar: vi.fn(),
            onRemoveEnvVar: vi.fn(),
            loading: false,
            ...overrides,
        }

        render(<AgentDefaultsSection {...props} />)
        return props
    }

    it('renders CLI args input and forwards changes', async () => {
        const props = renderComponent()

        fireEvent.click(screen.getByTestId('advanced-agent-settings-toggle'))

        const textarea = screen.getByTestId('agent-cli-args-input') as HTMLTextAreaElement
        await waitFor(() => {
            expect(document.activeElement).toBe(textarea)
        })
        expect(textarea.value).toBe('--max-tokens 4000')

        fireEvent.change(textarea, { target: { value: '--debug' } })
        expect(props.onCliArgsChange).toHaveBeenCalledWith('--debug')
    })

    it('renders environment variables and handles interactions', async () => {
        const props = renderComponent()

        const advancedToggle = screen.getByTestId('advanced-agent-settings-toggle')
        expect(advancedToggle).toHaveAttribute('aria-expanded', 'false')

        fireEvent.click(advancedToggle)
        expect(advancedToggle).toHaveAttribute('aria-expanded', 'true')

        expect(screen.getByTestId('env-summary').textContent).toContain('API_KEY')

        const addButton = screen.getByTestId('add-env-var')
        fireEvent.click(addButton)
        expect(props.onAddEnvVar).toHaveBeenCalled()

        const toggleButton = screen.getByTestId('toggle-env-vars')
        expect(toggleButton).toHaveAttribute('aria-expanded', 'true')

        const firstKey = screen.getByTestId('env-var-key-0') as HTMLInputElement
        firstKey.focus()
        fireEvent.change(firstKey, { target: { value: 'NEW_KEY' } })
        expect(props.onEnvVarChange).toHaveBeenCalledWith(0, 'key', 'NEW_KEY')
        expect(document.activeElement).toBe(firstKey)

        const firstValue = screen.getByTestId('env-var-value-0') as HTMLInputElement
        firstValue.focus()
        fireEvent.change(firstValue, { target: { value: '999' } })
        expect(props.onEnvVarChange).toHaveBeenCalledWith(0, 'value', '999')
        expect(document.activeElement).toBe(firstValue)

        const removeButton = screen.getByTestId('env-var-remove-1')
        fireEvent.click(removeButton)
        expect(props.onRemoveEnvVar).toHaveBeenCalledWith(1)

        fireEvent.click(toggleButton)
        expect(toggleButton).toHaveAttribute('aria-expanded', 'false')

        fireEvent.click(advancedToggle)
        await waitFor(() => {
            expect(advancedToggle).toHaveAttribute('aria-expanded', 'false')
        })
    })

    it('allows opening advanced settings while loading but keeps inputs disabled', () => {
        renderComponent({ envVars: [], loading: true })

        const advancedToggle = screen.getByTestId('advanced-agent-settings-toggle')
        expect(advancedToggle).not.toBeDisabled()
        expect(advancedToggle).toHaveAttribute('aria-expanded', 'false')

        fireEvent.click(advancedToggle)

        expect(advancedToggle).toHaveAttribute('aria-expanded', 'true')

        const cliInput = screen.getByTestId('agent-cli-args-input') as HTMLTextAreaElement
        expect(cliInput).toBeDisabled()

        const addButton = screen.getByTestId('add-env-var') as HTMLButtonElement
        expect(addButton).toBeDisabled()

        const toggleButton = screen.getByTestId('toggle-env-vars') as HTMLButtonElement
        expect(toggleButton).toBeDisabled()
    })
})
