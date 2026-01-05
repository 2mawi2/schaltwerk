import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { useToast } from '../../common/toast/ToastProvider'
import { useTranslation } from '../../common/i18n'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import type { ChangedFile, SessionsRefreshedEventPayload } from '../../common/events'
import { logger } from '../../utils/logger'
import type { DiffResponse } from '../../types/diff'
import { writeClipboard } from '../../utils/clipboard'
import { useAtom, useAtomValue } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'
import { isSessionMissingError } from '../../types/errors'
import {
  buildCopyContextChangedFilesSelectionKey,
  buildCopyContextBundleSelectionKey,
  copyContextBundleSelectionAtomFamily,
  copyContextChangedFilesSelectionAtomFamily
} from '../../store/atoms/copyContextSelection'

import {
  wrapBlock,
  computeTokens,
  buildSpecSection,
  buildDiffSections,
  buildFileSections
} from './bundleUtils'

interface CopyContextBarProps {
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

function formatSectionSummary(
  sections: SectionName[],
  fileCount: number,
  translations: { nothingSelected: string; oneFile: string; nFiles: string }
) {
  if (sections.length === 0) return translations.nothingSelected
  return sections
    .map((section) => {
      if (section === 'Files') {
        return fileCount === 1 ? translations.oneFile : translations.nFiles.replace('{count}', String(fileCount))
      }
      return section
    })
    .join(' + ')
}

export function CopyContextBar({ sessionName }: CopyContextBarProps) {
  const { t } = useTranslation()
  const projectPath = useAtomValue(projectPathAtom)
  const { pushToast } = useToast()

  const [availability, setAvailability] = useState<AvailabilityState>({ spec: false, diff: false, files: false })
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([])
  const [isCopying, setIsCopying] = useState(false)
  const [tokenCount, setTokenCount] = useState<number | null>(null)
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false)

  const specCacheRef = useRef<string | null>(null)
  const diffCacheRef = useRef<Map<string, DiffResponse>>(new Map())
  const fileCacheRef = useRef<Map<string, { base: string; head: string }>>(new Map())
  const tokenJobRef = useRef(0)

  const bundleSelectionKey = useMemo(() => {
    return buildCopyContextBundleSelectionKey(projectPath, sessionName)
  }, [projectPath, sessionName])

  const [selection, setSelection] = useAtom(copyContextBundleSelectionAtomFamily(bundleSelectionKey))

  const changedFilesSelectionKey = useMemo(() => {
    return buildCopyContextChangedFilesSelectionKey(projectPath, sessionName)
  }, [projectPath, sessionName])

  const changedFilesSelection = useAtomValue(copyContextChangedFilesSelectionAtomFamily(changedFilesSelectionKey))

  const selectedChangedFiles = useMemo(() => {
    const selectedFilePaths = changedFilesSelection.selectedFilePaths
    if (selectedFilePaths === null) return changedFiles
    const selected = new Set(selectedFilePaths)
    return changedFiles.filter((file) => selected.has(file.path))
  }, [changedFiles, changedFilesSelection.selectedFilePaths])

  const totalChangedFilesCount = changedFiles.length
  const selectedChangedFilesCount = selectedChangedFiles.length

