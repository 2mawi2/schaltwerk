import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import { useEffect, useState } from 'react'
import { useSetAtom } from 'jotai'
import {
  initializeInlineDiffPreferenceActionAtom,
  inlineSidebarDefaultPreferenceAtom,
} from '../../store/atoms/diffPreferences'

vi.mock('../../hooks/useSelection', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../hooks/useSelection')
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

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args)
}))

function InlineDiffPreferenceController({ value }: { value: boolean }) {
  const initializePreference = useSetAtom(initializeInlineDiffPreferenceActionAtom)
  const setInlinePreference = useSetAtom(inlineSidebarDefaultPreferenceAtom)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    void initializePreference().finally(() => {
      setInitialized(true)
    })
  }, [initializePreference])

  useEffect(() => {
    if (!initialized) return
    setInlinePreference(value)
  }, [initialized, value, setInlinePreference])

  return null
}

function DiffPreferencesInitializer() {
  const initializePreference = useSetAtom(initializeInlineDiffPreferenceActionAtom)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    void initializePreference().finally(() => {
      setInitialized(true)
    })
  }, [initializePreference])

  if (!initialized) return null
  return <div data-testid="diff-preferences-initialized" />
}

describe('UnifiedDiffModal diff viewer preferences', () => {
  let diffPrefs: {
    continuous_scroll: boolean
    compact_diffs: boolean
    sidebar_width: number
    inline_sidebar_default: boolean
    diff_layout: 'unified' | 'split'
  }

  beforeEach(() => {
    diffPrefs = {
      continuous_scroll: false,
      compact_diffs: true,
      sidebar_width: 340,
      inline_sidebar_default: true,
      diff_layout: 'unified',
    }

    invokeMock.mockImplementation(async (cmd: string, _args?: unknown) => {
      switch (cmd) {
        case TauriCommands.GetChangedFilesFromMain:
          return []
        case TauriCommands.GetOrchestratorWorkingChanges:
          return []
        case TauriCommands.GetCurrentBranchName:
          return 'feature/test'
        case TauriCommands.GetBaseBranchName:
          return 'main'
        case TauriCommands.GetCommitComparisonInfo:
          return ['abc123', 'def456']
        case TauriCommands.GetDiffViewPreferences:
          return diffPrefs
        case TauriCommands.SetDiffViewPreferences: {
          const next = (_args as { preferences?: Partial<typeof diffPrefs> } | undefined)?.preferences
          diffPrefs = {
            ...diffPrefs,
            ...next,
          }
          return null
        }
        case TauriCommands.GetSessionPreferences:
          return { skip_confirmation_modals: false }
        case TauriCommands.ListAvailableOpenApps:
          return []
        case TauriCommands.GetDefaultOpenApp:
          return 'code'
        case TauriCommands.GetProjectSettings:
          return { project_name: 'demo', project_path: '/tmp/demo' }
        default:
          return null
      }
    })
    invokeMock.mockClear()
  })

  const renderModal = () => {
    return render(
      <TestProviders>
        <DiffPreferencesInitializer />
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={() => {}} />
      </TestProviders>
    )
  }

  it('applies stored sidebar width when modal opens', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument()
    })

    const sidebar = await screen.findByTestId('diff-sidebar')
    expect(sidebar).toHaveStyle({ width: '340px' })
    expect(screen.queryByRole('button', { name: /text selection mode/i })).not.toBeInTheDocument()
  })

  it('persists sidebar width after drag', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument()
    })

    const handle = await screen.findByTestId('diff-resize-handle')

    fireEvent.mouseDown(handle, { clientX: 340 })
    fireEvent.mouseMove(document, { clientX: 480 })
    fireEvent.mouseUp(document)

    const sidebar = await screen.findByTestId('diff-sidebar')
    expect(sidebar).toHaveStyle({ width: '480px' })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.SetDiffViewPreferences, expect.objectContaining({
        preferences: expect.objectContaining({ sidebar_width: 480 })
      }))
    })
  })

  it('does not overwrite inline diff preference when persisting other diff viewer prefs', async () => {
    const Wrapper = ({ inlineValue }: { inlineValue: boolean }) => (
      <TestProviders>
        <InlineDiffPreferenceController value={inlineValue} />
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    const { rerender } = render(<Wrapper inlineValue={true} />)

    await waitFor(() => {
      expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument()
    })

    rerender(<Wrapper inlineValue={false} />)

    await waitFor(() => {
      expect(diffPrefs.inline_sidebar_default).toBe(false)
    })

    const toggle = screen.getByTitle('Switch to continuous scroll')
    fireEvent.click(toggle)

    await waitFor(() => {
      const setCalls = invokeMock.mock.calls.filter(call => call[0] === TauriCommands.SetDiffViewPreferences)
      const last = setCalls.at(-1)
      expect(last).toBeTruthy()
      const payload = last?.[1] as { preferences?: Record<string, unknown> } | undefined
      expect(payload?.preferences?.continuous_scroll).toBe(true)
      expect(payload?.preferences?.inline_sidebar_default).toBe(false)
    })
  })

  it('persists diff layout toggle', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument()
    })

    await screen.findByTestId('diff-preferences-initialized')

    const toggle = await screen.findByTestId('diff-layout-toggle')
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(diffPrefs.diff_layout).toBe('split')
    })
  })

})
