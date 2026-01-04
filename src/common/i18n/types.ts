export type Language = 'en' | 'zh'

export interface Translations {
  settings: {
    categories: {
      appearance: string
      archives: string
      keyboard: string
      environment: string
      projectGeneral: string
      projectRun: string
      projectActions: string
      terminal: string
      sessions: string
      version: string
    }
    theme: {
      label: string
      light: string
      dark: string
      system: string
      currentLight: string
      currentDark: string
      followsSystem: string
    }
    language: {
      label: string
      english: string
      chinese: string
    }
    common: {
      save: string
      cancel: string
      delete: string
      close: string
      ok: string
      confirm: string
      reset: string
    }
  }
}
