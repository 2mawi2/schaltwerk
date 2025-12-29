import { useState, useEffect, useCallback, memo, useMemo } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscChevronLeft, VscCode, VscPreview, VscFileBinary, VscWarning, VscGoToFile } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { MarkdownRenderer } from '../specs/MarkdownRenderer'
import { useSelection } from '../../hooks/useSelection'
import { useHighlightWorker } from '../../hooks/useHighlightWorker'
import { useOpenInEditor } from '../../hooks/useOpenInEditor'
import { getLanguageFromPath, isMarkdownFile } from '../../utils/fileTypes'

interface FileContentViewerProps {
  filePath: string | null
  onBack: () => void
  sessionNameOverride?: string
}

interface FileContentResponse {
  content: string
  is_binary: boolean
  size_bytes: number
  language: string | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface CodeContentProps {
  content: string
  highlightedLines: string[]
}

const CodeContent = memo(function CodeContent({
  content,
  highlightedLines,
}: CodeContentProps) {
  const lines = content.split('\n')

  return (
    <div
      className="h-full overflow-auto font-mono text-sm hljs"
      style={{
        backgroundColor: theme.colors.background.primary,
        fontFamily: theme.fontFamily.mono,
        fontSize: theme.fontSize.code,
      }}
    >
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, index) => {
            const highlighted = highlightedLines[index]
            return (
              <tr key={index} className="hover:bg-slate-800/30">
                <td
                  className="select-none text-right pr-4 pl-4"
                  style={{
                    color: theme.colors.text.muted,
                    minWidth: '3em',
                    userSelect: 'none',
                  }}
                >
                  {index + 1}
                </td>
                <td
                  className="pr-4"
                  style={{
                    color: theme.colors.text.primary,
                    whiteSpace: 'pre',
                  }}
                  dangerouslySetInnerHTML={highlighted ? { __html: highlighted } : undefined}
                >
                  {highlighted ? undefined : (line || ' ')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})

export function FileContentViewer({
  filePath,
  onBack,
  sessionNameOverride,
}: FileContentViewerProps) {
  const { selection } = useSelection()
  const [content, setContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isBinary, setIsBinary] = useState(false)
  const [fileSize, setFileSize] = useState<number>(0)
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview')
  const { requestBlockHighlight, readBlockLine } = useHighlightWorker()
  const { openInEditor } = useOpenInEditor({ sessionNameOverride })

  const sessionName =
    sessionNameOverride ?? (selection.kind === 'session' ? selection.payload : null)

  const language = filePath ? getLanguageFromPath(filePath) : null
  const cacheKey = filePath ? `file-viewer::${filePath}` : ''

  const loadContent = useCallback(async () => {
    if (!filePath) return

    setIsLoading(true)
    setError(null)
    setContent(null)
    setIsBinary(false)

    try {
      const response = await invoke<FileContentResponse>(TauriCommands.ReadProjectFile, {
        sessionName,
        filePath,
      })

      setFileSize(response.size_bytes)

      if (response.is_binary) {
        setIsBinary(true)
        setContent(null)
      } else if (response.content === '' && response.size_bytes > 0) {
        setError(`File too large to display (${formatBytes(response.size_bytes)})`)
        setContent(null)
      } else {
        setContent(response.content)
      }
    } catch (err) {
      logger.error('Failed to load file content:', err)
      setError(typeof err === 'string' ? err : 'Failed to load file')
    } finally {
      setIsLoading(false)
    }
  }, [filePath, sessionName])

  useEffect(() => {
    void loadContent()
  }, [loadContent])

  useEffect(() => {
    if (filePath && isMarkdownFile(filePath)) {
      setViewMode('preview')
    } else {
      setViewMode('raw')
    }
  }, [filePath])

  const contentLines = useMemo(() => content ? content.split('\n') : [], [content])

  useEffect(() => {
    if (!content || !cacheKey || isMarkdownFile(filePath ?? '')) return

    requestBlockHighlight({
      cacheKey,
      lines: contentLines,
      language,
      autoDetect: !language,
    })
  }, [content, cacheKey, language, filePath, contentLines, requestBlockHighlight])

  // NOTE: Do NOT memoize this - readBlockLine is a stable ref but the underlying
  // cache updates asynchronously. The hook calls forceRender() when highlighting
  // completes, which triggers a re-render. We need to recompute on each render
  // to pick up the updated cache values.
  const highlightedLines = cacheKey
    ? contentLines.map((line, index) => readBlockLine(cacheKey, index, line))
    : contentLines

  if (!filePath) {
    return null
  }

  const fileName = filePath.split('/').pop() || filePath
  const isMarkdown = isMarkdownFile(filePath)

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center" style={{ color: theme.colors.text.muted }}>
            <div className="text-sm">Loading...</div>
          </div>
        </div>
      )
    }

    if (error) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center" style={{ color: theme.colors.text.muted }}>
            <VscWarning className="mx-auto mb-2 text-4xl" style={{ color: theme.colors.accent.amber.DEFAULT }} />
            <div className="text-sm">{error}</div>
          </div>
        </div>
      )
    }

    if (isBinary) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center" style={{ color: theme.colors.text.muted }}>
            <VscFileBinary className="mx-auto mb-2 text-4xl opacity-50" />
            <div className="text-sm">Binary file</div>
            <div className="text-xs mt-1">{formatBytes(fileSize)}</div>
          </div>
        </div>
      )
    }

    if (content === null) {
      return null
    }

    if (isMarkdown && viewMode === 'preview') {
      return <MarkdownRenderer content={content} />
    }

    return <CodeContent content={content} highlightedLines={highlightedLines} />
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: theme.colors.border.subtle, backgroundColor: theme.colors.background.primary }}
      >
        <button
          onClick={onBack}
          className="group pl-2 pr-3 py-1 rounded text-xs font-medium flex items-center gap-2 transition-colors"
          style={{ color: theme.colors.text.muted }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = theme.colors.text.primary
            e.currentTarget.style.backgroundColor = theme.colors.background.elevated
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = theme.colors.text.muted
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <VscChevronLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <div className="flex-1 mx-4 truncate text-center">
          <span className="text-sm font-medium" style={{ color: theme.colors.text.primary }}>
            {fileName}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {isMarkdown && content !== null && (
            <>
              <button
                onClick={() => setViewMode('preview')}
                className="p-1.5 rounded transition-colors"
                title="Preview"
                style={{
                  color: viewMode === 'preview' ? theme.colors.accent.blue.DEFAULT : theme.colors.text.muted,
                  backgroundColor: viewMode === 'preview' ? theme.colors.background.elevated : 'transparent',
                }}
              >
                <VscPreview className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className="p-1.5 rounded transition-colors"
                title="Raw"
                style={{
                  color: viewMode === 'raw' ? theme.colors.accent.blue.DEFAULT : theme.colors.text.muted,
                  backgroundColor: viewMode === 'raw' ? theme.colors.background.elevated : 'transparent',
                }}
              >
                <VscCode className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={() => { if (filePath) void openInEditor(filePath) }}
            className="p-1.5 rounded transition-colors"
            title="Open in editor"
            style={{ color: theme.colors.text.muted }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = theme.colors.text.primary
              e.currentTarget.style.backgroundColor = theme.colors.background.elevated
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = theme.colors.text.muted
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            <VscGoToFile className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">{renderContent()}</div>
    </div>
  )
}
