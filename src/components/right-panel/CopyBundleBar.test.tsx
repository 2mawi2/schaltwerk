import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { ChangedFile } from '../../common/events'
import { CopyBundleBar } from './CopyBundleBar'
import { Provider, createStore } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'
import type { ReactElement } from 'react'

const countTokensMock = vi.hoisted(() => vi.fn<(text: string) => number>())
const listenEventMock = vi.hoisted(() => vi.fn(async () => () => {}))
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('gpt-tokenizer', () => ({
  countTokens: (text: string) => countTokensMock(text),
}))

const pushToastMock = vi.fn()

vi.mock('../../common/toast/ToastProvider', () => ({
  useToast: () => ({ pushToast: pushToastMock, dismissToast: vi.fn() }),
  useOptionalToast: () => ({ pushToast: pushToastMock, dismissToast: vi.fn() })
}))

vi.mock('../../utils/logger', () => ({
  logger: loggerMock
}))

vi.mock('../../common/eventSystem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../common/eventSystem')>()
  return {
    ...actual,
    listenEvent: listenEventMock
  }
})

const mockInvoke = vi.mocked(invoke)
const user = userEvent.setup()

const makeChangedFile = (file: Partial<ChangedFile> & { path: string }): ChangedFile => {
  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  return {
    path: file.path,
    change_type: file.change_type ?? 'modified',
    additions,
    deletions,
    changes: file.changes ?? additions + deletions,
    is_binary: file.is_binary,
  }
}

function mockClipboard() {
  if (!navigator.clipboard || !('writeText' in navigator.clipboard)) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
  } else {
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  }
}

