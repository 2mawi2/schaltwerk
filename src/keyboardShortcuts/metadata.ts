import { KeyboardShortcutAction } from './config'

export interface ShortcutItem {
  action: KeyboardShortcutAction
  label: string
  description?: string
}

export interface ShortcutSection {
  id: string
  title: string
  items: ShortcutItem[]
}

export const KEYBOARD_SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    id: 'appearance',
    title: 'Font Controls',
    items: [
      { action: KeyboardShortcutAction.IncreaseFontSize, label: 'Increase font size' },
      { action: KeyboardShortcutAction.DecreaseFontSize, label: 'Decrease font size' },
      { action: KeyboardShortcutAction.ResetFontSize, label: 'Reset font size' },
    ],
  },
  {
    id: 'navigation',
    title: 'Navigation',
    items: [
      { action: KeyboardShortcutAction.SwitchToOrchestrator, label: 'Switch to orchestrator' },
      { action: KeyboardShortcutAction.SwitchToSession1, label: 'Switch to session 1' },
      { action: KeyboardShortcutAction.SwitchToSession2, label: 'Switch to session 2' },
      { action: KeyboardShortcutAction.SwitchToSession3, label: 'Switch to session 3' },
      { action: KeyboardShortcutAction.SwitchToSession4, label: 'Switch to session 4' },
      { action: KeyboardShortcutAction.SwitchToSession5, label: 'Switch to session 5' },
      { action: KeyboardShortcutAction.SwitchToSession6, label: 'Switch to session 6' },
      { action: KeyboardShortcutAction.SwitchToSession7, label: 'Switch to session 7' },
      { action: KeyboardShortcutAction.SwitchToSession8, label: 'Switch to session 8' },
      { action: KeyboardShortcutAction.SelectPrevSession, label: 'Previous session' },
      { action: KeyboardShortcutAction.SelectNextSession, label: 'Next session' },
      { action: KeyboardShortcutAction.SelectPrevProject, label: 'Previous project' },
      { action: KeyboardShortcutAction.SelectNextProject, label: 'Next project' },
      { action: KeyboardShortcutAction.NavigatePrevFilter, label: 'Previous filter' },
      { action: KeyboardShortcutAction.NavigateNextFilter, label: 'Next filter' },
      { action: KeyboardShortcutAction.FocusClaude, label: 'Focus Claude session' },
      { action: KeyboardShortcutAction.FocusTerminal, label: 'Focus terminal' },
    ],
  },
  {
    id: 'sessionManagement',
    title: 'Session Management',
    items: [
      { action: KeyboardShortcutAction.NewSession, label: 'Create new session' },
      { action: KeyboardShortcutAction.NewSpec, label: 'Create new spec' },
      { action: KeyboardShortcutAction.CancelSession, label: 'Cancel session' },
      { action: KeyboardShortcutAction.ForceCancelSession, label: 'Force cancel session' },
      { action: KeyboardShortcutAction.MarkSessionReady, label: 'Mark ready for review' },
      { action: KeyboardShortcutAction.PromoteSessionVersion, label: 'Promote best version' },
      { action: KeyboardShortcutAction.ConvertSessionToSpec, label: 'Convert session to spec' },
      { action: KeyboardShortcutAction.OpenDiffViewer, label: 'Open diff viewer' },
    ],
  },
  {
    id: 'review',
    title: 'Review & Diff',
    items: [
      { action: KeyboardShortcutAction.FinishReview, label: 'Finish review' },
      { action: KeyboardShortcutAction.OpenDiffSearch, label: 'Open diff search' },
      { action: KeyboardShortcutAction.SubmitDiffComment, label: 'Submit diff comment' },
      { action: KeyboardShortcutAction.RunSpecAgent, label: 'Run spec agent' },
    ],
  },
  {
    id: 'terminal',
    title: 'Terminal Controls',
    items: [
      { action: KeyboardShortcutAction.InsertTerminalNewLine, label: 'Insert new line in terminal' },
      { action: KeyboardShortcutAction.ToggleRunMode, label: 'Toggle run mode' },
      { action: KeyboardShortcutAction.OpenTerminalSearch, label: 'Open terminal search' },
    ],
  },
]
