import { useEffect, useRef, useState } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscEye, VscEdit } from 'react-icons/vsc'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { MarkdownEditor, type MarkdownEditorRef } from './MarkdownEditor'
import { useSpecContentCache } from '../../hooks/useSpecContentCache'
import { MarkdownRenderer } from './MarkdownRenderer'
import { theme } from '../../common/theme'

interface Props {
  sessionName: string
  editable?: boolean
  debounceMs?: number
  sessionState?: 'spec' | 'running' | 'reviewed'
}

export function SpecContentView({ sessionName, editable = true, debounceMs = 1000, sessionState }: Props) {
  const { content, loading, error, updateContent } = useSpecContentCache(sessionName, sessionState)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')
  type TimeoutHandle = ReturnType<typeof setTimeout> | number
  const saveTimerRef = useRef<TimeoutHandle | null>(null)
  const markdownEditorRef = useRef<MarkdownEditorRef>(null)

  // Auto-save
  useEffect(() => {
    if (!editable) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        if (!editable) return
        try {
          setSaving(true)
          await invoke(TauriCommands.SchaltwerkCoreUpdateSpecContent, { name: sessionName, content })
        } catch (e) {
          logger.error('[DraftContentView] Failed to save spec:', e)
        } finally {
          setSaving(false)
        }
      })()
    }, debounceMs)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [content, editable, debounceMs, sessionName])

  // Local copy button removed

  // Handle Cmd+T to focus spec content
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 't' || e.key === 'T')) {
        // Focus the spec editor
        e.preventDefault()
        // Removed stopPropagation() to allow cmd+e to work
        
        // Focus the markdown editor
        if (markdownEditorRef.current) {
          markdownEditorRef.current.focus()
          logger.info('[SpecContentView] Focused spec content via Cmd+T')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown) // Use bubble phase to not interfere with cmd+e
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])


  if (loading && content === '') {
    return (
      <div className="h-full flex items-center justify-center">
        <AnimatedText text="loading" size="md" />
      </div>
    )
  }

  if (editable) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div style={{ fontSize: theme.fontSize.caption, color: theme.colors.text.muted }}>
              {saving ? 'Saving…' : error ? <span style={{ color: theme.colors.accent.red.DEFAULT }}>{error}</span> : viewMode === 'edit' ? 'Editing spec' : 'Preview mode'}
            </div>
            {viewMode === 'edit' && (
              <span style={{ fontSize: theme.fontSize.caption, color: theme.colors.text.muted, backgroundColor: theme.colors.background.elevated, padding: '0.125rem 0.375rem', borderRadius: '0.25rem' }} title="Focus spec content (⌘T)">⌘T</span>
            )}
          </div>
          <button
            onClick={() => setViewMode(viewMode === 'edit' ? 'preview' : 'edit')}
            style={{ fontSize: theme.fontSize.caption, padding: '0.25rem 0.5rem', borderRadius: '0.25rem', backgroundColor: theme.colors.background.elevated, color: theme.colors.text.primary }}
            className="hover:bg-slate-600 flex items-center gap-1"
            title={viewMode === 'edit' ? 'Preview markdown' : 'Edit markdown'}
          >
            {viewMode === 'edit' ? <VscEye /> : <VscEdit />}
            {viewMode === 'edit' ? 'Preview' : 'Edit'}
          </button>
        </div>
        {viewMode === 'edit' ? (
          <MarkdownEditor
            ref={markdownEditorRef}
            value={content}
            onChange={updateContent}
            placeholder="Enter agent description in markdown…"
            className="flex-1"
          />
        ) : (
          <div className="flex-1 overflow-hidden">
            <MarkdownRenderer content={content} className="h-full" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div style={{ fontSize: theme.fontSize.caption, color: theme.colors.text.muted }}>Spec</div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <MarkdownRenderer content={content} className="h-full" />
      </div>
    </div>
  )
}
