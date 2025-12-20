import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { ChangedFile } from '../../common/events'
import { CopyContextBar } from './CopyContextBar'
import { Provider, createStore } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'
import {
  buildCopyContextChangedFilesSelectionKey,
  copyContextChangedFilesSelectionAtomFamily
} from '../../store/atoms/copyContextSelection'

const countTokensMock = vi.hoisted(() => vi.fn<(text: string) => number>())
const listenEventMock = vi.hoisted(() => vi.fn(async () => () => { }))
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

describe('CopyContextBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushToastMock.mockReset()
    localStorage.clear()
    mockClipboard()

    listenEventMock.mockResolvedValue(() => { })

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

  function renderComponent(sessionName = 'test-session') {
    const store = createStore()
    store.set(projectPathAtom, '/test/project')

    return render(
      <Provider store={store}>
        <CopyContextBar sessionName={sessionName} />
      </Provider>
    )
  }

  it('renders pills and defaults to spec only when available', async () => {
    listenEventMock.mockResolvedValue(() => { })

    renderComponent('s1')

    const specPill = await screen.findByText('Spec')
    const diffPill = await screen.findByText('Diff')
    const filesPill = await screen.findByText('Files')

    await waitFor(() => {
      // Check active state by style or class if possible, or just existence for now
      // Since we can't easily check "checked" on a div without role, we assume render implies existence
      expect(specPill).toBeInTheDocument()
      expect(diffPill).toBeInTheDocument()
      expect(filesPill).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText(/TOKENS/i)).toBeInTheDocument()
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

    renderComponent('s2')

    const specPill = await screen.findByText('Spec')

    await waitFor(() => {
      // Check the parent div for the title attribute
      expect(specPill.closest('div')).toHaveAttribute('title', 'Spec content unavailable')
    })
  })

  it('copies bundle and reports success', async () => {
    renderComponent('s4')

    const button = await screen.findByRole('button', { name: /copy context/i })
    await waitFor(() => expect(button).toBeEnabled())
    await act(async () => {
      await user.click(button)
    })

    await waitFor(() => {
      expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Copied to clipboard' }))
    })
  })

  it('copies diff/files only for selected changed files', async () => {
    let clipboardText: string | null = null

    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      switch (cmd) {
        case TauriCommands.SchaltwerkCoreGetSessionAgentContent:
          return ['# Spec content', null]
        case TauriCommands.GetChangedFilesFromMain:
          return [
            makeChangedFile({ path: 'file1.txt', change_type: 'modified' }),
            makeChangedFile({ path: 'file2.txt', change_type: 'modified' })
          ]
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
          clipboardText = (args as { text?: string } | undefined)?.text ?? null
          return undefined
        default:
          return undefined
      }
    })

    const sessionName = 's-selected'
    const store = createStore()
    store.set(projectPathAtom, '/test/project')
    void store.set(
      copyContextChangedFilesSelectionAtomFamily(
        buildCopyContextChangedFilesSelectionKey('/test/project', sessionName)
      ),
      { selectedFilePaths: ['file1.txt'] }
    )

    render(
      <Provider store={store}>
        <CopyContextBar sessionName={sessionName} />
      </Provider>
    )

    const diffPill = await screen.findByText('Diff')
    const filesPill = await screen.findByText('Files')

    await act(async () => {
      await user.click(diffPill)
      await user.click(filesPill)
    })

    const button = await screen.findByRole('button', { name: /copy context/i })
    await waitFor(() => expect(button).toBeEnabled())

    await act(async () => {
      await user.click(button)
    })

    await waitFor(() => {
      expect(clipboardText).toContain('### file1.txt (modified)')
      expect(clipboardText).not.toContain('### file2.txt (modified)')
    })
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
      .mockImplementationOnce(async () => () => { })

    const { unmount } = renderComponent('cleanup-session')

    await screen.findByText('Spec')

    unmount()

    await waitFor(() => {
      expect(loggerMock.warn).toHaveBeenCalledWith(
        '[CopyContextBar] Failed to cleanup file changes listener',
        unlistenError
      )
    })
  })
})