  const nothingSelected = !selection.spec && !selection.diff && !selection.files
  const availabilitySnapshot = useMemo(() => ({
    spec: availability.spec,
    diff: availability.diff,
    files: availability.files,
  }), [availability.spec, availability.diff, availability.files])





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
        logger.error('[CopyContextBar] Failed to load spec content for copy', err)
      }
    }

    if (selection.diff && availability.diff) {
      try {
        const diffSections = await buildDiffSections(selectedChangedFiles, fetchDiff)
        if (diffSections.length > 0) {
          const diffBlocks = diffSections.map(section => wrapBlock(section.header, section.body, section.fence))
          sections.push(['## Diff', '', diffBlocks.join('\n\n')].join('\n'))
          included.push('Diff')
        }
      } catch (err) {
        logger.error('[CopyContextBar] Failed to load diff sections', err)
      }
    }

    if (selection.files && availability.files) {
      try {
        const fileSections = await buildFileSections(selectedChangedFiles, fetchFileContents)
        if (fileSections.length > 0) {
          const fileBlocks = fileSections.map(section => wrapBlock(section.header, section.body, section.fence))
          sections.push(['## Touched files', '', fileBlocks.join('\n\n')].join('\n'))
          included.push('Files')
        }
      } catch (err) {
        logger.error('[CopyContextBar] Failed to load file sections', err)
      }
    }

    const text = sections.join('\n\n').trim()
    const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
    const sizeBytes = encoder ? encoder.encode(text).length : text.length

    return { text, included, sizeBytes }
  }, [availability.diff, availability.files, availability.spec, fetchDiff, fetchFileContents, fetchSpecText, selection, selectedChangedFiles])

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
      setHasLoadedInitial(true)
    } catch (err) {
      if (isSessionMissingError(err)) {
        logger.debug('[CopyContextBar] Session missing during initial data load', err)
      } else {
        logger.error('[CopyContextBar] Failed to load initial data', err)
      }
      setAvailability({ spec: false, diff: false, files: false })
      setChangedFiles([])
      setHasLoadedInitial(true)
    }
  }, [sessionName])

  useEffect(() => {
    let disposed = false
    void loadInitialData()

    let unlistenFileChanges: (() => void) | null = null
    let unlistenSessionsRefreshed: (() => void) | null = null

    const registerFileChanges = async () => {
      try {
        const unlisten = await listenEvent(SchaltEvent.FileChanges, (payload) => {
          if (disposed || payload.session_name !== sessionName) return
          setChangedFiles(payload.changed_files ?? [])
          const hasDiff = (payload.changed_files ?? []).length > 0
          setAvailability(prev => ({ ...prev, diff: hasDiff, files: hasDiff }))
          diffCacheRef.current.clear()
          fileCacheRef.current.clear()
        })
        if (disposed) {
          try {
            await unlisten()
          } catch (err) {
            logger.warn('[CopyContextBar] Failed to cleanup file changes listener', err)
          }
        } else {
          unlistenFileChanges = unlisten
        }
      } catch (err) {
        logger.warn('[CopyContextBar] Failed to listen for file changes', err)
      }
    }

    const registerSessionsRefreshed = async () => {
      try {
        const unlisten = await listenEvent(SchaltEvent.SessionsRefreshed, async (payload) => {
          if (disposed) return
          const scoped = payload as SessionsRefreshedEventPayload | { sessions?: unknown }
          const targetSessions: Array<{ info?: { session_id?: string } }> = Array.isArray((scoped as SessionsRefreshedEventPayload).sessions)
            ? (scoped as SessionsRefreshedEventPayload).sessions
            : Array.isArray(payload)
              ? (payload as Array<{ info?: { session_id?: string } }>)
              : []
          const payloadProjectPath = typeof (scoped as SessionsRefreshedEventPayload).projectPath === 'string'
            ? (scoped as SessionsRefreshedEventPayload).projectPath
            : null
          if (payloadProjectPath && projectPath && payloadProjectPath !== projectPath) {
            return
          }
          const match = targetSessions.find((session) => session.info?.session_id === sessionName)
          if (!match) return
          try {
            const specPair = await invoke<[string | null, string | null]>(TauriCommands.SchaltwerkCoreGetSessionAgentContent, { name: sessionName })
            const specText = (specPair?.[0] ?? specPair?.[1] ?? '').trimEnd()
            specCacheRef.current = specText
            setAvailability(prev => ({ ...prev, spec: specText.length > 0 }))
          } catch (err) {
            if (isSessionMissingError(err)) {
              logger.debug('[CopyContextBar] Session missing while refreshing spec availability', err)
              setAvailability(prev => ({ ...prev, spec: false }))
            } else {
              logger.error('[CopyContextBar] Failed to refresh spec availability', err)
            }
          }
        })
        if (disposed) {
          try {
            await unlisten()
          } catch (err) {
            logger.warn('[CopyContextBar] Failed to cleanup sessions refreshed listener', err)
          }
        } else {
          unlistenSessionsRefreshed = unlisten
        }
      } catch (err) {
        logger.warn('[CopyContextBar] Failed to listen for session refresh events', err)
      }
    }

    void registerFileChanges()
    void registerSessionsRefreshed()

    return () => {
      disposed = true
      if (unlistenFileChanges) {
        const unlisten = unlistenFileChanges
        unlistenFileChanges = null
        void (async () => {
          try {
            await unlisten()
          } catch (err) {
            logger.warn('[CopyContextBar] Failed to cleanup file changes listener', err)
          }
        })()
      }
      if (unlistenSessionsRefreshed) {
        const unlisten = unlistenSessionsRefreshed
        unlistenSessionsRefreshed = null
        void (async () => {
          try {
            await unlisten()
          } catch (err) {
            logger.warn('[CopyContextBar] Failed to cleanup sessions refreshed listener', err)
          }
        })()
      }
    }
  }, [loadInitialData, projectPath, sessionName])

  useEffect(() => {
    if (!hasLoadedInitial) return
    const next = sanitizeSelection(selection, availabilitySnapshot)
    if (selection.spec === next.spec && selection.diff === next.diff && selection.files === next.files) {
      return
    }
    void setSelection(next)
  }, [availabilitySnapshot, hasLoadedInitial, selection, setSelection])

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
          if (isSessionMissingError(err)) {
            logger.debug('[CopyContextBar] Session missing while assembling bundle for token count', err)
            setTokenCount(null)
          } else {
            logger.error('[CopyContextBar] Failed to assemble bundle for token count', err)
            setTokenCount(null)
          }
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [assembleBundle, hasLoadedInitial, nothingSelected])

  const handleToggle = useCallback((key: keyof SelectionState, value: boolean) => {
    void setSelection({ ...selection, [key]: value })
  }, [selection, setSelection])



  const handleCopy = useCallback(async () => {
    if (nothingSelected) return
    setIsCopying(true)
    try {
      const { text, included, sizeBytes } = await assembleBundle()
      if (!text) {
        pushToast({ tone: 'warning', title: t.toasts.nothingToCopy, description: t.toasts.nothingToCopyDesc })
        return
      }

      const success = await writeClipboard(text)
      if (!success) {
        pushToast({ tone: 'error', title: t.toasts.clipboardBlocked, description: t.toasts.clipboardBlockedDesc })
        return
      }

      const tokens = computeTokens(text)
      if (tokens !== null) {
        setTokenCount(tokens)
      }

      pushToast({
        tone: 'success',
        title: t.toasts.copiedToClipboard,
        description: formatSectionSummary(included, selectedChangedFilesCount, t.toasts),
      })

      if (sizeBytes > LARGE_BUNDLE_BYTES) {
        const megabytes = (sizeBytes / (1024 * 1024)).toFixed(1)
        pushToast({
          tone: 'warning',
          title: t.toasts.copiedLargeBundle.replace('{size}', megabytes),
          description: t.toasts.copiedLargeBundleDesc,
        })
      }
    } catch (err) {
      logger.error('[CopyContextBar] Clipboard copy failed', err)
      pushToast({ tone: 'error', title: t.toasts.copyFailed, description: t.toasts.copyFailedDesc })
    } finally {
      setIsCopying(false)
    }
  }, [assembleBundle, nothingSelected, pushToast, selectedChangedFilesCount])

  const pillBaseStyle = "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer select-none border"

  const getPillStyle = (active: boolean, disabled: boolean) => {
    if (disabled) {
      return {
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        color: 'var(--color-text-muted)',
        opacity: 0.4,
        cursor: 'not-allowed',
      }
    }
    if (active) {
      return {
        borderColor: 'var(--color-accent-blue-border)',
        backgroundColor: 'var(--color-accent-blue-bg)',
        color: 'var(--color-accent-blue)',
        boxShadow: '0 0 10px -2px var(--color-accent-blue-bg)',
      }
    }
    return {
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      color: 'var(--color-text-secondary)',
    }
  }

  const getHoverStyle = (active: boolean, disabled: boolean) => {
    if (disabled) return {}
    if (active) return {
      backgroundColor: 'color-mix(in srgb, var(--color-accent-blue-bg), var(--color-accent-blue) 5%)',
    }
    return {
      backgroundColor: 'var(--color-bg-hover)',
      color: 'var(--color-text-primary)',
    }
  }

  return (
    <div
      className="flex items-center justify-between px-4 py-3 select-none"
      aria-label="copy-bundle-bar"
      style={{
        borderBottom: '1px solid var(--color-border-subtle)',
        backgroundColor: 'var(--color-bg-secondary)', // Slightly darker/different to separate panels
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="flex items-center gap-2">
        {/* Spec Pill */}
        <div
          className={pillBaseStyle}
          onClick={() => !availability.spec ? null : handleToggle('spec', !selection.spec)}
          style={getPillStyle(selection.spec, !availability.spec)}
          onMouseEnter={(e) => {
            const style = getHoverStyle(selection.spec, !availability.spec)
            Object.assign(e.currentTarget.style, style)
          }}
          onMouseLeave={(e) => {
            const style = getPillStyle(selection.spec, !availability.spec)
            // Reset to base style, removing hover overrides
            e.currentTarget.style.backgroundColor = style.backgroundColor as string
            e.currentTarget.style.color = style.color as string
            e.currentTarget.style.borderColor = style.borderColor as string
          }}
          title={availability.spec ? 'Include spec content' : 'Spec content unavailable'}
        >
          <span>Spec</span>
        </div>

        {/* Diff Pill */}
        <div
          className={pillBaseStyle}
          onClick={() => !availability.diff ? null : handleToggle('diff', !selection.diff)}
          style={getPillStyle(selection.diff, !availability.diff)}
          onMouseEnter={(e) => {
            const style = getHoverStyle(selection.diff, !availability.diff)
            Object.assign(e.currentTarget.style, style)
          }}
          onMouseLeave={(e) => {
            const style = getPillStyle(selection.diff, !availability.diff)
            e.currentTarget.style.backgroundColor = style.backgroundColor as string
            e.currentTarget.style.color = style.color as string
            e.currentTarget.style.borderColor = style.borderColor as string
          }}
          title={availability.diff
            ? (selectedChangedFilesCount === totalChangedFilesCount
              ? `Include diff (${totalChangedFilesCount})`
              : `Include diff (${selectedChangedFilesCount} selected of ${totalChangedFilesCount})`)
            : 'No diff available'}
        >
          <span>Diff</span>
          {availability.diff && (
            <span
              className="flex items-center justify-center h-4 min-w-[16px] px-1 rounded-sm text-[9px] font-bold"
              style={{
                backgroundColor: selection.diff ? 'var(--color-accent-blue)' : 'var(--color-bg-elevated)',
                color: selection.diff ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
              }}
            >
              {selectedChangedFilesCount}
            </span>
          )}
        </div>

        {/* Files Pill */}
        <div
          className={pillBaseStyle}
          onClick={() => !availability.files ? null : handleToggle('files', !selection.files)}
          style={getPillStyle(selection.files, !availability.files)}
          onMouseEnter={(e) => {
            const style = getHoverStyle(selection.files, !availability.files)
            Object.assign(e.currentTarget.style, style)
          }}
          onMouseLeave={(e) => {
            const style = getPillStyle(selection.files, !availability.files)
            e.currentTarget.style.backgroundColor = style.backgroundColor as string
            e.currentTarget.style.color = style.color as string
            e.currentTarget.style.borderColor = style.borderColor as string
          }}
          title={availability.files
            ? (selectedChangedFilesCount === totalChangedFilesCount
              ? `Include file contents (${totalChangedFilesCount})`
              : `Include file contents (${selectedChangedFilesCount} selected of ${totalChangedFilesCount})`)
            : 'No touched files'}
        >
          <span>Files</span>
          {availability.files && (
            <span
              className="flex items-center justify-center h-4 min-w-[16px] px-1 rounded-sm text-[9px] font-bold"
              style={{
                backgroundColor: selection.files ? 'var(--color-accent-blue)' : 'var(--color-bg-elevated)',
                color: selection.files ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
              }}
            >
              {selectedChangedFilesCount}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div
          className="text-xs font-mono tracking-wide uppercase"
          style={{ color: 'var(--color-text-secondary)' }}
          title={tokenCount !== null ? `${tokenCount.toLocaleString()} tokens` : 'Token count unavailable'}
        >
          {tokenCount !== null ? `${tokenCount.toLocaleString()} TOKENS` : '—'}
        </div>

        <button
          type="button"
          onClick={() => { void handleCopy() }}
          disabled={isCopying || nothingSelected}
          title="Copy the selected spec, diffs, and files to paste into an external AI"
          className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold transition-all rounded-md shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
          style={{
            backgroundColor: 'var(--color-accent-blue)',
            color: 'var(--color-bg-primary)',
            boxShadow: '0 0 15px -3px var(--color-accent-blue-bg)',
          }}
          onMouseEnter={(e) => {
            if (!isCopying && !nothingSelected) {
              e.currentTarget.style.backgroundColor = 'var(--color-accent-blue-light)'
              e.currentTarget.style.boxShadow = '0 0 20px -2px var(--color-accent-blue-bg)'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-accent-blue)'
            e.currentTarget.style.boxShadow = '0 0 15px -3px var(--color-accent-blue-bg)'
          }}
        >
          {isCopying ? (
            <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          )}
          <span>{isCopying ? 'Copying Context...' : 'Copy Context'}</span>
        </button>
      </div>
    </div>
  )
}
