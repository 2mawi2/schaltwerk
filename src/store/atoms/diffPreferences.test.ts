import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'jotai'
import {
  inlineSidebarDefaultPreferenceAtom,
  initializeInlineDiffPreferenceActionAtom,
} from './diffPreferences'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

describe('diffPreferences atoms', () => {
  let store: ReturnType<typeof createStore>

  const flushScheduledSave = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }

  beforeEach(() => {
    store = createStore()
    vi.clearAllMocks()
  })

  describe('inlineSidebarDefaultPreferenceAtom', () => {
    it('has default value of true', () => {
      const value = store.get(inlineSidebarDefaultPreferenceAtom)
      expect(value).toBe(true)
    })

    it('can be set to false', () => {
      store.set(inlineSidebarDefaultPreferenceAtom, false)
      expect(store.get(inlineSidebarDefaultPreferenceAtom)).toBe(false)
    })

    it('can be set to true', () => {
      store.set(inlineSidebarDefaultPreferenceAtom, true)
      expect(store.get(inlineSidebarDefaultPreferenceAtom)).toBe(true)
    })

    it('does not persist before initialization', async () => {
      store.set(inlineSidebarDefaultPreferenceAtom, false)
      await flushScheduledSave()

      expect(invoke).not.toHaveBeenCalled()
    })

    it('persists changes after initialization', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === TauriCommands.GetDiffViewPreferences) {
          return Promise.resolve({
            continuous_scroll: false,
            compact_diffs: true,
            sidebar_width: 320,
            inline_sidebar_default: true,
          })
        }
        if (cmd === TauriCommands.SetDiffViewPreferences) {
          return Promise.resolve()
        }
        return Promise.reject(new Error(`Unknown command: ${cmd}`))
      })

      await store.set(initializeInlineDiffPreferenceActionAtom)

      vi.clearAllMocks()

      store.set(inlineSidebarDefaultPreferenceAtom, false)
      await flushScheduledSave()

      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        TauriCommands.GetDiffViewPreferences
      )
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        TauriCommands.SetDiffViewPreferences,
        {
          preferences: {
            continuous_scroll: false,
            compact_diffs: true,
            sidebar_width: 320,
            inline_sidebar_default: false,
          },
        }
      )
    })

    it('does not save if value unchanged', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === TauriCommands.GetDiffViewPreferences) {
          return Promise.resolve({
            inline_sidebar_default: true,
          })
        }
        return Promise.resolve()
      })

      await store.set(initializeInlineDiffPreferenceActionAtom)

      vi.clearAllMocks()

      store.set(inlineSidebarDefaultPreferenceAtom, true)
      await flushScheduledSave()

      expect(vi.mocked(invoke)).not.toHaveBeenCalled()
    })

    it('batches multiple rapid changes', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === TauriCommands.GetDiffViewPreferences) {
          return Promise.resolve({
            continuous_scroll: false,
            compact_diffs: true,
            sidebar_width: 320,
            inline_sidebar_default: true,
          })
        }
        if (cmd === TauriCommands.SetDiffViewPreferences) {
          return Promise.resolve()
        }
        return Promise.reject(new Error(`Unknown command: ${cmd}`))
      })

      await store.set(initializeInlineDiffPreferenceActionAtom)

      vi.clearAllMocks()

      store.set(inlineSidebarDefaultPreferenceAtom, false)
      store.set(inlineSidebarDefaultPreferenceAtom, true)
      store.set(inlineSidebarDefaultPreferenceAtom, false)

      await flushScheduledSave()

      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        TauriCommands.SetDiffViewPreferences,
        {
          preferences: {
            continuous_scroll: false,
            compact_diffs: true,
            sidebar_width: 320,
            inline_sidebar_default: false,
          },
        }
      )

      const setCalls = vi.mocked(invoke).mock.calls.filter(
        call => call[0] === TauriCommands.SetDiffViewPreferences
      )
      expect(setCalls).toHaveLength(1)
    })
  })

  describe('initializeInlineDiffPreferenceActionAtom', () => {
    it('loads preference from backend', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === TauriCommands.GetDiffViewPreferences) {
          return Promise.resolve({
            inline_sidebar_default: false,
          })
        }
        return Promise.reject(new Error(`Unknown command: ${cmd}`))
      })

      await store.set(initializeInlineDiffPreferenceActionAtom)

      expect(store.get(inlineSidebarDefaultPreferenceAtom)).toBe(false)
    })

    it('defaults to true if preference not set', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === TauriCommands.GetDiffViewPreferences) {
          return Promise.resolve({})
        }
        return Promise.reject(new Error(`Unknown command: ${cmd}`))
      })

      await store.set(initializeInlineDiffPreferenceActionAtom)

      expect(store.get(inlineSidebarDefaultPreferenceAtom)).toBe(true)
    })

    it('defaults to true on error', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === TauriCommands.GetDiffViewPreferences) {
          return Promise.reject(new Error('Backend error'))
        }
        return Promise.reject(new Error(`Unknown command: ${cmd}`))
      })

      await store.set(initializeInlineDiffPreferenceActionAtom)

      expect(store.get(inlineSidebarDefaultPreferenceAtom)).toBe(true)
    })

    it('preserves other preferences when saving', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === TauriCommands.GetDiffViewPreferences) {
          return Promise.resolve({
            continuous_scroll: true,
            compact_diffs: false,
            sidebar_width: 400,
            inline_sidebar_default: true,
          })
        }
        if (cmd === TauriCommands.SetDiffViewPreferences) {
          return Promise.resolve()
        }
        return Promise.reject(new Error(`Unknown command: ${cmd}`))
      })

      await store.set(initializeInlineDiffPreferenceActionAtom)

      vi.clearAllMocks()

      store.set(inlineSidebarDefaultPreferenceAtom, false)
      await flushScheduledSave()

      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        TauriCommands.SetDiffViewPreferences,
        {
          preferences: {
            continuous_scroll: true,
            compact_diffs: false,
            sidebar_width: 400,
            inline_sidebar_default: false,
          },
        }
      )
    })
  })
})
