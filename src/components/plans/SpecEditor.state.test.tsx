import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpecEditor } from './SpecEditor'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { EnrichedSession } from '../../types/session'
import { flushPromises } from '../../test/flushPromises'
import { useState } from 'react'

vi.mock('@tauri-apps/api/event', () => {
  const listeners: Record<string, (payload: unknown) => void> = {}
  return {
    listen: vi.fn(async (_event: string, handler: (payload: unknown) => void) => {
      listeners[_event] = handler
      return () => {
        delete listeners[_event]
      }
    }),
    __mockListeners: listeners
  }
})

vi.mock('./MarkdownEditor', async () => {
  const React = await import('react')
  return {
    MarkdownEditor: React.forwardRef((
      { value, onChange }: { value: string; onChange: (val: string) => void },
      ref
    ) => {
      if (ref && typeof ref === 'object') {
        ref.current = {
          focusEnd: () => {}
        }
      }
      return (
        <textarea
          data-testid="markdown-editor"
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      )
    })
  }
})

vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  )
}))

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

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args)
}))

interface HarnessProps {
  sessionName: string
}

function SpecEditorHarness({ sessionName }: HarnessProps) {
  const [visible, setVisible] = useState(true)

  return (
    <div>
      <button
        type="button"
        data-testid="toggle-editor"
        onClick={() => setVisible(prev => !prev)}
      >
        Toggle
      </button>
      {visible ? (
        <SpecEditor sessionName={sessionName} disableFocusShortcut />
      ) : (
        <div data-testid="placeholder">hidden</div>
      )}
    </div>
  )
}

describe('SpecEditor spec content persistence', () => {
  const specSessionId = 'spec-session'
  const baseSession: EnrichedSession = {
    info: {
      session_id: specSessionId,
      branch: specSessionId,
      worktree_path: '/tmp/spec-session',
      base_branch: 'main',
      status: 'spec',
      is_current: false,
      session_state: 'spec',
      session_type: 'worktree',
      current_task: 'Initial spec content',
      spec_content: 'Initial spec content',
      ready_to_merge: false,
      original_agent_type: 'codex'
    },
    terminals: []
  }

  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(async (command: string, args?: unknown) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return [baseSession]
        case TauriCommands.SchaltwerkCoreGetSessionAgentContent:
          return [baseSession.info.spec_content, null]
        case TauriCommands.GetProjectSessionsSettings:
          return { filter_mode: 'all', sort_mode: 'name' }
        case TauriCommands.SetProjectSessionsSettings:
          return undefined
        case TauriCommands.GetProjectMergePreferences:
          return { auto_cancel_after_merge: false }
        case TauriCommands.SchaltwerkCoreUpdateSpecContent: {
          expect(args).toEqual({ name: specSessionId, content: expect.any(String) })
          const { content } = args as { name: string; content: string }
          baseSession.info = {
            ...baseSession.info,
            spec_content: content,
            current_task: content
          }
          return undefined
        }
        default:
          return undefined
      }
    })
  })

  afterEach(() => {
    mockInvoke.mockReset()
  })

  it('retains edited spec content after navigating away and back', async () => {
    const user = userEvent.setup({ delay: null })

    render(
      <TestProviders>
        <SpecEditorHarness sessionName={specSessionId} />
      </TestProviders>
    )
    const editor = await screen.findByTestId('markdown-editor')
    expect((editor as HTMLTextAreaElement).value).toBe('Initial spec content')

    await act(async () => {
      await user.clear(editor)
      await user.type(editor, 'Updated content')
    })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 450))
      await flushPromises()
    })

    expect(mockInvoke).toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreUpdateSpecContent,
      { name: specSessionId, content: 'Updated content' }
    )

    const toggle = screen.getByTestId('toggle-editor')
    await user.click(toggle)
    expect(screen.getByTestId('placeholder')).toBeInTheDocument()

    await user.click(toggle)
    const reopened = await screen.findByTestId('markdown-editor')
    expect((reopened as HTMLTextAreaElement).value).toBe('Updated content')
  }, 10000)
})
