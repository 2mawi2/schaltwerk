import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { theme } from '../../common/theme'
import { useProject } from '../../contexts/ProjectContext'
import { useToast } from '../../common/toast/ToastProvider'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import type { ChangedFile } from '../../common/events'
import { logger } from '../../utils/logger'
import type { DiffResponse } from '../../types/diff'

import {
  wrapBlock,
  computeTokens,
  buildSpecSection,
  buildDiffSections,
  buildFileSections
} from './bundleUtils'

interface CopyBundleBarProps {
  sessionName: string
}

type SectionName = 'Spec' | 'Diff' | 'Files'

type SelectionState = {
  spec: boolean
  diff: boolean
  files: boolean
}

interface AvailabilityState {
  spec: boolean
  diff: boolean
  files: boolean
}

const LARGE_BUNDLE_BYTES = 3 * 1024 * 1024

function deriveDefaultSelection(availability: AvailabilityState): SelectionState {
  return {
    spec: availability.spec,
    diff: !availability.spec && availability.diff,
    files: false,
  }
}

function sanitizeSelection(base: SelectionState, availability: AvailabilityState): SelectionState {
  const sanitized: SelectionState = {
    spec: base.spec && availability.spec,
    diff: base.diff && availability.diff,
    files: base.files && availability.files,
  }

  if (!sanitized.spec && !sanitized.diff && !sanitized.files) {
    return deriveDefaultSelection(availability)
  }

  return sanitized
}

function formatSectionSummary(sections: SectionName[], fileCount: number) {
  if (sections.length === 0) return 'Nothing selected'
  return sections
    .map((section) => {
      if (section === 'Files') {
        return fileCount === 1 ? '1 file' : `${fileCount} files`
      }
      return section
    })
    .join(' + ')
}

async function writeClipboard(text: string) {
  try {
    await invoke(TauriCommands.ClipboardWriteText, { text })
    return true
  } catch (err) {
    logger.warn('[CopyBundleBar] Native clipboard write failed, falling back to browser API', err)
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (browserErr) {
      logger.error('[CopyBundleBar] Browser clipboard write failed', browserErr)
      return false
    }
  }

  return false
}

