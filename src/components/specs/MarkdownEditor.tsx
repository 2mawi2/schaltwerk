import {
  useMemo,
  useCallback,
  memo,
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  type CSSProperties,
} from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { theme } from '../../common/theme'
import type { ProjectFileIndexApi } from '../../hooks/useProjectFileIndex'
import { createFileReferenceAutocomplete } from './fileReferenceAutocomplete'
import { useOptionalToast } from '../../common/toast/ToastProvider'
import { logger } from '../../utils/logger'
import type { ToastOptions } from '../../common/toast/ToastProvider'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  className?: string
  fileReferenceProvider?: ProjectFileIndexApi
}

export interface MarkdownEditorRef {
  focus: () => void
  focusEnd: () => void
}

export const MARKDOWN_PASTE_CHARACTER_LIMIT = 200_000

type OptionalToastApi = { pushToast: (options: ToastOptions) => void } | undefined

export function handleMarkdownPaste(event: ClipboardEvent, toast: OptionalToastApi): boolean {
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!text || text.length <= MARKDOWN_PASTE_CHARACTER_LIMIT) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()

  logger.warn('[MarkdownEditor] Blocked paste exceeding limit', {
    length: text.length,
    limit: MARKDOWN_PASTE_CHARACTER_LIMIT,
  })

  toast?.pushToast({
    tone: 'warning',
    title: 'Paste too large',
    description: `Paste size is limited to ${MARKDOWN_PASTE_CHARACTER_LIMIT.toLocaleString()} characters. Shorten the content before pasting.`,
  })

  return true
}

const customTheme = EditorView.theme({
  '&': {
    color: 'var(--color-editor-text)',
    backgroundColor: 'var(--color-editor-background)',
    fontSize: theme.fontSize.body,
  },
  '.cm-editor': {
    backgroundColor: 'var(--color-editor-background)',
    height: '100%',
    minHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  '.cm-editor.cm-focused': {
    backgroundColor: 'var(--color-editor-background)',
    outline: 'none',
  },
  '.cm-content': {
    caretColor: 'var(--color-editor-caret)',
    backgroundColor: 'var(--color-editor-background)',
    padding: '12px',
    minHeight: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.5',
    minHeight: '100%',
    height: '100%',
    overflowY: 'auto',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-editor-caret)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--color-editor-selection) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--color-editor-selection-focused) !important',
  },
  '&.cm-focused .cm-content ::selection': {
    backgroundColor: 'var(--color-editor-selection) !important',
  },
  '.cm-content ::selection': {
    backgroundColor: 'var(--color-editor-selection) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--color-editor-selection-alt)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-editor-background)',
    color: 'var(--color-editor-gutter-text)',
    border: 'none',
    borderRight: 'none',
  },
  '.cm-lineNumbers .cm-activeLineGutter': {
    backgroundColor: 'var(--color-editor-selection-alt)',
    color: 'var(--color-editor-gutter-active-text)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-panels': {
    backgroundColor: 'var(--color-editor-background)',
  },
  '.cm-panels-bottom': {
    backgroundColor: 'var(--color-editor-background)',
  },
})