describe('CopyBundleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushToastMock.mockReset()
    localStorage.clear()
    mockClipboard()

    listenEventMock.mockResolvedValue(() => {})

    countTokensMock.mockReset()
    countTokensMock.mockImplementation((text: string) => text.length)

    loggerMock.debug.mockReset()
    loggerMock.info.mockReset()
    loggerMock.warn.mockReset()
    loggerMock.error.mockReset()

    mockInvoke.mockImplementation(async (cmd: string, _args?: unknown) => {
      switch (cmd) {
        case TauriCommands.SchaltwerkCoreGetSessionAgentContent:
          return ['# Spec content', null]
        case TauriCommands.GetChangedFilesFromMain:
          return [makeChangedFile({ path: 'file1.txt', change_type: 'modified' })]
        case TauriCommands.ComputeUnifiedDiffBackend:
          return {
            lines: [
              { content: 'line one', type: 'unchanged' },
              { content: 'added line', type: 'added' }
            ],
            isBinary: false
          }
        case TauriCommands.GetFileDiffFromMain:
          return ['old contents', 'new contents']
        case TauriCommands.ClipboardWriteText:
          return undefined
        case TauriCommands.StartFileWatcher:
          return undefined
        case TauriCommands.StopFileWatcher:
          return undefined
        default:
          return undefined
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders checkboxes and defaults to spec only when available', async () => {
    listenEventMock.mockResolvedValue(() => {})
    
    renderWithProject(<CopyBundleBar sessionName="s1" />)

    const specToggle = await screen.findByRole('checkbox', { name: /spec/i })
    const diffToggle = await screen.findByRole('checkbox', { name: /diff/i })
    const filesToggle = await screen.findByRole('checkbox', { name: /files/i })

    await waitFor(() => {
      expect(specToggle).toBeChecked()
      expect(diffToggle).not.toBeChecked()
      expect(filesToggle).not.toBeChecked()
    })

    await waitFor(() => {
      expect(screen.getByText(/Tokens:/i)).toBeInTheDocument()
    })
  })

  it('disables spec when not available while keeping diff/files enabled', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.SchaltwerkCoreGetSessionAgentContent) {
        return [null, null]
      }
      if (cmd === TauriCommands.GetChangedFilesFromMain) {
        return [makeChangedFile({ path: 'file.txt', change_type: 'modified' })]
      }
      if (cmd === TauriCommands.ComputeUnifiedDiffBackend) {
        return { lines: [], isBinary: false }
      }
      if (cmd === TauriCommands.GetFileDiffFromMain) {
        return ['', 'contents']
      }
      if (cmd === TauriCommands.ClipboardWriteText) {
        return undefined
      }
      return undefined
    })

    renderWithProject(<CopyBundleBar sessionName="s2" />)

    const specToggle = await screen.findByRole('checkbox', { name: /spec/i })
    const diffToggle = await screen.findByRole('checkbox', { name: /diff/i })
    const filesToggle = await screen.findByRole('checkbox', { name: /files/i })

    await waitFor(() => {
      expect(specToggle).toBeDisabled()
      expect(specToggle).not.toBeChecked()
      expect(diffToggle).toBeChecked()
      expect(filesToggle).not.toBeChecked()
    })
  })

  it('disables diff and files when there are no changes', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.SchaltwerkCoreGetSessionAgentContent) {
        return ['# Spec', null]
      }
      if (cmd === TauriCommands.GetChangedFilesFromMain) {
        return []
      }
      return undefined
    })

    renderWithProject(<CopyBundleBar sessionName="s3" />)

    const diffToggle = await screen.findByRole('checkbox', { name: /diff/i })
    const filesToggle = await screen.findByRole('checkbox', { name: /files/i })

    expect(diffToggle).toBeDisabled()
    expect(filesToggle).toBeDisabled()
  })

  it('copies bundle and reports success', async () => {
    renderWithProject(<CopyBundleBar sessionName="s4" />)

    const button = await screen.findByRole('button', { name: /copy to clipboard/i })
    await user.click(button)

    await waitFor(() => {
      expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Copied to clipboard' }))
    })
  })

  it('produces smaller token bundles for diffs by skipping collapsed unchanged lines', async () => {
    const collapsedLines = Array.from({ length: 40 }, (_, index) => ({
      content: `unchanged ${index}`,
      type: 'unchanged' as const,
    }))

    mockInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case TauriCommands.SchaltwerkCoreGetSessionAgentContent:
          return ['# Spec content', null]
        case TauriCommands.GetChangedFilesFromMain:
          return [makeChangedFile({ path: 'file1.txt', change_type: 'modified' })]
        case TauriCommands.ComputeUnifiedDiffBackend:
          return {
            lines: [
              { content: 'context start', type: 'unchanged' as const },
              {
                content: '',
                type: 'unchanged' as const,
                isCollapsible: true,
                collapsedCount: collapsedLines.length,
                collapsedLines,
              },
              { content: 'old value', type: 'removed' as const },
              { content: 'new value', type: 'added' as const },
            ],
            isBinary: false,
          }
        case TauriCommands.GetFileDiffFromMain:
          return [
            collapsedLines.map(line => line.content).join('\n'),
            [...collapsedLines.map(line => line.content), 'new value'].join('\n'),
          ]
        case TauriCommands.ClipboardWriteText:
          return undefined
        default:
          return undefined
      }
    })

    renderWithProject(<CopyBundleBar sessionName="s-diff-tokens" />)

    const specToggle = await screen.findByRole('checkbox', { name: /spec/i })
    const diffToggle = await screen.findByRole('checkbox', { name: /diff/i })
    const filesToggle = await screen.findByRole('checkbox', { name: /files/i })

    await waitFor(() => {
      expect(specToggle).toBeChecked()
    })

    countTokensMock.mockClear()

    await user.click(specToggle)
    await user.click(diffToggle)

    await waitFor(() => {
      expect(countTokensMock).toHaveBeenCalled()
      const latestText = countTokensMock.mock.calls.at(-1)?.[0] ?? ''
      expect(latestText).toContain('## Diff')
    })
    const diffTokens = countTokensMock.mock.results.at(-1)?.value as number

    countTokensMock.mockClear()

    await user.click(filesToggle)
    await user.click(diffToggle)

    await waitFor(() => {
      expect(countTokensMock).toHaveBeenCalled()
      const latestText = countTokensMock.mock.calls.at(-1)?.[0] ?? ''
      expect(latestText).toContain('## Touched files')
    })
    const fileTokens = countTokensMock.mock.results.at(-1)?.value as number

    expect(fileTokens).toBeGreaterThan(diffTokens)
  })
  
  it('logs a warning when event unlisten rejects during cleanup', async () => {
    const unlistenError = new Error('failed to unregister')

    listenEventMock
      .mockImplementationOnce(async () => {
        return (
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          async () => {
            throw unlistenError
          }
        )
      })
      .mockImplementationOnce(async () => () => {})

    const { unmount } = renderWithProject(<CopyBundleBar sessionName="cleanup-session" />)

    await screen.findByRole('checkbox', { name: /spec/i })

    unmount()

    await waitFor(() => {
      expect(loggerMock.warn).toHaveBeenCalledWith(
        '[CopyBundleBar] Failed to cleanup file changes listener',
        unlistenError
      )
    })
  })
})

function renderWithProject(ui: ReactElement, projectPath: string | null = '/tmp/project-path') {
  const store = createStore()
  store.set(projectPathAtom, projectPath)
  const result = render(<Provider store={store}>{ui}</Provider>)
  return {
    ...result,
    rerender(nextUi: ReactElement) {
      result.rerender(<Provider store={store}>{nextUi}</Provider>)
    },
  }
}
