import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscCopy, VscClose } from 'react-icons/vsc'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import type { MarkdownEditorRef } from './MarkdownEditor'
import type { RawSession } from '../../types/session'

const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(m => ({ default: m.MarkdownEditor })))

interface Props {
  sessionName: string
  editable?: boolean
  debounceMs?: number
  sessionState?: 'spec' | 'running' | 'reviewed'
}

export function SpecContentView({ sessionName, editable = true, debounceMs = 1000 }: Props) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [attachedImages, setAttachedImages] = useState<string[]>([])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markdownEditorRef = useRef<MarkdownEditorRef>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)

    // Fetch both content and session info for attached images
    Promise.all([
      invoke<[string | null, string | null]>(TauriCommands.SchaltwerkCoreGetSessionAgentContent, { name: sessionName }),
      invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionName })
    ])
      .then(([[draftContent, initialPrompt], session]) => {
        if (!mounted) return
        const text: string = draftContent ?? initialPrompt ?? ''
        setContent(text)
        setAttachedImages(session.attached_images || [])
      })
      .catch((e) => {
        if (!mounted) return
        logger.error('Failed to get spec content:', e)
        setError(String(e))
      })
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [sessionName])

  // Auto-save
  useEffect(() => {
    if (!editable) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!editable) return
      try {
        setSaving(true)
        await invoke(TauriCommands.SchaltwerkCoreUpdateSpecContent, { name: sessionName, content })
      } catch (e) {
        logger.error('[DraftContentView] Failed to save spec:', e)
      } finally {
        setSaving(false)
      }
    }, debounceMs)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [content, editable, debounceMs, sessionName])

  const handleCopy = async () => {
    try {
      setCopying(true)
      await navigator.clipboard.writeText(content)
    } catch (err) {
      logger.error('[DraftContentView] Failed to copy content:', err)
    } finally {
      setTimeout(() => setCopying(false), 1000)
    }
  }

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


  if (loading) {
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
            <div className="text-xs text-slate-400">
              {saving ? 'Saving…' : error ? <span className="text-red-400">{error}</span> : 'Editing spec'}
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400" title="Focus spec content (⌘T)">⌘T</span>
          </div>
          <button
            onClick={handleCopy}
            disabled={copying || !content}
            className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Copy spec content"
          >
            <VscCopy />
            {copying ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* Attached Images Section */}
        {attachedImages.length > 0 && (
          <div className="px-3 py-2 border-b border-slate-800">
            <div className="text-xs text-slate-400 mb-2">Attached Images:</div>
            <div className="flex flex-wrap gap-2">
              {attachedImages.map((imagePath, index) => (
                <div key={index} className="relative group">
                  <img
                    src={`file://${imagePath}`}
                    alt={`Attached image ${index + 1}`}
                    className="w-16 h-16 object-cover rounded border border-slate-600"
                    title={imagePath}
                  />
                  <button
                    onClick={() => {
                      const newImages = attachedImages.filter((_, i) => i !== index)
                      setAttachedImages(newImages)
                      // TODO: Update backend to remove image from session
                    }}
                    className="absolute -top-1 -right-1 bg-red-600 hover:bg-red-700 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                  >
                    <VscClose size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center">
            <AnimatedText text="loading" size="md" />
          </div>
        }>
          <MarkdownEditor
            ref={markdownEditorRef}
            value={content}
            onChange={setContent}
            placeholder="Enter agent description in markdown…"
            className="flex-1"
          />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-400">Spec</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={copying || !content}
            className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Copy spec content"
          >
            <VscCopy />
            {copying ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Attached Images Section */}
      {attachedImages.length > 0 && (
        <div className="px-3 py-2 border-b border-slate-800">
          <div className="text-xs text-slate-400 mb-2">Attached Images:</div>
          <div className="flex flex-wrap gap-2">
            {attachedImages.map((imagePath, index) => (
              <div key={index} className="relative group">
                <img
                  src={`file://${imagePath}`}
                  alt={`Attached image ${index + 1}`}
                  className="w-16 h-16 object-cover rounded border border-slate-600"
                  title={imagePath}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <Suspense fallback={
          <div className="h-full flex items-center justify-center">
            <AnimatedText text="loading" size="md" />
          </div>
        }>
          <MarkdownEditor
            ref={markdownEditorRef}
            value={content}
            onChange={() => {}}
            readOnly={true}
            className="h-full"
          />
        </Suspense>
      </div>
    </div>
  )
}