const syntaxHighlighting = EditorView.theme({
  '.cm-header-1': {
    fontSize: theme.fontSize.headingXLarge,
    fontWeight: 'bold',
    color: 'var(--color-syntax-keyword)',
  },
  '.cm-header-2': {
    fontSize: theme.fontSize.headingLarge,
    fontWeight: 'bold',
    color: 'var(--color-syntax-keyword)',
  },
  '.cm-header-3': {
    fontSize: theme.fontSize.heading,
    fontWeight: 'bold',
    color: 'var(--color-syntax-keyword)',
  },
  '.cm-header-4, .cm-header-5, .cm-header-6': {
    fontWeight: 'bold',
    color: 'var(--color-syntax-keyword)',
  },
  '.cm-strong': {
    fontWeight: 'bold',
    color: 'var(--color-syntax-selector)',
  },
  '.cm-emphasis': {
    fontStyle: 'italic',
    color: 'var(--color-syntax-emphasis)',
  },
  '.cm-link': {
    color: 'var(--color-syntax-type)',
    textDecoration: 'underline',
  },
  '.cm-url': {
    color: 'var(--color-syntax-type)',
    textDecoration: 'underline',
  },
  '.cm-code': {
    backgroundColor: 'var(--color-editor-inline-code-bg)',
    color: 'var(--color-syntax-string)',
    padding: '2px 4px',
    borderRadius: '3px',
  },
  '.cm-codeblock': {
    backgroundColor: 'var(--color-editor-code-block-bg)',
    display: 'block',
    padding: '8px',
    borderRadius: '4px',
    marginTop: '4px',
    marginBottom: '4px',
  },
  '.cm-quote': {
    color: 'var(--color-syntax-comment)',
    borderLeft: '3px solid var(--color-editor-blockquote-border)',
    paddingLeft: '8px',
    fontStyle: 'italic',
  },
  '.cm-list': {
    color: 'var(--color-syntax-default)',
  },
  '.cm-hr': {
    color: 'var(--color-editor-line-rule)',
  },
  '.cm-strikethrough': {
    textDecoration: 'line-through',
    color: 'var(--color-editor-strikethrough)',
  },
})

const scrollableContainerStyles: CSSProperties = {
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  minHeight: 0,
}

const scrollableInnerStyles: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  position: 'relative',
  backgroundColor: 'var(--color-editor-background)',
}

export const MarkdownEditor = memo(forwardRef<MarkdownEditorRef, MarkdownEditorProps>(function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Enter agent description in markdown…',
  readOnly = false,
  className = '',
  fileReferenceProvider,
}, ref) {
  const editorConfig = useMemo(() => EditorState.tabSize.of(2), [])
  const lastValueRef = useRef(value)
  const [internalValue, setInternalValue] = useState(value)
  const editorViewRef = useRef<EditorView | null>(null)
  const toast = useOptionalToast()

  const fileReferenceExtensions = useMemo<Extension[]>(() => {
    if (!fileReferenceProvider) {
      return []
    }
    return [createFileReferenceAutocomplete(fileReferenceProvider)]
  }, [fileReferenceProvider])

  const pasteGuardExtension = useMemo<Extension>(() => EditorView.domEventHandlers({
    paste: (event) => {
      const clipboardEvent = event as ClipboardEvent
      return handleMarkdownPaste(clipboardEvent, toast)
    },
  }), [toast])

  const extensions = useMemo(() => [
    markdown(),
    customTheme,
    syntaxHighlighting,
    EditorView.lineWrapping,
    editorConfig,
    pasteGuardExtension,
    ...fileReferenceExtensions,
  ], [editorConfig, fileReferenceExtensions, pasteGuardExtension])

  // Only update internal value if the prop value actually changed
  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value
      setInternalValue(value)
    }
  }, [value])

  const handleChange = useCallback((val: string) => {
    setInternalValue(val)
    onChange(val)
  }, [onChange])

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (editorViewRef.current) {
        editorViewRef.current.focus()
      }
    },
    focusEnd: () => {
      if (editorViewRef.current) {
        editorViewRef.current.focus()
        const doc = editorViewRef.current.state.doc
        const endPos = doc.length
        editorViewRef.current.dispatch({
          selection: { anchor: endPos, head: endPos },
          scrollIntoView: true
        })
      }
    }
  }), [])

  return (
    <div className={`markdown-editor-container ${className}`} style={scrollableContainerStyles}>
      <div
        className="markdown-editor-scroll"
        style={scrollableInnerStyles}
      >
        <CodeMirror
          value={internalValue}
          onChange={handleChange}
          extensions={extensions}
          theme={undefined}
          placeholder={placeholder}
          editable={!readOnly}
          onCreateEditor={(view) => {
            editorViewRef.current = view
          }}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            dropCursor: false,
            allowMultipleSelections: false,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: false,
            autocompletion: false,
            rectangularSelection: false,
            highlightSelectionMatches: false,
            searchKeymap: false,
          }}
        />
      </div>
    </div>
  )
}))
