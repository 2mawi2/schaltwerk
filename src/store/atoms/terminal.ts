import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import { buildTerminalFontFamily } from '../../utils/terminalFonts'
import { logger } from '../../utils/logger'

export interface TerminalTab {
  terminalId: string
  index: number
}

export interface TerminalTabsState {
  tabs: TerminalTab[]
  activeTabIndex: number
}

export type TerminalFocus = 'claude' | 'terminal' | null

const DEFAULT_TABS_STATE: TerminalTabsState = {
  tabs: [],
  activeTabIndex: 0,
}

export const terminalTabsAtomFamily = atomFamily(
  (_baseTerminalId: string) => atom<TerminalTabsState>({ ...DEFAULT_TABS_STATE, tabs: [] }),
  (a, b) => a === b
)

export const addTabActionAtom = atom(
  null,
  (get, set, params: { baseTerminalId: string; activateNew?: boolean; maxTabs?: number }) => {
    const { baseTerminalId, activateNew = false, maxTabs } = params
    const tabsAtom = terminalTabsAtomFamily(baseTerminalId)
    let current = get(tabsAtom)

    // If the atom has no tabs, initialize with the default first tab
    // This handles the case where the UI shows a default "Terminal 1" but the atom is empty
    if (current.tabs.length === 0) {
      const initialTab: TerminalTab = {
        terminalId: baseTerminalId,
        index: 0,
      }
      current = { tabs: [initialTab], activeTabIndex: 0 }
      set(tabsAtom, current)
    }

    if (maxTabs !== undefined && current.tabs.length >= maxTabs) {
      return
    }

    const nextIndex = Math.max(...current.tabs.map(t => t.index)) + 1

    const newTab: TerminalTab = {
      terminalId: `${baseTerminalId}-${nextIndex}`,
      index: nextIndex,
    }

    const newTabs = [...current.tabs, newTab]
    const newActiveIndex = activateNew ? newTabs.length - 1 : current.activeTabIndex

    set(tabsAtom, {
      tabs: newTabs,
      activeTabIndex: newActiveIndex,
    })
  }
)

export const removeTabActionAtom = atom(
  null,
  (get, set, params: { baseTerminalId: string; tabIndex: number }) => {
    const { baseTerminalId, tabIndex } = params
    const tabsAtom = terminalTabsAtomFamily(baseTerminalId)
    const current = get(tabsAtom)

    const tabArrayIndex = current.tabs.findIndex(t => t.index === tabIndex)
    if (tabArrayIndex === -1) {
      return
    }

    const newTabs = current.tabs.filter(t => t.index !== tabIndex)
    let newActiveIndex = current.activeTabIndex

    if (tabArrayIndex < current.activeTabIndex) {
      newActiveIndex = current.activeTabIndex - 1
    } else if (tabArrayIndex === current.activeTabIndex && newActiveIndex >= newTabs.length) {
      newActiveIndex = Math.max(0, newTabs.length - 1)
    }

    set(tabsAtom, {
      tabs: newTabs,
      activeTabIndex: newActiveIndex,
    })
  }
)

export const setActiveTabActionAtom = atom(
  null,
  (get, set, params: { baseTerminalId: string; tabIndex: number }) => {
    const { baseTerminalId, tabIndex } = params
    const tabsAtom = terminalTabsAtomFamily(baseTerminalId)
    const current = get(tabsAtom)

    // Allow negative indices (e.g., -1 for Run tab) to pass through
    if (tabIndex < 0) {
      set(tabsAtom, {
        ...current,
        activeTabIndex: tabIndex,
      })
      return
    }

    const tabArrayIndex = current.tabs.findIndex(t => t.index === tabIndex)
    const clampedIndex = tabArrayIndex === -1
      ? Math.max(0, Math.min(tabIndex, current.tabs.length - 1))
      : tabArrayIndex

    set(tabsAtom, {
      ...current,
      activeTabIndex: Math.max(0, clampedIndex),
    })
  }
)

export const resetTerminalTabsActionAtom = atom(
  null,
  (_get, set, params: { baseTerminalId: string }) => {
    const { baseTerminalId } = params
    const tabsAtom = terminalTabsAtomFamily(baseTerminalId)
    set(tabsAtom, { ...DEFAULT_TABS_STATE, tabs: [] })
  }
)

export const terminalFocusAtom = atom<Map<string, TerminalFocus>>(new Map())

export const setTerminalFocusActionAtom = atom(
  null,
  (get, set, params: { sessionKey: string; focus: TerminalFocus }) => {
    const { sessionKey, focus } = params
    const current = get(terminalFocusAtom)
    const next = new Map(current)
    next.set(sessionKey, focus)
    set(terminalFocusAtom, next)
  }
)

