import { useMemo, useCallback, memo, useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { theme } from '../../common/theme'
import type { ProjectFileIndexApi } from '../../hooks/useProjectFileIndex'
import { createFileReferenceAutocomplete } from './fileReferenceAutocomplete'

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

const editorColors = theme.colors.editor
const syntaxColors = theme.colors.syntax

const customTheme = EditorView.theme({
  '&': {
    color: editorColors.text,
    backgroundColor: editorColors.background,
    fontSize: '14px',
  },
  '.cm-editor': {
    backgroundColor: editorColors.background,
    height: 'auto',
    minHeight: '100%',
  },
  '.cm-editor.cm-focused': {
    backgroundColor: editorColors.background,
    outline: 'none',
  },
  '.cm-content': {
    caretColor: editorColors.caret,
    backgroundColor: editorColors.background,
    padding: '12px',
    minHeight: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.5',
    minHeight: '100%',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: editorColors.caret,
  },
  '.cm-selectionBackground': {
    backgroundColor: `${editorColors.selection} !important`,
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: `${editorColors.focusedSelection} !important`,
  },
  '&.cm-focused .cm-content ::selection': {
    backgroundColor: `${editorColors.selection} !important`,
  },
  '.cm-content ::selection': {
    backgroundColor: `${editorColors.selection} !important`,
  },
  '.cm-activeLine': {
    backgroundColor: editorColors.selectionAlt,
  },
  '.cm-gutters': {
    backgroundColor: editorColors.background,
    color: editorColors.gutterText,
    border: 'none',
    borderRight: 'none',
  },
  '.cm-lineNumbers .cm-activeLineGutter': {
    backgroundColor: editorColors.selectionAlt,
    color: editorColors.gutterActiveText,
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-panels': {
    backgroundColor: editorColors.background,
  },
  '.cm-panels-bottom': {
    backgroundColor: editorColors.background,
  },
}, { dark: true })

const syntaxHighlighting = EditorView.theme({
  '.cm-header-1': {
    fontSize: '1.5em',
    fontWeight: 'bold',
    color: syntaxColors.keyword,
  },
  '.cm-header-2': {
    fontSize: '1.3em',
    fontWeight: 'bold',
    color: syntaxColors.keyword,
  },
  '.cm-header-3': {
    fontSize: '1.1em',
    fontWeight: 'bold',
    color: syntaxColors.keyword,
  },
  '.cm-header-4, .cm-header-5, .cm-header-6': {
    fontWeight: 'bold',
    color: syntaxColors.keyword,
  },
  '.cm-strong': {
    fontWeight: 'bold',
    color: syntaxColors.selector,
  },
  '.cm-emphasis': {
    fontStyle: 'italic',
    color: syntaxColors.emphasis,
  },
  '.cm-link': {
    color: syntaxColors.type,
    textDecoration: 'underline',
  },
  '.cm-url': {
    color: syntaxColors.type,
    textDecoration: 'underline',
  },
  '.cm-code': {
    backgroundColor: editorColors.inlineCodeBg,
    color: syntaxColors.string,
    padding: '2px 4px',
    borderRadius: '3px',
  },
  '.cm-codeblock': {
    backgroundColor: editorColors.codeBlockBg,
    display: 'block',
    padding: '8px',
    borderRadius: '4px',
    marginTop: '4px',
    marginBottom: '4px',
  },
  '.cm-quote': {
    color: syntaxColors.comment,
    borderLeft: `3px solid ${editorColors.blockquoteBorder}`,
    paddingLeft: '8px',
    fontStyle: 'italic',
  },
  '.cm-list': {
    color: syntaxColors.default,
  },
  '.cm-hr': {
    color: editorColors.lineRule,
  },
  '.cm-strikethrough': {
    textDecoration: 'line-through',
    color: editorColors.strikethrough,
  },
}, { dark: true })

const scrollableContainerStyles: React.CSSProperties = {
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  minHeight: 0,
}

const scrollableInnerStyles: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  position: 'relative',
  backgroundColor: editorColors.background,
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

  const fileReferenceExtensions = useMemo<Extension[]>(() => {
    if (!fileReferenceProvider) {
      return []
    }
    return [createFileReferenceAutocomplete(fileReferenceProvider)]
  }, [fileReferenceProvider])

  const extensions = useMemo(() => [
    markdown(),
    customTheme,
    syntaxHighlighting,
    EditorView.lineWrapping,
    editorConfig,
    ...fileReferenceExtensions,
  ], [editorConfig, fileReferenceExtensions])

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
      <div className="markdown-editor-scroll" style={scrollableInnerStyles}>
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
