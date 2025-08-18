import { useMemo, useCallback, memo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorState } from '@codemirror/state'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  className?: string
}

const createTheme = (): Extension => {
  return EditorView.theme({
    '&': {
      fontSize: '14px',
    },
    '.cm-editor': {
      height: 'auto',
      minHeight: '100%',
    },
    '.cm-editor.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      lineHeight: '1.5',
      minHeight: '100%',
    },
    '.cm-content': {
      padding: '12px',
      minHeight: '100%',
    },
    '.cm-line': {
      padding: '0 2px',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
    },
    '.cm-cursor': {
      borderLeftColor: '#e4e4e7',
    },
    '.cm-selectionBackground': {
      backgroundColor: 'rgba(59, 130, 246, 0.3)',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(59, 130, 246, 0.4)',
    },
  }, { dark: true })
}

const customTheme = EditorView.theme({
  '&': {
    color: '#d4d4d4',
    backgroundColor: '#1e1e1e',
  },
  '.cm-content': {
    caretColor: '#d4d4d4',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#d4d4d4',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(38, 79, 120, 0.6)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  '.cm-gutters': {
    backgroundColor: '#1e1e1e',
    color: '#858585',
    border: 'none',
  },
  '.cm-lineNumbers .cm-activeLineGutter': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    color: '#c6c6c6',
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
  backgroundColor: '#1e1e1e',
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
    createTheme(),
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
          theme={oneDark}
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