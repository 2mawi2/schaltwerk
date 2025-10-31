import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createStore } from 'jotai'
import {
  terminalFontSizeAtom,
  uiFontSizeAtom,
  increaseFontSizesActionAtom,
  decreaseFontSizesActionAtom,
  resetFontSizesActionAtom,
  initializeFontSizesActionAtom,
} from './fontSize'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === TauriCommands.SchaltwerkCoreGetFontSizes) {
      return Promise.resolve([15, 16])
    }
    if (cmd === TauriCommands.SchaltwerkCoreSetFontSizes) {
      return Promise.resolve()
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`))
  }),
}))

vi.mock('../../common/uiEvents', () => ({
  emitUiEvent: vi.fn(),
  UiEvent: {
    FontSizeChanged: 'font-size-changed',
  },
}))

describe('fontSize atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  describe('terminalFontSizeAtom', () => {
    it('has default value of 13', () => {
      const size = store.get(terminalFontSizeAtom)
      expect(size).toBe(13)
    })

    it('can be set to a valid size', () => {
      store.set(terminalFontSizeAtom, 15)
      expect(store.get(terminalFontSizeAtom)).toBe(15)
    })

    it('rejects sizes below minimum (8)', () => {
      store.set(terminalFontSizeAtom, 7)
      expect(store.get(terminalFontSizeAtom)).toBe(13)
    })

    it('rejects sizes above maximum (24)', () => {
      store.set(terminalFontSizeAtom, 25)
      expect(store.get(terminalFontSizeAtom)).toBe(13)
    })
  })

  describe('uiFontSizeAtom', () => {
    it('has default value of 14', () => {
      const size = store.get(uiFontSizeAtom)
      expect(size).toBe(14)
    })

    it('can be set to a valid size', () => {
      store.set(uiFontSizeAtom, 16)
      expect(store.get(uiFontSizeAtom)).toBe(16)
    })

    it('rejects sizes below minimum (8)', () => {
      store.set(uiFontSizeAtom, 7)
      expect(store.get(uiFontSizeAtom)).toBe(14)
    })

    it('rejects sizes above maximum (24)', () => {
      store.set(uiFontSizeAtom, 25)
      expect(store.get(uiFontSizeAtom)).toBe(14)
    })
  })

  describe('increaseFontSizesActionAtom', () => {
    it('increases both font sizes by 1', () => {
      store.set(increaseFontSizesActionAtom)
      expect(store.get(terminalFontSizeAtom)).toBe(14)
      expect(store.get(uiFontSizeAtom)).toBe(15)
    })

    it('caps at maximum size (24)', () => {
      store.set(terminalFontSizeAtom, 24)
      store.set(uiFontSizeAtom, 24)
      store.set(increaseFontSizesActionAtom)
      expect(store.get(terminalFontSizeAtom)).toBe(24)
      expect(store.get(uiFontSizeAtom)).toBe(24)
    })
  })

  describe('decreaseFontSizesActionAtom', () => {
    it('decreases both font sizes by 1', () => {
      store.set(decreaseFontSizesActionAtom)
      expect(store.get(terminalFontSizeAtom)).toBe(12)
      expect(store.get(uiFontSizeAtom)).toBe(13)
    })

    it('caps at minimum size (8)', () => {
      store.set(terminalFontSizeAtom, 8)
      store.set(uiFontSizeAtom, 8)
      store.set(decreaseFontSizesActionAtom)
      expect(store.get(terminalFontSizeAtom)).toBe(8)
      expect(store.get(uiFontSizeAtom)).toBe(8)
    })
  })

  describe('resetFontSizesActionAtom', () => {
    it('resets both font sizes to defaults', () => {
      store.set(terminalFontSizeAtom, 20)
      store.set(uiFontSizeAtom, 22)
      store.set(resetFontSizesActionAtom)
      expect(store.get(terminalFontSizeAtom)).toBe(13)
      expect(store.get(uiFontSizeAtom)).toBe(14)
    })
  })

  describe('initializeFontSizesActionAtom', () => {
    it('loads font sizes from backend', async () => {
      await store.set(initializeFontSizesActionAtom)
      expect(store.get(terminalFontSizeAtom)).toBe(15)
      expect(store.get(uiFontSizeAtom)).toBe(16)
    })

    it('uses defaults if backend returns invalid sizes', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValueOnce([100, 200])

      await store.set(initializeFontSizesActionAtom)
      expect(store.get(terminalFontSizeAtom)).toBe(13)
      expect(store.get(uiFontSizeAtom)).toBe(14)
    })
  })

  describe('debouncing', () => {
    it('debounces backend saves by 400ms', async () => {
      const { invoke } = await import('@tauri-apps/api/core')

      await store.set(initializeFontSizesActionAtom)
      vi.clearAllMocks()

      store.set(terminalFontSizeAtom, 16)
      expect(invoke).not.toHaveBeenCalled()

      vi.advanceTimersByTime(200)
      expect(invoke).not.toHaveBeenCalled()

      vi.advanceTimersByTime(200)
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetFontSizes, {
        terminalFontSize: 16,
        uiFontSize: 16,
      })
    })

    it('resets debounce timer on subsequent changes', async () => {
      const { invoke } = await import('@tauri-apps/api/core')

      await store.set(initializeFontSizesActionAtom)
      vi.clearAllMocks()

      store.set(terminalFontSizeAtom, 16)
      vi.advanceTimersByTime(300)

      store.set(terminalFontSizeAtom, 17)
      vi.advanceTimersByTime(300)
      expect(invoke).not.toHaveBeenCalled()

      vi.advanceTimersByTime(100)
      expect(invoke).toHaveBeenCalledTimes(1)
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetFontSizes, {
        terminalFontSize: 17,
        uiFontSize: 16,
      })
    })

    it('skips save if values match last saved', async () => {
      const { invoke } = await import('@tauri-apps/api/core')

      await store.set(initializeFontSizesActionAtom)
      vi.clearAllMocks()

      store.set(terminalFontSizeAtom, 16)
      vi.advanceTimersByTime(400)
      expect(invoke).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()
      store.set(terminalFontSizeAtom, 16)
      vi.advanceTimersByTime(400)
      expect(invoke).not.toHaveBeenCalled()
    })
  })
})
