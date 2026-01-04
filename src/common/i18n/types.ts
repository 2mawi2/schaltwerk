export type Language = 'en' | 'zh'

export interface Translations {
  dialogs: {
    cancelSession: {
      title: string
      body: string
      warningUncommitted: string
      allCommitted: string
      forceCancel: string
      cancelSession: string
      keepSession: string
    }
    deleteSpec: {
      title: string
      body: string
      bodyNote: string
      confirm: string
      confirmTitle: string
      cancel: string
      cancelTitle: string
    }
    convertToSpec: {
      title: string
      body: string
      warningTitle: string
      warningBody: string
      warningItem1: string
      warningItem2: string
      warningItem3: string
      normalBody: string
      normalItem1: string
      footnote: string
      confirm: string
      confirmTitle: string
      cancel: string
      cancelTitle: string
    }
  }
  settings: {
    title: string
    sectionApplication: string
    sectionProject: string
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
      dark: string
      darkDesc: string
      light: string
      lightDesc: string
      system: string
      systemDesc: string
      beta: string
      moreThemes: string
    }
    language: {
      label: string
      english: string
      chinese: string
    }
    appearance: {
      fontSizes: string
      terminalFontSize: string
      uiFontSize: string
      terminalFontFamily: string
      fontFamilyPlaceholder: string
      browseFonts: string
      fontFamilyDesc: string
      gpuAcceleration: string
      gpuAccelerationDesc: string
      devDiagnostics: string
      devDiagnosticsDesc: string
      showErrorToasts: string
      keyboardShortcuts: string
      increaseFontSize: string
      decreaseFontSize: string
      resetFontSize: string
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
  sidebar: {
    header: string
    orchestrator: string
    filters: {
      specs: string
      running: string
      reviewed: string
      specShort: string
      runShort: string
      revShort: string
    }
    search: {
      placeholder: string
      title: string
      results: string
      result: string
    }
    empty: string
    ungrouped: string
  }
  session: {
    idle: string
    running: string
    reviewed: string
    blocked: string
    spec: string
    complete: string
  }
  shortcuts: {
    sections: {
      appearance: string
      navigation: string
      sessionManagement: string
      review: string
      terminal: string
    }
  }
}
