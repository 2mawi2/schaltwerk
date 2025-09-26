import { render } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Extension } from '@codemirror/state'
import { MarkdownEditor } from './MarkdownEditor'
import type { ProjectFileIndexApi } from '../../hooks/useProjectFileIndex'

const codeMirrorMock = vi.fn((props: unknown) => props)

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: (props: unknown) => {
    codeMirrorMock(props)
    return null
  },
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
})
