import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'jotai'
import {
  currentLanguageAtom,
  setLanguageActionAtom,
  initializeLanguageActionAtom,
  translationsAtom,
} from './language'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('language atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('defaults to English', () => {
      expect(store.get(currentLanguageAtom)).toBe('en')
    })

    it('loads saved language from backend', async () => {
      vi.mocked(invoke).mockResolvedValueOnce('zh')
      await store.set(initializeLanguageActionAtom)
      expect(store.get(currentLanguageAtom)).toBe('zh')
    })

    it('falls back to English on invalid language', async () => {
      vi.mocked(invoke).mockResolvedValueOnce('invalid')
      await store.set(initializeLanguageActionAtom)
      expect(store.get(currentLanguageAtom)).toBe('en')
    })
  })

  describe('language switching', () => {
    it('updates language and persists to backend', async () => {
      await store.set(initializeLanguageActionAtom)
      await store.set(setLanguageActionAtom, 'zh')

      expect(store.get(currentLanguageAtom)).toBe('zh')
      expect(invoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreSetLanguage,
        { language: 'zh' }
      )
    })

    it('updates translations when language changes', async () => {
      await store.set(setLanguageActionAtom, 'zh')
      const translations = store.get(translationsAtom)
      expect(translations.settings.language.label).toBe('语言')
    })
  })
})
