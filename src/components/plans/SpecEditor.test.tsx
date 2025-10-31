import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act, screen } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import * as uiEvents from '../../common/uiEvents'

const mockFocusEnd = vi.fn()

interface SpecContentMock {
  content: string
  displayName: string | null
  hasData: boolean
}

let specContentMock: SpecContentMock = {
  content: 'Test spec content',
  displayName: 'test-spec',
  hasData: true
}

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(), UnlistenFn: vi.fn() }))

vi.mock('../../hooks/useProjectFileIndex', () => ({
  useProjectFileIndex: () => ({
    files: [],
    isLoading: false,
    error: null,
    ensureIndex: vi.fn().mockResolvedValue([]),
    refreshIndex: vi.fn().mockResolvedValue([]),
    getSnapshot: vi.fn().mockReturnValue([]),
  })
}))

vi.mock('../../hooks/useSpecContent', () => ({
  useSpecContent: () => specContentMock
}))

vi.mock('./MarkdownEditor', async () => {
  const React = await import('react')
  return {
    MarkdownEditor: React.forwardRef((props: { value: string; onChange: (val: string) => void }, ref) => {
      if (ref && typeof ref === 'object' && 'current' in ref) {
        ref.current = { focusEnd: mockFocusEnd }
      }
      return <div data-testid="markdown-editor">{props.value}</div>
    })
  }
})

vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  )
}))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { SpecEditor } from './SpecEditor'
import { TestProviders } from '../../tests/test-utils'

async function pressKey(key: string, opts: KeyboardEventInit = {}) {
  await act(async () => {
    const event = new KeyboardEvent('keydown', { key, ...opts })
    window.dispatchEvent(event)
  })
}

describe('SpecEditor keyboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    specContentMock = {
      content: 'Test spec content',
      displayName: 'test-spec',
      hasData: true
    }
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh)', configurable: true })

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreGetSessionAgentContent) {
        return ['Test spec content', null]
      }
      if (cmd === TauriCommands.SchaltwerkCoreUpdateSpecContent) {
        return undefined
      }
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
        return []
      }
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      if (cmd === TauriCommands.GetProjectMergePreferences) {
        return { auto_cancel_after_merge: false }
      }
      return undefined
    })

    vi.mocked(listen).mockImplementation(async () => {
      return () => {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits refine event when clicking refine button', async () => {
    const emitSpy = vi.spyOn(uiEvents, 'emitUiEvent')
    specContentMock.displayName = 'Auth System'

    render(
      <TestProviders>
        <SpecEditor sessionName="refine-session" />
      </TestProviders>
    )

    const refineButton = await screen.findByRole('button', { name: 'Refine' })
    expect(refineButton).toHaveAttribute('title', 'Refine spec: Auth System (refine-session)')

    await act(async () => {
      refineButton.click()
    })

    expect(emitSpy).toHaveBeenCalledWith(uiEvents.UiEvent.OpenSpecInOrchestrator, { sessionName: 'refine-session' })
    expect(emitSpy).toHaveBeenCalledWith(uiEvents.UiEvent.InsertTerminalText, {
      text: 'Refine spec: Auth System (refine-session)'
    })
  })

  it('switches from preview to edit mode and focuses editor when Cmd+T is pressed', async () => {
    const { container } = render(
      <TestProviders>
        <SpecEditor sessionName="test-spec" />
      </TestProviders>
    )

    await waitFor(() => {
      expect(container.querySelector('[title="Edit markdown"]')).toBeTruthy()
    })

    mockFocusEnd.mockClear()

    await pressKey('t', { metaKey: true })

    await waitFor(() => {
      expect(container.querySelector('[title="Preview markdown"]')).toBeTruthy()
    }, { timeout: 1000 })

    await waitFor(() => {
      expect(mockFocusEnd).toHaveBeenCalled()
    }, { timeout: 1000 })
  })

  it('focuses editor directly when Cmd+T is pressed in edit mode', async () => {
    const { container } = render(
      <TestProviders>
        <SpecEditor sessionName="test-spec" />
      </TestProviders>
    )

    await waitFor(() => {
      expect(container.querySelector('[title="Edit markdown"]')).toBeTruthy()
    })

    const editButton = container.querySelector('[title="Edit markdown"]') as HTMLElement
    act(() => {
      editButton.click()
    })

    await waitFor(() => {
      expect(container.querySelector('[title="Preview markdown"]')).toBeTruthy()
    })

    mockFocusEnd.mockClear()

    await pressKey('t', { metaKey: true })

    await waitFor(() => {
      expect(mockFocusEnd).toHaveBeenCalled()
    })
  })

  it('does not focus when disableFocusShortcut is true', async () => {
    render(
      <TestProviders>
        <SpecEditor sessionName="test-spec" disableFocusShortcut={true} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalled()
    })

    mockFocusEnd.mockClear()

    await pressKey('t', { metaKey: true })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(mockFocusEnd).not.toHaveBeenCalled()
  })
})
