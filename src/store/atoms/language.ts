import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { Language, Translations } from '../../common/i18n/types'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import { logger } from '../../utils/logger'
import enTranslations from '../../locales/en.json'
import zhTranslations from '../../locales/zh.json'

const languageAtom = atom<Language>('en')
const initializedAtom = atom(false)

const isLanguage = (value: unknown): value is Language =>
  value === 'en' || value === 'zh'

const translationsMap: Record<Language, Translations> = {
  en: enTranslations as Translations,
  zh: zhTranslations as Translations,
}

export const translationsAtom = atom<Translations>((get) => {
  const lang = get(languageAtom)
  return translationsMap[lang]
})

export const currentLanguageAtom = atom((get) => get(languageAtom))

export const setLanguageActionAtom = atom(
  null,
  async (get, set, newLanguage: Language) => {
    set(languageAtom, newLanguage)

    emitUiEvent(UiEvent.LanguageChanged, { language: newLanguage })

    if (get(initializedAtom)) {
      try {
        await invoke(TauriCommands.SchaltwerkCoreSetLanguage, { language: newLanguage })
      } catch (error) {
        logger.error('Failed to save language preference:', error)
      }
    }
  }
)

export const initializeLanguageActionAtom = atom(
  null,
  async (_get, set) => {
    let savedLanguage: Language = 'en'

    try {
      const saved = await invoke<string>(TauriCommands.SchaltwerkCoreGetLanguage)
      savedLanguage = isLanguage(saved) ? saved : 'en'
    } catch (error) {
      logger.error('Failed to load language preference:', error)
    }

    set(languageAtom, savedLanguage)
    set(initializedAtom, true)
  }
)