export function CopyBundleBar({ sessionName }: CopyBundleBarProps) {
  const { projectPath } = useProject()
  const { pushToast } = useToast()

  const [availability, setAvailability] = useState<AvailabilityState>({ spec: false, diff: false, files: false })
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([])
  const [fileCount, setFileCount] = useState<number>(0)
  const [selection, setSelection] = useState<SelectionState>({ spec: false, diff: false, files: false })
  const [isCopying, setIsCopying] = useState(false)
  const [tokenCount, setTokenCount] = useState<number | null>(null)
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false)

  const specCacheRef = useRef<string | null>(null)
  const diffCacheRef = useRef<Map<string, DiffResponse>>(new Map())
  const fileCacheRef = useRef<Map<string, { base: string; head: string }>>(new Map())
  const tokenJobRef = useRef(0)

  const storageKey = useMemo(() => {
    const projectKey = projectPath ?? 'unknown-project'
    return `copy-bundle:${projectKey}:${sessionName}`
  }, [projectPath, sessionName])

  const nothingSelected = !selection.spec && !selection.diff && !selection.files
  const availabilitySnapshot = useMemo(() => ({
    spec: availability.spec,
    diff: availability.diff,
    files: availability.files,
  }), [availability.spec, availability.diff, availability.files])



  const copyButtonStyleVars = useMemo(() => ({
    '--copy-btn-bg': theme.colors.accent.blue.DEFAULT,
    '--copy-btn-bg-hover': theme.colors.accent.blue.dark,
    '--copy-btn-text': theme.colors.background.primary,
    '--copy-btn-text-hover': theme.colors.background.primary,
    '--copy-btn-border': theme.colors.accent.blue.DEFAULT,
  }) as CSSProperties, [])

  const resetCaches = useCallback(() => {
    specCacheRef.current = null
    diffCacheRef.current.clear()
    fileCacheRef.current.clear()
    setTokenCount(null)
  }, [])

  useEffect(() => {
    resetCaches()
  }, [sessionName, resetCaches])

  const fetchSpecText = useCallback(async () => {
    if (specCacheRef.current !== null) return specCacheRef.current
    const [draftContent, initialPrompt] = await invoke<[string | null, string | null]>(TauriCommands.SchaltwerkCoreGetSessionAgentContent, { name: sessionName })
    const specText = (draftContent ?? initialPrompt ?? '').trimEnd()
    specCacheRef.current = specText
    return specText
  }, [sessionName])

  const fetchDiff = useCallback(async (filePath: string) => {
    const cached = diffCacheRef.current.get(filePath)
    if (cached) return cached
    const diff = await invoke<DiffResponse>(TauriCommands.ComputeUnifiedDiffBackend, { sessionName, filePath })
    diffCacheRef.current.set(filePath, diff)
    return diff
  }, [sessionName])

  const fetchFileContents = useCallback(async (filePath: string) => {
    const cached = fileCacheRef.current.get(filePath)
    if (cached) return cached
    const [base, head] = await invoke<[string, string]>(TauriCommands.GetFileDiffFromMain, { sessionName, filePath })
    const value = { base, head }
    fileCacheRef.current.set(filePath, value)
    return value
  }, [sessionName])

  const assembleBundle = useCallback(async () => {
    const sections: string[] = []
    const included: SectionName[] = []

    if (selection.spec && availability.spec) {
      try {
        const specText = await fetchSpecText()
        if (specText.length > 0) {
          const section = buildSpecSection(specText)
          sections.push(wrapBlock(section.header, section.body, section.fence))
          included.push('Spec')
        }
      } catch (err) {
        logger.error('[CopyBundleBar] Failed to load spec content for copy', err)
      }
    }

    if (selection.diff && availability.diff) {
      try {
        const diffSections = await buildDiffSections(changedFiles, fetchDiff)
        if (diffSections.length > 0) {
          const diffBlocks = diffSections.map(section => wrapBlock(section.header, section.body, section.fence))
          sections.push(['## Diff', '', diffBlocks.join('\n\n')].join('\n'))
          included.push('Diff')
        }
      } catch (err) {
        logger.error('[CopyBundleBar] Failed to load diff sections', err)
      }
    }

    if (selection.files && availability.files) {
      try {
        const fileSections = await buildFileSections(changedFiles, fetchFileContents)
        if (fileSections.length > 0) {
          const fileBlocks = fileSections.map(section => wrapBlock(section.header, section.body, section.fence))
          sections.push(['## Touched files', '', fileBlocks.join('\n\n')].join('\n'))
          included.push('Files')
        }
      } catch (err) {
        logger.error('[CopyBundleBar] Failed to load file sections', err)
      }
    }

    const text = sections.join('\n\n').trim()
    const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
    const sizeBytes = encoder ? encoder.encode(text).length : text.length

    return { text, included, sizeBytes }
  }, [availability.diff, availability.files, availability.spec, changedFiles, fetchDiff, fetchFileContents, fetchSpecText, selection])

  const loadInitialData = useCallback(async () => {
    try {
      const [specPair, files] = await Promise.all([
        invoke<[string | null, string | null]>(TauriCommands.SchaltwerkCoreGetSessionAgentContent, { name: sessionName }),
        invoke<ChangedFile[]>(TauriCommands.GetChangedFilesFromMain, { sessionName }),
      ])

      const specText = (specPair?.[0] ?? specPair?.[1] ?? '').trimEnd()
      specCacheRef.current = specText
      const hasSpec = specText.length > 0
      const diffAvailable = files.length > 0

      setAvailability({ spec: hasSpec, diff: diffAvailable, files: diffAvailable })
      setChangedFiles(files)
      setFileCount(files.length)
      setHasLoadedInitial(true)
    } catch (err) {
      logger.error('[CopyBundleBar] Failed to load initial data', err)
      setAvailability({ spec: false, diff: false, files: false })
      setChangedFiles([])
      setFileCount(0)
      setHasLoadedInitial(true)
    }
  }, [sessionName])

  useEffect(() => {
    let cancelled = false
    void loadInitialData()

    let unlistenFileChanges: (() => void) | null = null
    let unlistenSessionsRefreshed: (() => void) | null = null

    ;(async () => {
      try {
        unlistenFileChanges = await listenEvent(SchaltEvent.FileChanges, (payload) => {
          if (cancelled || payload.session_name !== sessionName) return
          setChangedFiles(payload.changed_files ?? [])
          setFileCount((payload.changed_files ?? []).length)
          const hasDiff = (payload.changed_files ?? []).length > 0
          setAvailability(prev => ({ ...prev, diff: hasDiff, files: hasDiff }))
          diffCacheRef.current.clear()
          fileCacheRef.current.clear()
        })
      } catch (err) {
        logger.warn('[CopyBundleBar] Failed to listen for file changes', err)
      }

      try {
        unlistenSessionsRefreshed = await listenEvent(SchaltEvent.SessionsRefreshed, async (sessions) => {
          if (cancelled) return
          const match = sessions?.find?.((session) => session.info.session_id === sessionName)
          if (!match) return
          try {
            const specPair = await invoke<[string | null, string | null]>(TauriCommands.SchaltwerkCoreGetSessionAgentContent, { name: sessionName })
            const specText = (specPair?.[0] ?? specPair?.[1] ?? '').trimEnd()
            specCacheRef.current = specText
            setAvailability(prev => ({ ...prev, spec: specText.length > 0 }))
          } catch (err) {
            logger.error('[CopyBundleBar] Failed to refresh spec availability', err)
          }
        })
      } catch (err) {
        logger.warn('[CopyBundleBar] Failed to listen for session refresh events', err)
      }
    })()

    return () => {
      cancelled = true
      if (unlistenFileChanges) unlistenFileChanges()
      if (unlistenSessionsRefreshed) unlistenSessionsRefreshed()
    }
  }, [loadInitialData, sessionName])

  useEffect(() => {
    if (!hasLoadedInitial) return

    let stored: SelectionState | null = null
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) stored = JSON.parse(raw) as SelectionState
    } catch (err) {
      logger.warn('[CopyBundleBar] Failed to read persisted selection', err)
    }

    const base = stored ?? deriveDefaultSelection(availabilitySnapshot)
    setSelection((prev) => {
      const sanitized = sanitizeSelection(base, availabilitySnapshot)
      if (
        prev.spec === sanitized.spec &&
        prev.diff === sanitized.diff &&
        prev.files === sanitized.files
      ) {
        return prev
      }
      return sanitized
    })
  }, [availabilitySnapshot, hasLoadedInitial, storageKey])

  useEffect(() => {
    if (!hasLoadedInitial) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(selection))
    } catch (err) {
      logger.warn('[CopyBundleBar] Failed to persist selection', err)
    }
  }, [selection, storageKey, hasLoadedInitial])

  useEffect(() => {
    if (!hasLoadedInitial) return
    if (nothingSelected) {
      setTokenCount(0)
      return
    }

    let cancelled = false
    const job = ++tokenJobRef.current

    void (async () => {
      try {
        const { text } = await assembleBundle()
        if (cancelled || tokenJobRef.current !== job) return
        const tokens = computeTokens(text)
        setTokenCount(tokens)
      } catch (err) {
        if (!cancelled) {
          logger.error('[CopyBundleBar] Failed to assemble bundle for token count', err)
          setTokenCount(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [assembleBundle, hasLoadedInitial, nothingSelected])

  const handleToggle = useCallback((key: keyof SelectionState, value: boolean) => {
    setSelection((prev) => ({ ...prev, [key]: value }))
  }, [])



  const handleCopy = useCallback(async () => {
    if (nothingSelected) return
    setIsCopying(true)
    try {
      const { text, included, sizeBytes } = await assembleBundle()
      if (!text) {
        pushToast({ tone: 'warning', title: 'Nothing to copy', description: 'No bundle content available.' })
        return
      }

      const success = await writeClipboard(text)
      if (!success) {
        pushToast({ tone: 'error', title: 'Clipboard blocked', description: 'Clipboard access was denied.' })
        return
      }

      const tokens = computeTokens(text)
      if (tokens !== null) {
        setTokenCount(tokens)
      }

      pushToast({
        tone: 'success',
        title: 'Copied to clipboard',
        description: formatSectionSummary(included, fileCount),
      })

      if (sizeBytes > LARGE_BUNDLE_BYTES) {
        const megabytes = (sizeBytes / (1024 * 1024)).toFixed(1)
        pushToast({
          tone: 'warning',
          title: `Copied ${megabytes} MB`,
          description: 'Clipboard may truncate large bundles in some apps.',
        })
      }
    } catch (err) {
      logger.error('[CopyBundleBar] Clipboard copy failed', err)
      pushToast({ tone: 'error', title: 'Copy failed', description: 'Unable to build bundle.' })
    } finally {
      setIsCopying(false)
    }
  }, [assembleBundle, fileCount, nothingSelected, pushToast])

  return (
    <div
      className="flex items-center gap-4 px-3 py-2 whitespace-nowrap"
      aria-label="copy-bundle-bar"
      style={{
        borderBottom: `1px solid ${theme.colors.border.subtle}`,
        backgroundColor: theme.colors.background.elevated,
      }}
    >
       <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={selection.spec}
            disabled={!availability.spec}
            onChange={(event) => handleToggle('spec', event.currentTarget.checked)}
            title={availability.spec ? 'Include spec content' : 'Spec content unavailable'}
          />
          <span>Spec</span>
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={selection.diff}
            disabled={!availability.diff}
            onChange={(event) => handleToggle('diff', event.currentTarget.checked)}
            title={availability.diff ? `Include diff (${fileCount})` : 'No diff available'}
          />
          <span className="flex items-center gap-1">
            Diff
            {availability.diff && (
              <span
                className="rounded-sm px-1 text-[10px]"
                style={{
                  backgroundColor: theme.colors.background.primary,
                  color: theme.colors.text.secondary,
                  border: `1px solid ${theme.colors.border.subtle}`,
                }}
              >
                {fileCount}
              </span>
            )}
          </span>
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={selection.files}
            disabled={!availability.files}
            onChange={(event) => handleToggle('files', event.currentTarget.checked)}
            title={availability.files ? `Include file contents (${fileCount})` : 'No touched files'}
          />
          <span className="flex items-center gap-1">
            Files
            {availability.files && (
              <span
                className="rounded-sm px-1 text-[10px]"
                style={{
                  backgroundColor: theme.colors.background.primary,
                  color: theme.colors.text.secondary,
                  border: `1px solid ${theme.colors.border.subtle}`,
                }}
              >
                {fileCount}
              </span>
            )}
          </span>
        </label>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="text-xs" title={tokenCount !== null ? `${tokenCount.toLocaleString()} tokens` : 'Token count unavailable'}>
          Tokens: {tokenCount !== null ? tokenCount.toLocaleString() : '—'}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          disabled={isCopying || nothingSelected}
          className="flex items-center px-3 h-[22px] text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-md border bg-[color:var(--copy-btn-bg)] text-[color:var(--copy-btn-text)] border-[color:var(--copy-btn-border)] hover:bg-[color:var(--copy-btn-bg-hover)] hover:text-[color:var(--copy-btn-text-hover)]"
          style={copyButtonStyleVars}
        >
          <span>Copy to clipboard</span>
        </button>
      </div>
    </div>
  )
}
