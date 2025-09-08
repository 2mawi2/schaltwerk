import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const invoke = (await import('@tauri-apps/api/core')).invoke as ReturnType<typeof vi.fn>

// Mutable selection used by mocked hook
let currentSelection: Record<string, unknown> = { kind: 'orchestrator' }
vi.mock('../../contexts/SelectionContext', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../contexts/SelectionContext')
  return {
    ...actual,
    useSelection: () => ({ selection: currentSelection })
  }
})

describe('SimpleDiffPanel', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockReset()
    // default clipboard: prefer spying if exists; else define property
    try {
      if (navigator.clipboard && 'writeText' in navigator.clipboard) {
        vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
      } else {
        Object.defineProperty(globalThis.navigator, 'clipboard', {
          configurable: true,
          value: { writeText: vi.fn().mockResolvedValue(undefined) }
        })
      }
    } catch {
      // Fallback for environments with strict Navigator implementation
      Object.defineProperty(Object.getPrototypeOf(globalThis.navigator), 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) }
      })
    }
  })

  it('renders DiffFileList and no dock by default (orchestrator)', async () => {
    currentSelection = { kind: 'orchestrator' }
    invoke.mockResolvedValueOnce([]) // get_changed_files_from_main will be called by DiffFileList polling, but we just ensure render
    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    render(<SimpleDiffPanel onFileSelect={vi.fn()} />)

    expect(await screen.findByText(/no session selected/i)).toBeInTheDocument()
    expect(screen.queryByText(/show prompt/i)).not.toBeInTheDocument()
  })

  it('does not render prompt dock in session mode anymore', async () => {
    currentSelection = { kind: 'session', payload: 's1' }

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_changed_files_from_main') return []
      if (cmd === 'get_current_branch_name') return 'feat'
      if (cmd === 'get_base_branch_name') return 'main'
      if (cmd === 'get_commit_comparison_info') return ['a', 'b']
      return null
    })
    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    render(<SimpleDiffPanel onFileSelect={vi.fn()} />)

    // No prompt toggle button is present anymore
    await waitFor(() => expect(screen.queryByRole('button', { name: /show prompt/i })).not.toBeInTheDocument())

    // And we never fetch the session prompt
    const calls = invoke.mock.calls
    expect(calls.find((c: unknown[]) => (c as [string, ...unknown[]])[0] === 'schaltwerk_core_get_session')).toBeUndefined()
  })

  it('renders changed files, highlights selected row, and calls onFileSelect', async () => {
    currentSelection = { kind: 'session', payload: 's1' }

    const files = [
      { path: 'src/a/file1.txt', change_type: 'modified' },
      { path: 'src/b/file2.ts', change_type: 'added' },
    ]
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_changed_files_from_main') return files
      if (cmd === 'get_current_branch_name') return 'feat'
      if (cmd === 'get_base_branch_name') return 'main'
      if (cmd === 'get_commit_comparison_info') return ['a', 'b']
      if (cmd === 'schaltwerk_core_get_session') return { initial_prompt: '' }
      return null
    })

    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    const onFileSelect = vi.fn()
    render(<SimpleDiffPanel onFileSelect={onFileSelect} />)

    expect(await screen.findByText('file1.txt')).toBeInTheDocument()
    expect(screen.getByText('file2.ts')).toBeInTheDocument()

    await user.click(screen.getByText('file1.txt'))
    expect(onFileSelect).toHaveBeenCalledWith('src/a/file1.txt')

    // Selected row should have selection class
    const selected = document.querySelector('.bg-slate-800\\/30')
    expect(selected).toBeTruthy()
  })
})
