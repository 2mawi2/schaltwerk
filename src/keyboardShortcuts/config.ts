import { normalizeShortcut } from './matcher'

export enum KeyboardShortcutAction {
  IncreaseFontSize = 'increaseFontSize',
  DecreaseFontSize = 'decreaseFontSize',
  ResetFontSize = 'resetFontSize',
  SwitchToOrchestrator = 'switchToOrchestrator',
  SwitchToSession1 = 'switchToSession1',
  SwitchToSession2 = 'switchToSession2',
  SwitchToSession3 = 'switchToSession3',
  SwitchToSession4 = 'switchToSession4',
  SwitchToSession5 = 'switchToSession5',
  SwitchToSession6 = 'switchToSession6',
  SwitchToSession7 = 'switchToSession7',
  SwitchToSession8 = 'switchToSession8',
  SelectPrevSession = 'selectPrevSession',
  SelectNextSession = 'selectNextSession',
  SelectPrevProject = 'selectPrevProject',
  SelectNextProject = 'selectNextProject',
  NavigatePrevFilter = 'navigatePrevFilter',
  NavigateNextFilter = 'navigateNextFilter',
  FocusClaude = 'focusClaude',
  FocusTerminal = 'focusTerminal',
  InsertTerminalNewLine = 'insertTerminalNewLine',
  NewSession = 'newSession',
  NewSpec = 'newSpec',
  CancelSession = 'cancelSession',
  ForceCancelSession = 'forceCancelSession',
  MarkSessionReady = 'markSessionReady',
  PromoteSessionVersion = 'promoteSessionVersion',
  ConvertSessionToSpec = 'convertSessionToSpec',
  OpenDiffViewer = 'openDiffViewer',
  EnterSpecMode = 'enterSpecMode',
  FinishReview = 'finishReview',
  OpenDiffSearch = 'openDiffSearch',
  SubmitDiffComment = 'submitDiffComment',
  RunSpecAgent = 'runSpecAgent',
  ToggleRunMode = 'toggleRunMode',
  OpenTerminalSearch = 'openTerminalSearch',
}

export type KeyboardShortcutConfig = Record<KeyboardShortcutAction, string[]>

export type PartialKeyboardShortcutConfig = Partial<Record<KeyboardShortcutAction, string[]>>

const createNormalizedBindings = (bindings: string[]): string[] => {
  const unique = new Set<string>()
  bindings.forEach(binding => {
    const trimmed = binding?.trim()
    if (!trimmed) return
    const normalized = normalizeShortcut(trimmed)
    if (normalized) {
      unique.add(normalized)
    }
  })
  return Array.from(unique)
}

