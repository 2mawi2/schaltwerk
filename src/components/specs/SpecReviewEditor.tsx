import { useEffect, useRef, useMemo, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView, Decoration, DecorationSet } from '@codemirror/view'
import { StateField, StateEffect, RangeSet } from '@codemirror/state'
import { lineNumbers } from '@codemirror/view'
import { theme } from '../../common/theme'
import type { SpecLineSelection } from '../../hooks/useSpecLineSelection'

interface SpecReviewEditorProps {
  content: string
  specId: string
  selection: SpecLineSelection | null
  onLineClick: (lineNum: number, specId: string, event?: React.MouseEvent) => void
  onLineMouseEnter?: (lineNum: number) => void
  onLineMouseUp?: (event: MouseEvent) => void
  className?: string
}

const editorColors = theme.colors.editor

const customTheme = EditorView.theme({
  '&': {
    color: editorColors.text,
    backgroundColor: editorColors.background,
    fontSize: theme.fontSize.body,
    height: '100%',
  },
  '.cm-editor': {
    backgroundColor: editorColors.background,
    height: '100%',
    minHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  '.cm-content': {
    caretColor: 'transparent',
    backgroundColor: editorColors.background,
    padding: '12px 12px 12px 0',
    minHeight: '100%',
    cursor: 'default',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.5',
    minHeight: '100%',
    height: '100%',
    overflowY: 'auto',
  },
  '.cm-line': {
    padding: '0 8px 0 4px',
    cursor: 'pointer',
  },
  '.cm-line:hover': {
    backgroundColor: `${theme.colors.background.elevated}`,
  },
  '.cm-gutters': {
    backgroundColor: editorColors.background,
    color: editorColors.gutterText,
    border: 'none',
    borderRight: `1px solid ${theme.colors.border.subtle}`,
    cursor: 'pointer',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '40px',
    textAlign: 'right',
  },
  '.cm-lineNumbers .cm-gutterElement:hover': {
    backgroundColor: `${theme.colors.background.elevated}`,
    color: editorColors.gutterActiveText,
  },
  '.cm-selectionBackground': {
    backgroundColor: 'transparent !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'transparent !important',
  },
  '.cm-selected-line': {
    backgroundColor: `${theme.colors.accent.cyan.bg} !important`,
  },
  '.cm-selected-line:hover': {
    backgroundColor: `${theme.colors.accent.cyan.light}33 !important`,
  },
}, { dark: true })

const selectedLineEffect = StateEffect.define<{ from: number; to: number } | null>()

const selectedLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(selectedLineEffect)) {
        if (effect.value === null) {
          return Decoration.none
        }
        const { from, to } = effect.value
        const decorationList: { from: number; to: number; decoration: Decoration }[] = []
        const doc = tr.state.doc
        for (let line = from; line <= to && line <= doc.lines; line++) {
          const lineStart = doc.line(line).from
          decorationList.push({
            from: lineStart,
            to: lineStart,
            decoration: Decoration.line({ class: 'cm-selected-line' })
          })
        }
        return RangeSet.of(decorationList.map(d => d.decoration.range(d.from)))
      }
    }
    return decorations
  },
  provide: f => EditorView.decorations.from(f)
})

export function SpecReviewEditor({
  content,
  specId,
  selection,
  onLineClick,
  onLineMouseEnter,
  onLineMouseUp,
  className = ''
}: SpecReviewEditorProps) {
  const editorViewRef = useRef<EditorView | null>(null)
  const isDraggingRef = useRef(false)
  const specIdRef = useRef(specId)

  useEffect(() => {
    specIdRef.current = specId
  }, [specId])

  const onLineClickRef = useRef(onLineClick)
  const onLineMouseEnterRef = useRef(onLineMouseEnter)
  const onLineMouseUpRef = useRef(onLineMouseUp)

  useEffect(() => {
    onLineClickRef.current = onLineClick
    onLineMouseEnterRef.current = onLineMouseEnter
    onLineMouseUpRef.current = onLineMouseUp
  }, [onLineClick, onLineMouseEnter, onLineMouseUp])

  useEffect(() => {
    if (!editorViewRef.current) return

    if (!selection || selection.specId !== specId) {
      editorViewRef.current.dispatch({
        effects: selectedLineEffect.of(null)
      })
    } else {
      editorViewRef.current.dispatch({
        effects: selectedLineEffect.of({ from: selection.startLine, to: selection.endLine })
      })
    }
  }, [selection, specId])

  const getLineFromPos = useCallback((view: EditorView, pos: number): number => {
    return view.state.doc.lineAt(pos).number
  }, [])

  const mouseHandlers = useMemo(() => EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false

      const lineNum = getLineFromPos(view, pos)
      isDraggingRef.current = true

      const reactEvent = {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
      } as React.MouseEvent

      onLineClickRef.current(lineNum, specIdRef.current, reactEvent)
      return true
    },
    mousemove: (event, view) => {
      if (!isDraggingRef.current) return false

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false

      const lineNum = getLineFromPos(view, pos)
      onLineMouseEnterRef.current?.(lineNum)
      return false
    },
    mouseup: (event: MouseEvent) => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        onLineMouseUpRef.current?.(event)
      }
      return false
    },
    mouseleave: (event: MouseEvent) => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        onLineMouseUpRef.current?.(event)
      }
      return false
    }
  }), [getLineFromPos])

  const extensions = useMemo(() => [
    markdown(),
    customTheme,
    EditorView.lineWrapping,
    EditorView.editable.of(false),
    lineNumbers(),
    selectedLineField,
    mouseHandlers,
  ], [mouseHandlers])

  return (
    <div className={`spec-review-editor h-full ${className}`}>
      <CodeMirror
        value={content}
        extensions={extensions}
        theme={undefined}
        editable={false}
        onCreateEditor={(view) => {
          editorViewRef.current = view
          if (selection && selection.specId === specId) {
            view.dispatch({
              effects: selectedLineEffect.of({ from: selection.startLine, to: selection.endLine })
            })
          }
        }}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: false,
          bracketMatching: false,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          highlightSelectionMatches: false,
          searchKeymap: false,
        }}
      />
    </div>
  )
}
