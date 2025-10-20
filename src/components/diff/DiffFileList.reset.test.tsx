import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiffFileList } from './DiffFileList'
import { TestProviders } from '../../tests/test-utils'

const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === 'get_changed_files_from_main') return [{ path: 'test.txt', change_type: 'added' }]
  if (cmd === 'get_current_branch_name') return 'schaltwerk/feature'
  if (cmd === 'get_base_branch_name') return 'main'
  if (cmd === 'get_commit_comparison_info') return ['abc', 'def']
  if (cmd === 'schaltwerk_core_reset_session_worktree') return undefined
  return null
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args as [string]) }))

vi.mock('../../contexts/SelectionContext', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../contexts/SelectionContext')
  return {
    ...actual,
    useSelection: () => ({
      selection: { kind: 'session', payload: 'demo', sessionState: 'running' },
      terminals: { top: 'session-demo-top', bottomBase: 'session-demo-bottom', workingDirectory: '/tmp' },
      setSelection: vi.fn(),
      clearTerminalTracking: vi.fn(),
      isReady: true,
      isSpec: false,
    })
  }
})

describe('DiffFileList header reset button', () => {
  beforeEach(() => {
    // @ts-ignore
    global.confirm = vi.fn(() => true)
  })

  it('renders icon button for session and triggers unified confirm flow', async () => {
    render(
      <TestProviders>
        <DiffFileList onFileSelect={() => {}} />
      </TestProviders>
    )
    // Wait for header
    const btn = await screen.findByRole('button', { name: /reset session/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    const confirm = await screen.findByRole('button', { name: /^Reset$/ })
    fireEvent.click(confirm)
    expect(invokeMock).toHaveBeenCalledWith('schaltwerk_core_reset_session_worktree', expect.any(Object))
  })
})
