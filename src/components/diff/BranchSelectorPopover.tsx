import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import { VscSettings } from 'react-icons/vsc'
import { BranchAutocomplete } from '../inputs/BranchAutocomplete'
import { useTranslation } from '../../common/i18n'

interface BranchSelectorPopoverProps {
  sessionName: string
  currentBaseBranch: string
  originalBaseBranch?: string | null
  onBranchChange: () => void
}

export function BranchSelectorPopover({
  sessionName,
  currentBaseBranch,
  originalBaseBranch,
  onBranchChange
}: BranchSelectorPopoverProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState(currentBaseBranch)
  const [isLoading, setIsLoading] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const hasCustomCompare = originalBaseBranch != null && currentBaseBranch !== originalBaseBranch

  useEffect(() => {
    setSelectedBranch(currentBaseBranch)
  }, [currentBaseBranch])

  const loadBranches = useCallback(async () => {
    setIsLoading(true)
    try {
      const availableBranches = await invoke<string[]>(TauriCommands.ListProjectBranches)
      setBranches(availableBranches)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('[BranchSelectorPopover] Failed to load branches:', message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen && branches.length === 0) {
      void loadBranches()
    }
  }, [isOpen, branches.length, loadBranches])

  const handleBranchChange = useCallback((branch: string) => {
    setSelectedBranch(branch)
  }, [])

  const applyBranch = useCallback(async (branch: string) => {
    if (branch === currentBaseBranch || !branches.includes(branch)) {
      setIsOpen(false)
      setSelectedBranch(currentBaseBranch)
      return
    }

    setIsUpdating(true)

    try {
      await invoke(TauriCommands.SetSessionDiffBaseBranch, {
        sessionName,
        newBaseBranch: branch
      })
      setIsOpen(false)
      onBranchChange()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('[BranchSelectorPopover] Failed to update base branch:', message)
      setSelectedBranch(currentBaseBranch)
    } finally {
      setIsUpdating(false)
    }
  }, [sessionName, currentBaseBranch, branches, onBranchChange])

  const handleConfirm = useCallback((branch: string) => {
    void applyBranch(branch)
  }, [applyBranch])

  const handleCancel = useCallback(() => {
    setSelectedBranch(currentBaseBranch)
    setIsOpen(false)
  }, [currentBaseBranch])

  const handleResetToDefault = useCallback(async () => {
    if (!originalBaseBranch) return
    setIsUpdating(true)
    try {
      await invoke(TauriCommands.SetSessionDiffBaseBranch, {
        sessionName,
        newBaseBranch: originalBaseBranch
      })
      setIsOpen(false)
      onBranchChange()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('[BranchSelectorPopover] Failed to reset base branch:', message)
    } finally {
      setIsUpdating(false)
    }
  }, [sessionName, originalBaseBranch, onBranchChange])

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation()
  }

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node

      if (containerRef.current?.contains(target)) {
        return
      }

      const autocompleteMenu = document.querySelector('[data-testid="branch-autocomplete-menu"]')
      if (autocompleteMenu?.contains(target)) {
        return
      }

      handleCancel()
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCancel()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, handleCancel])

  return (
    <div
      ref={containerRef}
      className="relative"
      data-branch-selector
      onPointerDown={stopPropagation}
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
    >
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        disabled={isUpdating}
        className="p-1 rounded hover:bg-slate-800 transition-colors relative"
        style={{ color: isOpen ? 'var(--color-accent-blue)' : hasCustomCompare ? 'var(--color-accent-amber)' : 'var(--color-text-secondary)' }}
        title={hasCustomCompare ? t.branchSelectorPopover.customCompare.replace('{branch}', currentBaseBranch) : t.branchSelectorPopover.changeDiffBranch}
        aria-label={t.branchSelectorPopover.changeDiffBranch}
      >
        {isUpdating ? (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <VscSettings className="text-base" />
        )}
        {hasCustomCompare && !isUpdating && (
          <span
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
            style={{ backgroundColor: 'var(--color-accent-amber)' }}
          />
        )}
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full mt-1 p-2 rounded shadow-lg border z-50"
          style={{
            backgroundColor: 'var(--color-bg-elevated)',
            borderColor: 'var(--color-border-default)',
            minWidth: '200px'
          }}
        >
          {hasCustomCompare && originalBaseBranch && (
            <button
              type="button"
              onClick={() => void handleResetToDefault()}
              disabled={isUpdating}
              className="w-full text-left text-xs px-2 py-1.5 mb-2 rounded border transition-colors hover:opacity-80"
              style={{
                backgroundColor: 'var(--color-bg-primary)',
                borderColor: 'var(--color-accent-amber-border)',
                color: 'var(--color-text-primary)'
              }}
            >
              <span style={{ color: 'var(--color-text-secondary)' }}>{t.branchSelectorPopover.resetTo} </span>
              <span style={{ color: 'var(--color-accent-amber)' }}>{originalBaseBranch}</span>
            </button>
          )}
          <div className="text-xs mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
            {t.branchSelectorPopover.compareAgainst}
          </div>
          {isLoading ? (
            <div
              className="w-full rounded px-2 py-1.5 border text-xs"
              style={{
                backgroundColor: 'var(--color-bg-primary)',
                borderColor: 'var(--color-border-default)',
                color: 'var(--color-text-muted)'
              }}
            >
              {t.settings.common.loading}
            </div>
          ) : (
            <BranchAutocomplete
              value={selectedBranch}
              onChange={handleBranchChange}
              onConfirm={handleConfirm}
              branches={branches}
              disabled={isUpdating || branches.length === 0}
              placeholder={branches.length === 0 ? t.sessionConfig.noBranches : t.branchSelectorPopover.search}
              className="text-xs py-1"
              autoFocus
            />
          )}
        </div>
      )}
    </div>
  )
}