export const getTerminalFocusAtom = (sessionKey: string) =>
  atom(get => get(terminalFocusAtom).get(sessionKey) ?? null)

export const runModeActiveAtomFamily = atomFamily(
  (_sessionKey: string) => atom<boolean>(false),
  (a, b) => a === b
)

export const agentTypeCacheAtom = atom<Map<string, string>>(new Map())

export const setAgentTypeCacheActionAtom = atom(
  null,
  (get, set, params: { sessionId: string; agentType: string }) => {
    const { sessionId, agentType } = params
    const current = get(agentTypeCacheAtom)
    const next = new Map(current)
    next.set(sessionId, agentType)
    set(agentTypeCacheAtom, next)
  }
)

export const getAgentTypeFromCacheAtom = (sessionId: string) =>
  atom(get => get(agentTypeCacheAtom).get(sessionId))

export const clearAgentTypeCacheActionAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const current = get(agentTypeCacheAtom)
    const next = new Map(current)
    next.delete(sessionId)
    set(agentTypeCacheAtom, next)
  }
)

// Terminal settings atoms for centralized, deterministic config management
export interface TerminalSettings {
  customFontFamily: string | null
  resolvedFontFamily: string
  smoothScrollingEnabled: boolean
  webglEnabled: boolean
}

const DEFAULT_FONT_FAMILY = buildTerminalFontFamily(null)

const terminalSettingsAtom = atom<TerminalSettings>({
  customFontFamily: null,
  resolvedFontFamily: DEFAULT_FONT_FAMILY,
  smoothScrollingEnabled: true,
  webglEnabled: true,
})

const terminalSettingsInitializedAtom = atom(false)

export const terminalSettingsInitializedReadAtom = atom(
  (get) => get(terminalSettingsInitializedAtom)
)

export const customFontFamilyAtom = atom(
  (get) => get(terminalSettingsAtom).customFontFamily
)

export const resolvedFontFamilyAtom = atom(
  (get) => get(terminalSettingsAtom).resolvedFontFamily
)

export const smoothScrollingEnabledAtom = atom(
  (get) => get(terminalSettingsAtom).smoothScrollingEnabled
)

export const webglEnabledAtom = atom(
  (get) => get(terminalSettingsAtom).webglEnabled
)

export const initializeTerminalSettingsActionAtom = atom(
  null,
  async (get, set) => {
    if (get(terminalSettingsInitializedAtom)) {
      return
    }

    try {
      const settings = await invoke<{
        fontFamily?: string | null
        smoothScrolling?: boolean
        webglEnabled?: boolean
      }>(TauriCommands.GetTerminalSettings)

      const customFontFamily = settings?.fontFamily ?? null
      const resolvedFontFamily = buildTerminalFontFamily(customFontFamily)
      const smoothScrollingEnabled = settings?.smoothScrolling ?? true
      const webglEnabled = settings?.webglEnabled ?? true

      set(terminalSettingsAtom, {
        customFontFamily,
        resolvedFontFamily,
        smoothScrollingEnabled,
        webglEnabled,
      })
      set(terminalSettingsInitializedAtom, true)

      emitUiEvent(UiEvent.TerminalFontUpdated, { fontFamily: customFontFamily })
    } catch (err) {
      logger.error('Failed to load terminal settings:', err)
      set(terminalSettingsInitializedAtom, true)
    }
  }
)

export const setTerminalFontFamilyActionAtom = atom(
  null,
  (get, set, customFontFamily: string | null) => {
    const current = get(terminalSettingsAtom)
    const resolvedFontFamily = buildTerminalFontFamily(customFontFamily)

    set(terminalSettingsAtom, {
      ...current,
      customFontFamily,
      resolvedFontFamily,
    })

    emitUiEvent(UiEvent.TerminalFontUpdated, { fontFamily: customFontFamily })
  }
)

export const setSmoothScrollingActionAtom = atom(
  null,
  (get, set, enabled: boolean) => {
    const current = get(terminalSettingsAtom)
    set(terminalSettingsAtom, {
      ...current,
      smoothScrollingEnabled: enabled,
    })
  }
)

export const setWebglEnabledActionAtom = atom(
  null,
  (get, set, enabled: boolean) => {
    const current = get(terminalSettingsAtom)
    set(terminalSettingsAtom, {
      ...current,
      webglEnabled: enabled,
    })
  }
)

export function __resetTerminalAtomsForTest(): void {
  terminalTabsAtomFamily.setShouldRemove(() => true)
  terminalTabsAtomFamily.setShouldRemove(null)
  runModeActiveAtomFamily.setShouldRemove(() => true)
  runModeActiveAtomFamily.setShouldRemove(null)
}