export const defaultShortcutConfig: KeyboardShortcutConfig = {
  [KeyboardShortcutAction.IncreaseFontSize]: createNormalizedBindings(['Mod+[Shift]+=']),
  [KeyboardShortcutAction.DecreaseFontSize]: createNormalizedBindings(['Mod+-']),
  [KeyboardShortcutAction.ResetFontSize]: createNormalizedBindings(['Mod+0']),
  [KeyboardShortcutAction.SwitchToOrchestrator]: createNormalizedBindings(['Mod+1']),
  [KeyboardShortcutAction.SwitchToSession1]: createNormalizedBindings(['Mod+2']),
  [KeyboardShortcutAction.SwitchToSession2]: createNormalizedBindings(['Mod+3']),
  [KeyboardShortcutAction.SwitchToSession3]: createNormalizedBindings(['Mod+4']),
  [KeyboardShortcutAction.SwitchToSession4]: createNormalizedBindings(['Mod+5']),
  [KeyboardShortcutAction.SwitchToSession5]: createNormalizedBindings(['Mod+6']),
  [KeyboardShortcutAction.SwitchToSession6]: createNormalizedBindings(['Mod+7']),
  [KeyboardShortcutAction.SwitchToSession7]: createNormalizedBindings(['Mod+8']),
  [KeyboardShortcutAction.SwitchToSession8]: createNormalizedBindings(['Mod+9']),
  [KeyboardShortcutAction.SelectPrevSession]: createNormalizedBindings(['Mod+ArrowUp']),
  [KeyboardShortcutAction.SelectNextSession]: createNormalizedBindings(['Mod+ArrowDown']),
  [KeyboardShortcutAction.SelectPrevProject]: createNormalizedBindings(['Mod+Shift+ArrowLeft']),
  [KeyboardShortcutAction.SelectNextProject]: createNormalizedBindings(['Mod+Shift+ArrowRight']),
  [KeyboardShortcutAction.NavigatePrevFilter]: createNormalizedBindings(['Mod+ArrowLeft']),
  [KeyboardShortcutAction.NavigateNextFilter]: createNormalizedBindings(['Mod+ArrowRight']),
  [KeyboardShortcutAction.FocusClaude]: createNormalizedBindings(['Mod+T']),
  [KeyboardShortcutAction.FocusTerminal]: createNormalizedBindings(['Mod+/']),
  [KeyboardShortcutAction.InsertTerminalNewLine]: createNormalizedBindings(['Mod+Enter']),
  [KeyboardShortcutAction.NewSession]: createNormalizedBindings(['Mod+N']),
  [KeyboardShortcutAction.NewSpec]: createNormalizedBindings(['Mod+Shift+N']),
  [KeyboardShortcutAction.CancelSession]: createNormalizedBindings(['Mod+D']),
  [KeyboardShortcutAction.ForceCancelSession]: createNormalizedBindings(['Mod+Shift+D']),
  [KeyboardShortcutAction.MarkSessionReady]: createNormalizedBindings(['Mod+R']),
  [KeyboardShortcutAction.PromoteSessionVersion]: createNormalizedBindings(['Mod+B']),
  [KeyboardShortcutAction.ConvertSessionToSpec]: createNormalizedBindings(['Mod+S']),
  [KeyboardShortcutAction.OpenDiffViewer]: createNormalizedBindings(['Mod+G']),
  [KeyboardShortcutAction.EnterSpecMode]: createNormalizedBindings(['Mod+Shift+S']),
  [KeyboardShortcutAction.FinishReview]: createNormalizedBindings(['Mod+Enter']),
  [KeyboardShortcutAction.OpenDiffSearch]: createNormalizedBindings(['Mod+F']),
  [KeyboardShortcutAction.SubmitDiffComment]: createNormalizedBindings(['Mod+Enter']),
  [KeyboardShortcutAction.RunSpecAgent]: createNormalizedBindings(['Mod+Enter']),
  [KeyboardShortcutAction.ToggleRunMode]: createNormalizedBindings(['Mod+E']),
  [KeyboardShortcutAction.OpenTerminalSearch]: createNormalizedBindings(['Mod+F']),
}

export const mergeShortcutConfig = (
  overrides: PartialKeyboardShortcutConfig | null | undefined,
): KeyboardShortcutConfig => {
  const normalizedOverrides = overrides ?? {}
  const entries = Object.values(KeyboardShortcutAction).map((action) => {
    const maybeBindings = normalizedOverrides[action]
    if (Array.isArray(maybeBindings)) {
      const sanitized = createNormalizedBindings(maybeBindings)
      if (sanitized.length > 0) {
        return [action, sanitized] as const
      }
    }
    return [action, defaultShortcutConfig[action]] as const
  })

  return Object.fromEntries(entries) as KeyboardShortcutConfig
}

export const normalizeShortcutConfig = (
  config: PartialKeyboardShortcutConfig,
): KeyboardShortcutConfig => mergeShortcutConfig(config)

export const getShortcutBindings = (
  config: KeyboardShortcutConfig,
  action: KeyboardShortcutAction,
): string[] => config[action] ?? []
