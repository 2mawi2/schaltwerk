import { useEffect, useCallback } from 'react'
import { useAtom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import {
  diffCompareModeAtomFamily,
  hasRemoteTrackingBranchAtomFamily,
  type DiffCompareMode,
} from '../../store/atoms/diffCompareMode'
import { VscCloudUpload } from 'react-icons/vsc'

interface CompareModeToggleProps {
  sessionName: string
  onModeChange: (newMode: 'merge_base' | 'unpushed_only') => void
}

export function CompareModeToggle({ sessionName, onModeChange }: CompareModeToggleProps) {
  const [compareMode, setCompareMode] = useAtom(diffCompareModeAtomFamily(sessionName))
  const [hasRemote, setHasRemote] = useAtom(hasRemoteTrackingBranchAtomFamily(sessionName))

  useEffect(() => {
    let cancelled = false

    const checkRemote = async () => {
      try {
        const result = await invoke<boolean>(TauriCommands.HasRemoteTrackingBranch, {
          sessionName,
        })
        if (!cancelled) {
          setHasRemote(result)
        }
      } catch (err) {
        logger.debug('[CompareModeToggle] Failed to check remote tracking branch:', err)
        if (!cancelled) {
          setHasRemote(false)
        }
      }
    }

    void checkRemote()

    return () => {
      cancelled = true
    }
  }, [sessionName, setHasRemote])

  useEffect(() => {
    if (hasRemote === false && compareMode === 'unpushed_only') {
      setCompareMode('merge_base')
    }
  }, [hasRemote, compareMode, setCompareMode])

  const handleToggle = useCallback(() => {
    const newMode: DiffCompareMode = compareMode === 'merge_base' ? 'unpushed_only' : 'merge_base'
    setCompareMode(newMode)
    onModeChange(newMode)
  }, [compareMode, setCompareMode, onModeChange])

  if (!hasRemote) {
    return null
  }

  const isUnpushedMode = compareMode === 'unpushed_only'

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="flex items-center justify-center p-1.5 rounded transition-colors"
      style={{
        color: isUnpushedMode ? theme.colors.accent.cyan.DEFAULT : theme.colors.text.muted,
        backgroundColor: isUnpushedMode ? theme.colors.accent.cyan.bg : 'transparent',
      }}
      title={
        isUnpushedMode
          ? 'Showing local only (changes since last push). Click to show all changes.'
          : 'Show local only (changes since last push)'
      }
      aria-label={isUnpushedMode ? 'Showing local only' : 'Show local only'}
    >
      <VscCloudUpload className="text-base" />
    </button>
  )
}
