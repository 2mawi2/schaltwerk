import { useMemo, useCallback, memo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  className?: string
}

const customTheme = EditorView.theme({
  '&': {
    color: '#e2e8f0',
    backgroundColor: '#0b1220',
    fontSize: '14px',
  },
  '.cm-editor': {
    backgroundColor: '#0b1220',
    height: 'auto',
    minHeight: '100%',
  },
  '.cm-editor.cm-focused': {
    backgroundColor: '#0b1220',
    outline: 'none',
  },
  '.cm-content': {
    caretColor: '#d4d4d4',
    backgroundColor: '#0b1220',
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
    borderLeftColor: '#d4d4d4',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(59, 130, 246, 0.3) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(59, 130, 246, 0.4) !important',
  },
  '&.cm-focused .cm-content ::selection': {
    backgroundColor: 'rgba(59, 130, 246, 0.3) !important',
  },
  '.cm-content ::selection': {
    backgroundColor: 'rgba(59, 130, 246, 0.3) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  '.cm-gutters': {
    backgroundColor: '#0b1220',
    color: '#475569',
    border: 'none',
    borderRight: 'none',
  },
  '.cm-lineNumbers .cm-activeLineGutter': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    color: '#c6c6c6',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-panels': {
    backgroundColor: '#0b1220',
  },
  '.cm-panels-bottom': {
    backgroundColor: '#0b1220',
  },
}, { dark: true })

const syntaxHighlighting = EditorView.theme({
  '.cm-header-1': {
    fontSize: '1.5em',
    fontWeight: 'bold',
    color: '#569cd6',
  },
  '.cm-header-2': {
    fontSize: '1.3em',
    fontWeight: 'bold',
    color: '#569cd6',
  },
  '.cm-header-3': {
    fontSize: '1.1em',
    fontWeight: 'bold',
    color: '#569cd6',
  },
  '.cm-header-4, .cm-header-5, .cm-header-6': {
    fontWeight: 'bold',
    color: '#569cd6',
  },
  '.cm-strong': {
    fontWeight: 'bold',
    color: '#d7ba7d',
  },
  '.cm-emphasis': {
    fontStyle: 'italic',
    color: '#c586c0',
  },
  '.cm-link': {
    color: '#4ec9b0',
    textDecoration: 'underline',
  },
  '.cm-url': {
    color: '#4ec9b0',
    textDecoration: 'underline',
  },
  '.cm-code': {
    backgroundColor: 'rgba(30, 30, 30, 0.8)',
    color: '#ce9178',
    padding: '2px 4px',
    borderRadius: '3px',
  },
  '.cm-codeblock': {
    backgroundColor: 'rgba(30, 30, 30, 0.5)',
    display: 'block',
    padding: '8px',
    borderRadius: '4px',
    marginTop: '4px',
    marginBottom: '4px',
  },
  '.cm-quote': {
    color: '#6a9955',
    borderLeft: '3px solid #404040',
    paddingLeft: '8px',
    fontStyle: 'italic',
  },
  '.cm-list': {
    color: '#d4d4d4',
  },
  '.cm-hr': {
    color: '#404040',
  },
  '.cm-strikethrough': {
    textDecoration: 'line-through',
    color: '#808080',
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
  backgroundColor: '#0b1220',
}

export const MarkdownEditor = memo(function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Enter task description in markdown…',
  readOnly = false,
  className = '',
}: MarkdownEditorProps) {
  const editorConfig = useMemo(() => EditorState.tabSize.of(2), [])

  const extensions = useMemo(() => [
    markdown(),
    customTheme,
    syntaxHighlighting,
    EditorView.lineWrapping,
    editorConfig,
  ], [editorConfig])

  const handleChange = useCallback((val: string) => {
    onChange(val)
  }, [onChange])

  return (
    <div className={`markdown-editor-container ${className}`} style={scrollableContainerStyles}>
      <div className="markdown-editor-scroll" style={scrollableInnerStyles}>
        <CodeMirror
          value={value}
          onChange={handleChange}
          extensions={extensions}
          theme={undefined}
          placeholder={placeholder}
          editable={!readOnly}
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
})