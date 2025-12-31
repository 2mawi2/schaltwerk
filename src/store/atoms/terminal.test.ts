import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'jotai'
import {
  terminalTabsAtomFamily,
  terminalFocusAtom,
  setTerminalFocusActionAtom,
  runModeActiveAtomFamily,
  agentTypeCacheAtom,
  setAgentTypeCacheActionAtom,
  getAgentTypeFromCacheAtom,
  addTabActionAtom,
  removeTabActionAtom,
  setActiveTabActionAtom,
  resetTerminalTabsActionAtom,
  resolvedFontFamilyAtom,
  customFontFamilyAtom,
  smoothScrollingEnabledAtom,
  webglEnabledAtom,
  terminalSettingsInitializedReadAtom,
  initializeTerminalSettingsActionAtom,
  setTerminalFontFamilyActionAtom,
  setSmoothScrollingActionAtom,
  setWebglEnabledActionAtom,
} from './terminal'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

describe('Terminal Atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  describe('terminalTabsAtomFamily', () => {
    it('returns default state for new terminal base ID', () => {
      const state = store.get(terminalTabsAtomFamily('session-test~abc123-bottom'))
      expect(state).toEqual({
        tabs: [],
        activeTabIndex: 0,
      })
    })

    it('maintains separate state per terminal base ID', () => {
      const atom1 = terminalTabsAtomFamily('session-a~abc-bottom')
      const atom2 = terminalTabsAtomFamily('session-b~def-bottom')

      store.set(atom1, {
        tabs: [{ terminalId: 'session-a~abc-bottom-0', index: 0 }],
        activeTabIndex: 0,
      })

      const state1 = store.get(atom1)
      const state2 = store.get(atom2)

      expect(state1.tabs).toHaveLength(1)
      expect(state2.tabs).toHaveLength(0)
    })
  })

  describe('addTabActionAtom', () => {
    it('initializes with default tab and adds a new tab when called on empty state', async () => {
      const baseId = 'session-test~abc-bottom'

      await store.set(addTabActionAtom, { baseTerminalId: baseId })

      const state = store.get(terminalTabsAtomFamily(baseId))
      // First call initializes with default tab (index 0) and adds new tab (index 1)
      expect(state.tabs).toHaveLength(2)
      expect(state.tabs[0].terminalId).toBe('session-test~abc-bottom')
      expect(state.tabs[0].index).toBe(0)
      expect(state.tabs[1].terminalId).toBe('session-test~abc-bottom-1')
      expect(state.tabs[1].index).toBe(1)
      expect(state.activeTabIndex).toBe(0)
    })

    it('increments tab index for subsequent tabs', async () => {
      const baseId = 'session-test~abc-bottom'

      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(addTabActionAtom, { baseTerminalId: baseId })

      const state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.tabs).toHaveLength(3)
      expect(state.tabs[0].index).toBe(0)
      expect(state.tabs[1].index).toBe(1)
      expect(state.tabs[2].index).toBe(2)
      expect(state.tabs[2].terminalId).toBe('session-test~abc-bottom-2')
    })

    it('sets new tab as active when activateNew is true', async () => {
      const baseId = 'session-test~abc-bottom'

      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(addTabActionAtom, { baseTerminalId: baseId, activateNew: true })

      const state = store.get(terminalTabsAtomFamily(baseId))
      // activeTabIndex stores the actual tab.index value (2), not array position
      expect(state.activeTabIndex).toBe(2)
      // Verify the tab with index 2 exists
      expect(state.tabs.find(t => t.index === 2)).toBeDefined()
    })

    it('respects maxTabs limit', async () => {
      const baseId = 'session-test~abc-bottom'

      // First call: initializes with tab 0, then adds tab 1 -> 2 tabs
      await store.set(addTabActionAtom, { baseTerminalId: baseId, maxTabs: 3 })
      // Second call: already has 2 tabs, adds tab 2 -> 3 tabs
      await store.set(addTabActionAtom, { baseTerminalId: baseId, maxTabs: 3 })
      // Third call: already at limit, should not add
      await store.set(addTabActionAtom, { baseTerminalId: baseId, maxTabs: 3 })

      const state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.tabs).toHaveLength(3)
    })
  })

  describe('removeTabActionAtom', () => {
    it('removes a tab by index', async () => {
      const baseId = 'session-test~abc-bottom'

      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(removeTabActionAtom, { baseTerminalId: baseId, tabIndex: 0 })

      const state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.tabs).toHaveLength(2)
      expect(state.tabs[0].index).toBe(1)
    })

    it('keeps activeTabIndex unchanged when removing tab before active', async () => {
      const baseId = 'session-test~abc-bottom'

      // First addTab: creates tabs [0, 1], second addTab: adds tab 2, third addTab: adds tab 3
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      // Now we have tabs [0, 1, 2, 3], set active to tab index 3
      await store.set(setActiveTabActionAtom, { baseTerminalId: baseId, tabIndex: 3 })
      // Remove tab at index 0
      await store.set(removeTabActionAtom, { baseTerminalId: baseId, tabIndex: 0 })

      const state = store.get(terminalTabsAtomFamily(baseId))
      // activeTabIndex stores the actual tab.index value, not array position
      // Tab 3 still exists, so activeTabIndex remains 3
      expect(state.activeTabIndex).toBe(3)
      expect(state.tabs.find(t => t.index === 3)).toBeDefined()
    })

    it('selects next tab when removing the active tab', async () => {
      const baseId = 'session-test~abc-bottom'

      // First addTab creates tabs [0, 1]
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      // Now tabs: [0, 1, 2]
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      // Set active to last tab (index 2)
      await store.set(setActiveTabActionAtom, { baseTerminalId: baseId, tabIndex: 2 })
      // Remove the active tab
      await store.set(removeTabActionAtom, { baseTerminalId: baseId, tabIndex: 2 })

      const state = store.get(terminalTabsAtomFamily(baseId))
      // When removing the last active tab, select the new last tab (index 1)
      expect(state.activeTabIndex).toBe(1)
      expect(state.tabs.find(t => t.index === 1)).toBeDefined()
    })
  })

  describe('setActiveTabActionAtom', () => {
    it('sets the active tab index', async () => {
      const baseId = 'session-test~abc-bottom'

      // Creates tabs [0, 1]
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(setActiveTabActionAtom, { baseTerminalId: baseId, tabIndex: 1 })

      const state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.activeTabIndex).toBe(1)
    })

    it('falls back to first tab when requested tab does not exist', async () => {
      const baseId = 'session-test~abc-bottom'

      // Creates tabs [0, 1]
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(setActiveTabActionAtom, { baseTerminalId: baseId, tabIndex: 100 })

      const state = store.get(terminalTabsAtomFamily(baseId))
      // Tab 100 doesn't exist, so fall back to the first tab (index 0)
      expect(state.activeTabIndex).toBe(0)
    })

    it('handles non-sequential tab indices correctly', async () => {
      const baseId = 'session-test~abc-bottom'

      // Create tabs [0, 1, 2]
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      // Remove tab 1, leaving [0, 2]
      await store.set(removeTabActionAtom, { baseTerminalId: baseId, tabIndex: 1 })
      // Add new tab, creating [0, 2, 3]
      await store.set(addTabActionAtom, { baseTerminalId: baseId })

      let state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.tabs.map(t => t.index)).toEqual([0, 2, 3])

      // Set active to tab 3
      await store.set(setActiveTabActionAtom, { baseTerminalId: baseId, tabIndex: 3 })
      state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.activeTabIndex).toBe(3)

      // Set active to tab 2
      await store.set(setActiveTabActionAtom, { baseTerminalId: baseId, tabIndex: 2 })
      state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.activeTabIndex).toBe(2)

      // Set active to tab 0
      await store.set(setActiveTabActionAtom, { baseTerminalId: baseId, tabIndex: 0 })
      state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.activeTabIndex).toBe(0)
    })

    it('allows negative indices for special tabs like Run tab', async () => {
      const baseId = 'session-test~abc-bottom'
      const RUN_TAB_INDEX = -1

      // Creates tabs [0, 1]
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(setActiveTabActionAtom, { baseTerminalId: baseId, tabIndex: RUN_TAB_INDEX })

      const state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.activeTabIndex).toBe(-1)
    })

    it('allows switching from Run tab to default tab when atom has no tabs', async () => {
      const baseId = 'session-test~abc-bottom'
      const RUN_TAB_INDEX = -1

      // Start with empty atom state (no tabs in atom, but UI shows default tab at index 0)
      // Set active to Run tab first (simulates user using Run tab)
      await store.set(setActiveTabActionAtom, { baseTerminalId: baseId, tabIndex: RUN_TAB_INDEX })

      let state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.tabs).toHaveLength(0)
      expect(state.activeTabIndex).toBe(-1)

      // Now switch to the default tab at index 0 (simulates user clicking first terminal tab)
      await store.set(setActiveTabActionAtom, { baseTerminalId: baseId, tabIndex: 0 })

      state = store.get(terminalTabsAtomFamily(baseId))
      // The atom should now have activeTabIndex 0 even though tabs array is empty
      // This allows the UI's default tab (index 0) to be shown as active
      expect(state.activeTabIndex).toBe(0)
    })
  })

  describe('resetTerminalTabsActionAtom', () => {
    it('resets tabs state to default', async () => {
      const baseId = 'session-test~abc-bottom'

      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(addTabActionAtom, { baseTerminalId: baseId })
      await store.set(resetTerminalTabsActionAtom, { baseTerminalId: baseId })

      const state = store.get(terminalTabsAtomFamily(baseId))
      expect(state.tabs).toHaveLength(0)
      expect(state.activeTabIndex).toBe(0)
    })
  })

  describe('terminalFocusAtom', () => {
    it('starts with empty focus map', () => {
      const focus = store.get(terminalFocusAtom)
      expect(focus.size).toBe(0)
    })

    it('sets focus for a session', () => {
      store.set(setTerminalFocusActionAtom, { sessionKey: 'session-a', focus: 'claude' })

      const focus = store.get(terminalFocusAtom)
      expect(focus.get('session-a')).toBe('claude')
    })

    it('updates focus for existing session', () => {
      store.set(setTerminalFocusActionAtom, { sessionKey: 'session-a', focus: 'claude' })
      store.set(setTerminalFocusActionAtom, { sessionKey: 'session-a', focus: 'terminal' })

      const focus = store.get(terminalFocusAtom)
      expect(focus.get('session-a')).toBe('terminal')
    })

    it('clears focus when set to null', () => {
      store.set(setTerminalFocusActionAtom, { sessionKey: 'session-a', focus: 'claude' })
      store.set(setTerminalFocusActionAtom, { sessionKey: 'session-a', focus: null })

      const focus = store.get(terminalFocusAtom)
      expect(focus.get('session-a')).toBeNull()
    })

    it('maintains separate focus per session', () => {
      store.set(setTerminalFocusActionAtom, { sessionKey: 'session-a', focus: 'claude' })
      store.set(setTerminalFocusActionAtom, { sessionKey: 'session-b', focus: 'terminal' })

      const focus = store.get(terminalFocusAtom)
      expect(focus.get('session-a')).toBe('claude')
      expect(focus.get('session-b')).toBe('terminal')
    })
  })

  describe('runModeActiveAtomFamily', () => {
    it('defaults to false', () => {
      const isActive = store.get(runModeActiveAtomFamily('session-test'))
      expect(isActive).toBe(false)
    })

    it('can be set to true', () => {
      store.set(runModeActiveAtomFamily('session-test'), true)

      const isActive = store.get(runModeActiveAtomFamily('session-test'))
      expect(isActive).toBe(true)
    })

    it('maintains separate state per session', () => {
      store.set(runModeActiveAtomFamily('session-a'), true)
      store.set(runModeActiveAtomFamily('session-b'), false)

      expect(store.get(runModeActiveAtomFamily('session-a'))).toBe(true)
      expect(store.get(runModeActiveAtomFamily('session-b'))).toBe(false)
    })
  })

  describe('agentTypeCacheAtom', () => {
    it('starts with empty cache', () => {
      const cache = store.get(agentTypeCacheAtom)
      expect(cache.size).toBe(0)
    })

    it('caches agent type for session', () => {
      store.set(setAgentTypeCacheActionAtom, { sessionId: 'session-a', agentType: 'claude' })

      const cache = store.get(agentTypeCacheAtom)
      expect(cache.get('session-a')).toBe('claude')
    })

    it('retrieves cached agent type', () => {
      store.set(setAgentTypeCacheActionAtom, { sessionId: 'session-a', agentType: 'codex' })

      const agentType = store.get(getAgentTypeFromCacheAtom('session-a'))
      expect(agentType).toBe('codex')
    })

    it('returns undefined for uncached session', () => {
      const agentType = store.get(getAgentTypeFromCacheAtom('nonexistent'))
      expect(agentType).toBeUndefined()
    })

    it('updates existing cache entry', () => {
      store.set(setAgentTypeCacheActionAtom, { sessionId: 'session-a', agentType: 'claude' })
      store.set(setAgentTypeCacheActionAtom, { sessionId: 'session-a', agentType: 'gemini' })

      const agentType = store.get(getAgentTypeFromCacheAtom('session-a'))
      expect(agentType).toBe('gemini')
    })
  })

  describe('terminalSettingsAtoms', () => {
    beforeEach(() => {
      mockInvoke.mockReset()
    })

    it('has default values before initialization', () => {
      const resolvedFont = store.get(resolvedFontFamilyAtom)
      const customFont = store.get(customFontFamilyAtom)
      const smoothScrolling = store.get(smoothScrollingEnabledAtom)
      const webgl = store.get(webglEnabledAtom)
      const initialized = store.get(terminalSettingsInitializedReadAtom)

      expect(resolvedFont).toContain('Menlo')
      expect(customFont).toBeNull()
      expect(smoothScrolling).toBe(true)
      expect(webgl).toBe(true)
      expect(initialized).toBe(false)
    })

    it('initializes settings from backend', async () => {
      mockInvoke.mockResolvedValueOnce({
        fontFamily: 'JetBrains Mono',
        smoothScrolling: false,
        webglEnabled: false,
      })

      await store.set(initializeTerminalSettingsActionAtom)

      const resolvedFont = store.get(resolvedFontFamilyAtom)
      const customFont = store.get(customFontFamilyAtom)
      const smoothScrolling = store.get(smoothScrollingEnabledAtom)
      const webgl = store.get(webglEnabledAtom)
      const initialized = store.get(terminalSettingsInitializedReadAtom)

      expect(resolvedFont).toContain('JetBrains Mono')
      expect(customFont).toBe('JetBrains Mono')
      expect(smoothScrolling).toBe(false)
      expect(webgl).toBe(false)
      expect(initialized).toBe(true)
    })

    it('uses defaults when backend returns null values', async () => {
      mockInvoke.mockResolvedValueOnce({
        fontFamily: null,
        smoothScrolling: undefined,
        webglEnabled: undefined,
      })

      await store.set(initializeTerminalSettingsActionAtom)

      const customFont = store.get(customFontFamilyAtom)
      const smoothScrolling = store.get(smoothScrollingEnabledAtom)
      const webgl = store.get(webglEnabledAtom)

      expect(customFont).toBeNull()
      expect(smoothScrolling).toBe(true)
      expect(webgl).toBe(true)
    })

    it('handles backend error gracefully', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Backend error'))

      await store.set(initializeTerminalSettingsActionAtom)

      const initialized = store.get(terminalSettingsInitializedReadAtom)
      expect(initialized).toBe(true)
    })

    it('updates font family via action atom', () => {
      store.set(setTerminalFontFamilyActionAtom, 'Fira Code')

      const resolvedFont = store.get(resolvedFontFamilyAtom)
      const customFont = store.get(customFontFamilyAtom)

      expect(resolvedFont).toContain('Fira Code')
      expect(customFont).toBe('Fira Code')
    })

    it('clears custom font when set to null', () => {
      store.set(setTerminalFontFamilyActionAtom, 'My Custom Font')
      store.set(setTerminalFontFamilyActionAtom, null)

      const resolvedFont = store.get(resolvedFontFamilyAtom)
      const customFont = store.get(customFontFamilyAtom)

      expect(resolvedFont).not.toContain('My Custom Font')
      expect(customFont).toBeNull()
    })

    it('updates smooth scrolling via action atom', () => {
      store.set(setSmoothScrollingActionAtom, false)

      const smoothScrolling = store.get(smoothScrollingEnabledAtom)
      expect(smoothScrolling).toBe(false)

      store.set(setSmoothScrollingActionAtom, true)
      expect(store.get(smoothScrollingEnabledAtom)).toBe(true)
    })

    it('updates webgl enabled via action atom', () => {
      store.set(setWebglEnabledActionAtom, false)

      const webgl = store.get(webglEnabledAtom)
      expect(webgl).toBe(false)

      store.set(setWebglEnabledActionAtom, true)
      expect(store.get(webglEnabledAtom)).toBe(true)
    })
  })
})
