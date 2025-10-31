import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import {
  actionButtonsListAtom,
  actionButtonsLoadingAtom,
  actionButtonsErrorAtom,
  loadActionButtonsAtom,
  saveActionButtonsAtom,
  resetActionButtonsAtom,
} from '../store/atoms/actionButtons'
import type { HeaderActionConfig } from '../types/actionButton'
import { projectPathAtom } from '../store/atoms/project'

interface UseActionButtonsResult {
  actionButtons: HeaderActionConfig[]
  loading: boolean
  error: string | null
  saveActionButtons: (buttons: HeaderActionConfig[]) => Promise<boolean>
  resetToDefaults: () => Promise<boolean>
  reloadActionButtons: () => Promise<void>
}

export function useActionButtons(): UseActionButtonsResult {
  const projectPath = useAtomValue(projectPathAtom)
  const actionButtons = useAtomValue(actionButtonsListAtom)
  const loading = useAtomValue(actionButtonsLoadingAtom)
  const error = useAtomValue(actionButtonsErrorAtom)

  const load = useSetAtom(loadActionButtonsAtom)
  const save = useSetAtom(saveActionButtonsAtom)
  const reset = useSetAtom(resetActionButtonsAtom)

  useEffect(() => {
    void load({ projectPath: projectPath ?? null })
  }, [projectPath, load])

  const saveActionButtons = useCallback((buttons: HeaderActionConfig[]) => {
    return save({ buttons, projectPath: projectPath ?? null })
  }, [save, projectPath])

  const resetToDefaults = useCallback(() => {
    return reset({ projectPath: projectPath ?? null })
  }, [reset, projectPath])

  const reloadActionButtons = useCallback(() => {
    return load({ projectPath: projectPath ?? null })
  }, [load, projectPath])

  return {
    actionButtons,
    loading,
    error,
    saveActionButtons,
    resetToDefaults,
    reloadActionButtons,
  }
}
