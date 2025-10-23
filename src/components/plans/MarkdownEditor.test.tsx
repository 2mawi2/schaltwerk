import { render } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Extension } from '@codemirror/state'
import { MarkdownEditor, MARKDOWN_PASTE_CHARACTER_LIMIT, handleMarkdownPaste } from './MarkdownEditor'
import type { ProjectFileIndexApi } from '../../hooks/useProjectFileIndex'

const codeMirrorMock = vi.fn((props: unknown) => props)
const pushToastMock = vi.fn()

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: (props: unknown) => {
    codeMirrorMock(props)
    return null
  },
}))

vi.mock('../../common/toast/ToastProvider', () => ({
  useOptionalToast: () => ({
    pushToast: pushToastMock,
  }),
}))

function captureExtensions(extraProps: Partial<ComponentProps<typeof MarkdownEditor>> = {}): Extension[] {
  codeMirrorMock.mockClear()
  const { unmount } = render(
    <MarkdownEditor
      value=""
      onChange={() => {}}
      {...extraProps}
    />
  )
  unmount()
  const lastCall = codeMirrorMock.mock.calls[codeMirrorMock.mock.calls.length - 1]
  if (!lastCall) {
    throw new Error('CodeMirror was not rendered')
  }
  const [props] = lastCall as [Record<string, unknown>]
  return (props.extensions as Extension[]) ?? []
}

describe('MarkdownEditor', () => {
  beforeEach(() => {
    codeMirrorMock.mockClear()
    pushToastMock.mockClear()
  })

  it('includes base extensions when no file reference provider is supplied', () => {
    const extensions = captureExtensions()
    expect(Array.isArray(extensions)).toBe(true)
    expect(extensions.length).toBeGreaterThan(0)
  })

  it('adds file reference autocomplete extension when provider is supplied', () => {
    const baseExtensions = captureExtensions()

    const provider: ProjectFileIndexApi = {
      files: [],
      isLoading: false,
      error: null,
      ensureIndex: vi.fn().mockResolvedValue([]),
      refreshIndex: vi.fn().mockResolvedValue([]),
      getSnapshot: vi.fn().mockReturnValue([]),
    }

    const withProviderExtensions = captureExtensions({ fileReferenceProvider: provider })

    expect(withProviderExtensions.length).toBe(baseExtensions.length + 1)
  })

  it('blocks oversized paste operations and reports through toast', () => {
    const largePayload = 'a'.repeat(MARKDOWN_PASTE_CHARACTER_LIMIT + 1)

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    Object.defineProperty(event, 'preventDefault', { value: preventDefault, configurable: true })
    Object.defineProperty(event, 'stopPropagation', { value: stopPropagation, configurable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: vi.fn(() => largePayload),
      },
    })
    const handled = handleMarkdownPaste(event, { pushToast: pushToastMock })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'warning',
    }))
  })

  it('allows paste operations within the configured limit', () => {
    const allowedPayload = 'b'.repeat(MARKDOWN_PASTE_CHARACTER_LIMIT)

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    Object.defineProperty(event, 'preventDefault', { value: preventDefault, configurable: true })
    Object.defineProperty(event, 'stopPropagation', { value: stopPropagation, configurable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: vi.fn(() => allowedPayload),
      },
    })
    const handled = handleMarkdownPaste(event, { pushToast: pushToastMock })

    expect(handled).toBe(false)
    expect(pushToastMock).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
  })
})
