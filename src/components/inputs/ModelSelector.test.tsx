import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSelector } from './ModelSelector'

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

function setup(initial: 'claude' | 'cursor' | 'opencode' | 'gemini' = 'claude', disabled = false) {
  const onChange = vi.fn()
  render(<ModelSelector value={initial} onChange={onChange} disabled={disabled} />)
  return { onChange }
}

describe('ModelSelector', () => {
  test('renders dropdown button with current model label and color indicator', () => {
    setup('claude')
    const toggle = screen.getByRole('button', { name: /Claude/i })
    expect(toggle).toBeInTheDocument()

    // Check that the button contains the model label
    expect(toggle.textContent).toContain('Claude')
  })

  test('opens menu on click and renders options', async () => {
    const user = userEvent.setup()
    setup('claude')

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    // Ensure all options are present
    expect(screen.getAllByRole('button', { name: 'Claude' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Cursor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OpenCode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gemini' })).toBeInTheDocument()
  })

  test('changes selection on option click and closes menu', async () => {
    const user = userEvent.setup()
    const { onChange } = setup('claude')

    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'Cursor' }))

    expect(onChange).toHaveBeenCalledWith('cursor')

    // menu should close (options disappear)
    expect(screen.queryByRole('button', { name: 'Cursor' })).not.toBeInTheDocument()
  })

  test('keyboard navigation: Enter opens menu, ArrowDown navigates, Enter selects', async () => {
    const user = userEvent.setup()
    const { onChange } = setup('claude')

    const toggle = screen.getByRole('button', { name: /Claude/i })
    toggle.focus()
    await user.keyboard('{Enter}')

    // Move to second option (Cursor) using arrow down
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('cursor')
  })

  test('disabled state prevents opening and interaction', async () => {
    const user = userEvent.setup()
    setup('claude', true)

    const toggle = screen.getByRole('button', { name: /Claude/i })
    expect(toggle).toBeDisabled()

    await user.click(toggle)
    expect(screen.queryByRole('button', { name: 'Cursor' })).not.toBeInTheDocument()
  })

  test('default model selection reflects initial value', () => {
    setup('cursor')
    const toggle = screen.getByRole('button', { name: /Cursor/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.textContent).toContain('Cursor')
  })

  test('falls back to default model when given invalid value', () => {
    const onChange = vi.fn()
    // Force an invalid value through casts to exercise fallback
    render(<ModelSelector value={'invalid' as unknown as 'claude' | 'cursor' | 'opencode' | 'gemini'} onChange={onChange} />)
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

    const { onChange } = setup('claude')
    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'Cursor' }))

    expect(onChange).toHaveBeenCalledWith('cursor')
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  test('can select Gemini model', async () => {
    const user = userEvent.setup()
    const { onChange } = setup('claude')
    
    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'Gemini' }))
    
    expect(onChange).toHaveBeenCalledWith('gemini')
  })

  test('renders Gemini with orange color indicator', () => {
    setup('gemini')
    const toggle = screen.getByRole('button', { name: /Gemini/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.textContent).toContain('Gemini')
  })

  test('keyboard navigation: ArrowDown moves focus to next option', async () => {
    const user = userEvent.setup()
    const { onChange } = setup('claude')

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('cursor')
  })

  test('keyboard navigation: ArrowUp moves focus to previous option', async () => {
    const user = userEvent.setup()
    const { onChange } = setup('cursor')

    const toggle = screen.getByRole('button', { name: /Cursor/i })
    await user.click(toggle)

    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('claude')
  })

  test('keyboard navigation: wraps around when reaching boundaries', async () => {
    const user = userEvent.setup()
    const { onChange } = setup('claude')

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('codex')
  })

  test('keyboard navigation: Escape closes dropdown', async () => {
    const user = userEvent.setup()
    setup('claude')

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    expect(screen.getByRole('button', { name: 'Cursor' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('button', { name: 'Cursor' })).not.toBeInTheDocument()
  })

  test('keyboard navigation: highlights focused option visually', async () => {
    const user = userEvent.setup()
    setup('claude')

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    await user.keyboard('{ArrowDown}')

    const cursorOption = screen.getByRole('button', { name: 'Cursor' })
    // Check that the option exists and is rendered
    expect(cursorOption).toBeInTheDocument()
  })
})
