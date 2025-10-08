import { useContext, useEffect } from 'react'
import {
  KeyboardShortcutAction,
  KeyboardShortcutConfig,
  defaultShortcutConfig,
} from '../keyboardShortcuts/config'
import { KeyboardShortcutContext } from '../contexts/KeyboardShortcutsContext'
import { detectPlatformSafe, isShortcutForAction } from '../keyboardShortcuts/helpers'
import type { Platform } from '../keyboardShortcuts/matcher'

interface KeyboardShortcutsProps {
  onSelectOrchestrator: () => void
  onSelectSession: (index: number) => void
  onCancelSelectedSession?: (immediate: boolean) => void
  onMarkSelectedSessionReady?: () => void
  onSpecSession?: () => void
  onPromoteSelectedVersion?: () => void
  sessionCount: number
  onSelectPrevSession?: () => void
  onSelectNextSession?: () => void
  onFocusSidebar?: () => void
  onFocusClaude?: () => void
  onOpenDiffViewer?: () => void
  onFocusTerminal?: () => void
  onSelectPrevProject?: () => void
  onSelectNextProject?: () => void
  onNavigateToPrevFilter?: () => void
  onNavigateToNextFilter?: () => void
  isDiffViewerOpen?: boolean
  isModalOpen?: boolean
  onResetSelection?: () => void
  onOpenSwitchModel?: () => void
  onOpenMergeModal?: () => void
  onCreatePullRequest?: () => void
  onOpenInApp?: () => void
}

interface KeyboardShortcutOptions {
  shortcutConfig?: KeyboardShortcutConfig
  platform?: Platform
}

