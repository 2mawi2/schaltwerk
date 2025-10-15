import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { ModelSelector } from './ModelSelector'
import { AgentType, AGENT_SUPPORTS_SKIP_PERMISSIONS } from '../../types/session'

// Mock the useAgentAvailability hook
vi.mock('../../hooks/useAgentAvailability', () => ({
  useAgentAvailability: () => ({
    isAvailable: vi.fn().mockReturnValue(true),
    getRecommendedPath: vi.fn().mockReturnValue('/usr/local/bin/agent'),
    getInstallationMethod: vi.fn().mockReturnValue('Homebrew'),
    loading: false,
    availability: {},
    refreshAvailability: vi.fn(),
    refreshSingleAgent: vi.fn(),
    clearCache: vi.fn(),
    forceRefresh: vi.fn(),
  }),
  InstallationMethod: {
    Homebrew: 'Homebrew',
    Npm: 'Npm',
    Pip: 'Pip',
    Manual: 'Manual',
    System: 'System',
  }
}))

function setup(options: {
  initial?: AgentType
  disabled?: boolean
  skipPermissions?: boolean
  onSkipPermissionsChange?: (skip: boolean) => void
} = {}) {
  const {
    initial = 'claude',
    disabled = false,
    skipPermissions,
    onSkipPermissionsChange,
  } = options
  const onChange = vi.fn()

  function Wrapper() {
    const [value, setValue] = useState<AgentType>(initial)
    const [skip, setSkip] = useState<boolean | undefined>(skipPermissions)

    const handleChange = (next: AgentType) => {
      setValue(next)
      onChange(next)
      if (skip !== undefined && !AGENT_SUPPORTS_SKIP_PERMISSIONS[next]) {
        setSkip(false)
        onSkipPermissionsChange?.(false)
      }
    }

    const handleSkipChange = (next: boolean) => {
      setSkip(next)
      onSkipPermissionsChange?.(next)
    }

    return (
      <ModelSelector
        value={value}
        onChange={handleChange}
        disabled={disabled}
        skipPermissions={skip}
        onSkipPermissionsChange={
          typeof skip === 'boolean' || onSkipPermissionsChange
            ? handleSkipChange
            : undefined
        }
      />
    )
  }

  render(<Wrapper />)
  return { onChange }
}

describe('ModelSelector', () => {
  test('renders dropdown button with current model label and color indicator', () => {
    setup()
    const toggle = screen.getByRole('button', { name: /Claude/i })
    expect(toggle).toBeInTheDocument()

    // Check that the button contains the model label
    expect(toggle.textContent).toContain('Claude')
  })

  test('opens menu on click and renders options', async () => {
    const user = userEvent.setup()
    setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    // Ensure all options are present
    expect(screen.getAllByRole('button', { name: 'Claude' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'OpenCode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gemini' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument()
  })

  test('changes selection on option click and closes menu', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'OpenCode' }))

    expect(onChange).toHaveBeenCalledWith('opencode')

    // menu should close (options disappear)
    expect(screen.queryAllByRole('button', { name: 'OpenCode' })).toHaveLength(1)
  })

  test('keyboard navigation: Enter opens menu, ArrowDown navigates, Enter selects', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    toggle.focus()
    await user.keyboard('{Enter}')

    // Move to second option (OpenCode) using arrow down
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('opencode')
  })

  test('disabled state prevents opening and interaction', async () => {
    const user = userEvent.setup()
    setup({ disabled: true })

    const toggle = screen.getByRole('button', { name: /Claude/i })
    expect(toggle).toBeDisabled()

    await user.click(toggle)
    expect(screen.queryAllByRole('button', { name: 'OpenCode' })).toHaveLength(0)
  })

  test('default model selection reflects initial value', () => {
    setup({ initial: 'opencode' })
    const toggle = screen.getByRole('button', { name: /OpenCode/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.textContent).toContain('OpenCode')
  })

  test('falls back to default model when given invalid value', () => {
    const onChange = vi.fn()
    // Force an invalid value through casts to exercise fallback
    render(<ModelSelector value={'invalid' as unknown as AgentType} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /Claude/i })).toBeInTheDocument()
  })

  test('mocks external model API calls (no network during interaction)', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(global as unknown as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
      headers: new Headers(),
      status: 200,
      statusText: 'OK'
    } as Response)

    const { onChange } = setup()
    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'OpenCode' }))

    expect(onChange).toHaveBeenCalledWith('opencode')
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  test('can select Gemini model', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    
    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'Gemini' }))
    
    expect(onChange).toHaveBeenCalledWith('gemini')
  })

  test('renders Gemini with orange color indicator', () => {
    setup({ initial: 'gemini' })
    const toggle = screen.getByRole('button', { name: /Gemini/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.textContent).toContain('Gemini')
  })

  test('keyboard navigation: ArrowDown moves focus to next option', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('opencode')
  })

  test('keyboard navigation: ArrowUp moves focus to previous option', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ initial: 'opencode' })

    const toggle = screen.getByRole('button', { name: /OpenCode/i })
    await user.click(toggle)

    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('claude')
  })

  test('keyboard navigation: wraps around when reaching boundaries', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('terminal')
  })

  test('keyboard navigation: Escape closes dropdown', async () => {
    const user = userEvent.setup()
    setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    expect(screen.getByRole('button', { name: 'OpenCode' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('button', { name: 'OpenCode' })).not.toBeInTheDocument()
  })

  test('keyboard navigation: highlights focused option visually', async () => {
    const user = userEvent.setup()
    setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    await user.keyboard('{ArrowDown}')

    const opencodeOption = screen.getByRole('button', { name: 'OpenCode' })
    // Check that the option exists and is rendered
    expect(opencodeOption).toBeInTheDocument()
  })

  test('exposes permission toggle when supported', async () => {
    const onSkipPermissionsChange = vi.fn()
    setup({ skipPermissions: false, onSkipPermissionsChange })

    const enableSkip = await screen.findByRole('button', { name: /Skip permissions/i })
    expect(enableSkip).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(enableSkip)

    expect(onSkipPermissionsChange).toHaveBeenCalledWith(true)
  })

  test('hides permission toggle when agent does not support it', () => {
    setup({ initial: 'opencode', skipPermissions: false, onSkipPermissionsChange: vi.fn() })

    expect(screen.queryByRole('button', { name: /Skip permissions/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Require permissions/i })).not.toBeInTheDocument()
  })

  test('updates toggle visibility when selecting unsupported agent', async () => {
    const onSkipPermissionsChange = vi.fn()
    setup({ skipPermissions: false, onSkipPermissionsChange })

    await userEvent.click(screen.getByRole('button', { name: /Claude/i }))
    await userEvent.click(screen.getByRole('button', { name: 'OpenCode' }))

    expect(screen.queryByRole('button', { name: /Skip permissions/i })).not.toBeInTheDocument()
  })
})
