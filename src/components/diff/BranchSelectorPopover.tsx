import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { VscSettings } from 'react-icons/vsc'
import { BranchAutocomplete } from '../inputs/BranchAutocomplete'

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
        style={{ color: isOpen ? theme.colors.accent.blue.DEFAULT : hasCustomCompare ? theme.colors.accent.amber.DEFAULT : theme.colors.text.secondary }}
        title={hasCustomCompare ? `Custom compare: ${currentBaseBranch} (click to change)` : "Change diff comparison branch"}
        aria-label="Change diff comparison branch"
      >
        {isUpdating ? (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <VscSettings className="text-base" />
        )}
        {hasCustomCompare && !isUpdating && (
          <span
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
            style={{ backgroundColor: theme.colors.accent.amber.DEFAULT }}
          />
        )}
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full mt-1 p-2 rounded shadow-lg border z-50"
          style={{
            backgroundColor: theme.colors.background.elevated,
            borderColor: theme.colors.border.default,
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
                backgroundColor: theme.colors.background.primary,
                borderColor: theme.colors.accent.amber.border,
                color: theme.colors.text.primary
              }}
            >
              <span style={{ color: theme.colors.text.secondary }}>Reset to: </span>
              <span style={{ color: theme.colors.accent.amber.DEFAULT }}>{originalBaseBranch}</span>
            </button>
          )}
          <div className="text-xs mb-1.5" style={{ color: theme.colors.text.secondary }}>
            Compare against
          </div>
          {isLoading ? (
            <div
              className="w-full rounded px-2 py-1.5 border text-xs"
              style={{
                backgroundColor: theme.colors.background.primary,
                borderColor: theme.colors.border.default,
                color: theme.colors.text.muted
              }}
            >
              Loading...
            </div>
          ) : (
            <BranchAutocomplete
              value={selectedBranch}
              onChange={handleBranchChange}
              onConfirm={handleConfirm}
              branches={branches}
              disabled={isUpdating || branches.length === 0}
              placeholder={branches.length === 0 ? "No branches" : "Search..."}
              className="text-xs py-1"
              autoFocus
            />
          )}
        </div>
      )}
    </div>
  )
}