export function useKeyboardShortcuts(
  {
    onSelectOrchestrator,
    onSelectSession,
    onCancelSelectedSession,
    onMarkSelectedSessionReady,
    onSpecSession,
    onPromoteSelectedVersion,
    sessionCount,
    onSelectPrevSession,
    onSelectNextSession,
    onFocusClaude,
    onOpenDiffViewer,
    onFocusTerminal,
    onSelectPrevProject,
    onSelectNextProject,
    onNavigateToPrevFilter,
    onNavigateToNextFilter,
    isDiffViewerOpen,
    isModalOpen,
    onResetSelection,
    onOpenSwitchModel,
    onOpenMergeModal,
    onCreatePullRequest,
    onOpenInApp,
  }: KeyboardShortcutsProps,
  options: KeyboardShortcutOptions = {},
) {
  const context = useContext(KeyboardShortcutContext)
  const shortcutConfig = options.shortcutConfig ?? context?.config ?? defaultShortcutConfig
  const platform = options.platform ?? detectPlatformSafe()

  useEffect(() => {
    const sessionActions: KeyboardShortcutAction[] = [
      KeyboardShortcutAction.SwitchToSession1,
      KeyboardShortcutAction.SwitchToSession2,
      KeyboardShortcutAction.SwitchToSession3,
      KeyboardShortcutAction.SwitchToSession4,
      KeyboardShortcutAction.SwitchToSession5,
      KeyboardShortcutAction.SwitchToSession6,
      KeyboardShortcutAction.SwitchToSession7,
      KeyboardShortcutAction.SwitchToSession8,
    ]

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isShortcutForAction(event, KeyboardShortcutAction.SwitchToOrchestrator, shortcutConfig, { platform })) {
        event.preventDefault()
        onSelectOrchestrator()
        return
      }

      for (let index = 0; index < sessionActions.length; index++) {
        if (index >= sessionCount) break
        if (isShortcutForAction(event, sessionActions[index], shortcutConfig, { platform })) {
          event.preventDefault()
          onSelectSession(index)
          return
        }
      }

      if (!isDiffViewerOpen && !isModalOpen && onSelectPrevSession && isShortcutForAction(event, KeyboardShortcutAction.SelectPrevSession, shortcutConfig, { platform })) {
        event.preventDefault()
        onSelectPrevSession()
        return
      }

      if (!isDiffViewerOpen && !isModalOpen && onSelectNextSession && isShortcutForAction(event, KeyboardShortcutAction.SelectNextSession, shortcutConfig, { platform })) {
        event.preventDefault()
        onSelectNextSession()
        return
      }

      if (!isDiffViewerOpen && onSelectPrevProject && isShortcutForAction(event, KeyboardShortcutAction.SelectPrevProject, shortcutConfig, { platform })) {
        event.preventDefault()
        onSelectPrevProject()
        return
      }

      if (!isDiffViewerOpen && onSelectNextProject && isShortcutForAction(event, KeyboardShortcutAction.SelectNextProject, shortcutConfig, { platform })) {
        event.preventDefault()
        onSelectNextProject()
        return
      }

      if (!isDiffViewerOpen && onNavigateToPrevFilter && isShortcutForAction(event, KeyboardShortcutAction.NavigatePrevFilter, shortcutConfig, { platform })) {
        event.preventDefault()
        onNavigateToPrevFilter()
        return
      }

      if (!isDiffViewerOpen && onNavigateToNextFilter && isShortcutForAction(event, KeyboardShortcutAction.NavigateNextFilter, shortcutConfig, { platform })) {
        event.preventDefault()
        onNavigateToNextFilter()
        return
      }

      if (onCancelSelectedSession && isShortcutForAction(event, KeyboardShortcutAction.ForceCancelSession, shortcutConfig, { platform })) {
        event.preventDefault()
        onCancelSelectedSession(true)
        return
      }

      if (onCancelSelectedSession && isShortcutForAction(event, KeyboardShortcutAction.CancelSession, shortcutConfig, { platform })) {
        event.preventDefault()
        onCancelSelectedSession(false)
        return
      }

      if (onResetSelection && isShortcutForAction(event, KeyboardShortcutAction.ResetSessionOrOrchestrator, shortcutConfig, { platform })) {
        event.preventDefault()
        onResetSelection()
        return
      }

      if (onOpenDiffViewer && isShortcutForAction(event, KeyboardShortcutAction.OpenDiffViewer, shortcutConfig, { platform })) {
        event.preventDefault()
        onOpenDiffViewer()
        return
      }

      if (onMarkSelectedSessionReady && isShortcutForAction(event, KeyboardShortcutAction.MarkSessionReady, shortcutConfig, { platform })) {
        event.preventDefault()
        onMarkSelectedSessionReady()
        return
      }

      if (onSpecSession && isShortcutForAction(event, KeyboardShortcutAction.ConvertSessionToSpec, shortcutConfig, { platform })) {
        event.preventDefault()
        onSpecSession()
        return
      }

      if (onPromoteSelectedVersion && isShortcutForAction(event, KeyboardShortcutAction.PromoteSessionVersion, shortcutConfig, { platform })) {
        event.preventDefault()
        onPromoteSelectedVersion()
        return
      }

      if (onFocusClaude && isShortcutForAction(event, KeyboardShortcutAction.FocusClaude, shortcutConfig, { platform })) {
        event.preventDefault()
        onFocusClaude()
        return
      }

      if (onFocusTerminal && isShortcutForAction(event, KeyboardShortcutAction.FocusTerminal, shortcutConfig, { platform })) {
        event.preventDefault()
        onFocusTerminal()
        return
      }

      if (onOpenSwitchModel && isShortcutForAction(event, KeyboardShortcutAction.OpenSwitchModelModal, shortcutConfig, { platform })) {
        event.preventDefault()
        onOpenSwitchModel()
        return
      }

      if (onOpenMergeModal && isShortcutForAction(event, KeyboardShortcutAction.OpenMergeModal, shortcutConfig, { platform })) {
        event.preventDefault()
        onOpenMergeModal()
        return
      }

      if (onCreatePullRequest && isShortcutForAction(event, KeyboardShortcutAction.CreatePullRequest, shortcutConfig, { platform })) {
        event.preventDefault()
        onCreatePullRequest()
        return
      }

      if (onOpenInApp && isShortcutForAction(event, KeyboardShortcutAction.OpenInApp, shortcutConfig, { platform })) {
        event.preventDefault()
        onOpenInApp()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    onSelectOrchestrator,
    onSelectSession,
    sessionCount,
    onSelectPrevSession,
    onSelectNextSession,
    onSelectPrevProject,
    onSelectNextProject,
    onNavigateToPrevFilter,
    onNavigateToNextFilter,
    onCancelSelectedSession,
    onOpenDiffViewer,
    onMarkSelectedSessionReady,
    onSpecSession,
    onPromoteSelectedVersion,
    onFocusClaude,
    onFocusTerminal,
    onResetSelection,
    onOpenSwitchModel,
    onOpenMergeModal,
    onCreatePullRequest,
    onOpenInApp,
    isDiffViewerOpen,
    isModalOpen,
    shortcutConfig,
    platform,
  ])
}
