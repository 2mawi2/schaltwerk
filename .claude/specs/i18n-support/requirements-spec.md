# i18n (Internationalization) Support - Technical Specification

## Problem Statement

- **Business Issue**: Schaltwerk UI is currently English-only, limiting accessibility for non-English speaking users (particularly Chinese developers)
- **Current State**: All UI text is hardcoded in English strings across components
- **Expected Outcome**:
  - Users can select their preferred language (English/Chinese)
  - UI dynamically displays text in the selected language
  - Language preference persists across app restarts
  - Type-safe translation keys prevent runtime errors
  - Zero external dependencies (no react-i18next or similar libraries)

## Solution Overview

- **Approach**: Implement a lightweight, type-safe i18n system using Jotai for state management and static JSON translation files bundled at build time
- **Core Changes**:
  - Add `language` field to backend Settings struct
  - Create Jotai atom for language state following theme.ts pattern
  - Create translation system with type-safe keys
  - Add LanguageSettings component in SettingsModal
  - Extract translatable strings starting with SettingsModal
- **Success Criteria**:
  - Users can switch between English and Chinese in Settings
  - Language selection persists via Tauri backend
  - All translated strings are type-safe (TypeScript errors on missing keys)
  - No external i18n libraries used
  - Translation access is synchronous in render

## Technical Implementation

### Database Changes

**File**: `/Users/a1/work/schaltwerk/src-tauri/src/domains/settings/types.rs`

Add language field to Settings struct (around line 282):

```rust
fn default_language() -> String {
    "en".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    pub agent_env_vars: AgentEnvVars,
    pub agent_cli_args: AgentCliArgs,
    #[serde(default)]
    pub agent_initial_commands: AgentInitialCommands,
    #[serde(default)]
    pub agent_preferences: AgentPreferences,
    pub terminal_ui: TerminalUIPreferences,
    pub terminal: TerminalSettings,
    #[serde(default)]
    pub font_sizes: FontSizes,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_language")]  // NEW
    pub language: String,                    // NEW
    pub agent_binaries: AgentBinaryConfigs,
    pub diff_view: DiffViewPreferences,
    pub session: SessionPreferences,
    #[serde(default)]
    pub updater: UpdaterPreferences,
    #[serde(default)]
    pub keyboard_shortcuts: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub tutorial_completed: bool,
    #[serde(default)]
    pub amp_mcp_servers: HashMap<String, McpServerConfig>,
    #[serde(default = "default_true")]
    pub dev_error_toasts_enabled: bool,
    #[serde(default)]
    pub last_project_parent_directory: Option<String>,
    #[serde(default)]
    pub agent_command_prefix: Option<String>,
}
```

Update Default impl (around line 314):

```rust
impl Default for Settings {
    fn default() -> Self {
        Self {
            agent_env_vars: AgentEnvVars::default(),
            agent_cli_args: AgentCliArgs::default(),
            agent_initial_commands: AgentInitialCommands::default(),
            agent_preferences: AgentPreferences::default(),
            terminal_ui: TerminalUIPreferences::default(),
            terminal: TerminalSettings::default(),
            font_sizes: FontSizes::default(),
            theme: default_theme(),
            language: default_language(),  // NEW
            agent_binaries: AgentBinaryConfigs::default(),
            diff_view: DiffViewPreferences::default(),
            session: SessionPreferences::default(),
            updater: UpdaterPreferences::default(),
            keyboard_shortcuts: HashMap::new(),
            tutorial_completed: false,
            amp_mcp_servers: HashMap::new(),
            dev_error_toasts_enabled: default_true(),
            last_project_parent_directory: None,
            agent_command_prefix: None,
        }
    }
}
```

### Code Changes

#### Backend Service Layer

**File**: `/Users/a1/work/schaltwerk/src-tauri/src/domains/settings/service.rs`

Add after `set_theme` method (around line 131):

```rust
pub fn get_language(&self) -> String {
    self.settings.language.clone()
}

pub fn set_language(&mut self, language: &str) -> Result<(), SettingsServiceError> {
    self.settings.language = language.to_string();
    self.save()
}
```

**File**: `/Users/a1/work/schaltwerk/src-tauri/src/commands/settings.rs`

Add Tauri commands:

```rust
#[tauri::command]
pub async fn schaltwerk_core_get_language(
    settings_service: State<'_, Arc<Mutex<SettingsService>>>,
) -> Result<String, String> {
    let service = settings_service.lock().map_err(|e| e.to_string())?;
    Ok(service.get_language())
}

#[tauri::command]
pub async fn schaltwerk_core_set_language(
    settings_service: State<'_, Arc<Mutex<SettingsService>>>,
    language: String,
) -> Result<(), String> {
    let mut service = settings_service.lock().map_err(|e| e.to_string())?;
    service
        .set_language(&language)
        .map_err(|e| e.to_string())
}
```

**File**: `/Users/a1/work/schaltwerk/src-tauri/src/main.rs`

Register commands in `tauri::Builder` (find the `.invoke_handler` section):

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    commands::settings::schaltwerk_core_get_theme,
    commands::settings::schaltwerk_core_set_theme,
    commands::settings::schaltwerk_core_get_language,  // NEW
    commands::settings::schaltwerk_core_set_language,  // NEW
    // ... rest of commands ...
])
```

#### Frontend Type Definitions

**File**: `/Users/a1/work/schaltwerk/src/common/i18n/types.ts` (NEW)

```typescript
export type Language = 'en' | 'zh'

export interface Translations {
  settings: {
    categories: {
      appearance: string
      archives: string
      keyboard: string
      environment: string
      projectGeneral: string
      projectMerge: string
      projectActions: string
      projectSessions: string
      github: string
      updates: string
      mcp: string
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
```

**File**: `/Users/a1/work/schaltwerk/src/locales/en.json` (NEW)

```json
{
  "settings": {
    "categories": {
      "appearance": "Appearance",
      "archives": "Archives",
      "keyboard": "Keyboard Shortcuts",
      "environment": "Agent Configuration",
      "projectGeneral": "Project Settings",
      "projectMerge": "Merge Preferences",
      "projectActions": "Action Buttons",
      "projectSessions": "Sessions",
      "github": "GitHub",
      "updates": "Updates",
      "mcp": "MCP Configuration"
    },
    "theme": {
      "label": "Theme",
      "light": "Light",
      "dark": "Dark",
      "system": "System",
      "currentLight": "Currently Light",
      "currentDark": "Currently Dark",
      "followsSystem": "Follows system"
    },
    "language": {
      "label": "Language",
      "english": "English",
      "chinese": "中文"
    },
    "common": {
      "save": "Save",
      "cancel": "Cancel",
      "delete": "Delete",
      "close": "Close",
      "ok": "OK",
      "confirm": "Confirm",
      "reset": "Reset"
    }
  }
}
```

**File**: `/Users/a1/work/schaltwerk/src/locales/zh.json` (NEW)

```json
{
  "settings": {
    "categories": {
      "appearance": "外观",
      "archives": "归档",
      "keyboard": "键盘快捷键",
      "environment": "代理配置",
      "projectGeneral": "项目设置",
      "projectMerge": "合并偏好",
      "projectActions": "操作按钮",
      "projectSessions": "会话",
      "github": "GitHub",
      "updates": "更新",
      "mcp": "MCP 配置"
    },
    "theme": {
      "label": "主题",
      "light": "浅色",
      "dark": "深色",
      "system": "系统",
      "currentLight": "当前为浅色",
      "currentDark": "当前为深色",
      "followsSystem": "跟随系统"
    },
    "language": {
      "label": "语言",
      "english": "English",
      "chinese": "中文"
    },
    "common": {
      "save": "保存",
      "cancel": "取消",
      "delete": "删除",
      "close": "关闭",
      "ok": "确定",
      "confirm": "确认",
      "reset": "重置"
    }
  }
}
```

#### Frontend State Management

**File**: `/Users/a1/work/schaltwerk/src/store/atoms/language.ts` (NEW)

```typescript
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
  async (get, set) => {
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
```

**File**: `/Users/a1/work/schaltwerk/src/common/i18n/useTranslation.ts` (NEW)

```typescript
import { useAtomValue } from 'jotai'
import { translationsAtom, currentLanguageAtom } from '../../store/atoms/language'
import type { Translations } from './types'

export function useTranslation() {
  const t = useAtomValue(translationsAtom)
  const currentLanguage = useAtomValue(currentLanguageAtom)

  return { t, currentLanguage }
}
```

#### Frontend Command Registration

**File**: `/Users/a1/work/schaltwerk/src/common/tauriCommands.ts`

Add after `SchaltwerkCoreSetTheme` (around line 150):

```typescript
export const TauriCommands = {
  // ... existing commands ...
  SchaltwerkCoreGetTheme: 'schaltwerk_core_get_theme',
  SchaltwerkCoreSetTheme: 'schaltwerk_core_set_theme',
  SchaltwerkCoreGetLanguage: 'schaltwerk_core_get_language',  // NEW
  SchaltwerkCoreSetLanguage: 'schaltwerk_core_set_language',  // NEW
  // ... rest of commands ...
} as const
```

#### Frontend Event System

**File**: `/Users/a1/work/schaltwerk/src/common/uiEvents.ts`

Add event type (around line 35):

```typescript
export enum UiEvent {
  // ... existing events ...
  ThemeChanged = 'theme-changed',
  LanguageChanged = 'language-changed',  // NEW
  GlobalNewSessionShortcut = 'global-new-session-shortcut',
  // ... rest of events ...
}
```

Add payload interface (around line 136):

```typescript
export interface LanguageChangedDetail {
  language: Language
}
```

Update payload map (around line 230):

```typescript
export type UiEventPayloads = {
  // ... existing mappings ...
  [UiEvent.ThemeChanged]: ThemeChangedDetail
  [UiEvent.LanguageChanged]: LanguageChangedDetail  // NEW
  [UiEvent.GlobalNewSessionShortcut]: undefined
  // ... rest of mappings ...
}
```

Add import at top:

```typescript
import type { Language } from './i18n/types'
```

#### UI Component

**File**: `/Users/a1/work/schaltwerk/src/components/settings/LanguageSettings.tsx` (NEW)

```typescript
import { useAtomValue, useSetAtom } from 'jotai'
import { currentLanguageAtom, setLanguageActionAtom } from '../../store/atoms/language'
import type { Language } from '../../common/i18n/types'
import { theme } from '../../common/theme'
import { useTranslation } from '../../common/i18n/useTranslation'

const languageOptions: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
]

export function LanguageSettings() {
  const currentLanguage = useAtomValue(currentLanguageAtom)
  const setLanguage = useSetAtom(setLanguageActionAtom)
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: theme.fontSize.label,
          }}
        >
          {t.settings.language.label}
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {languageOptions.map((option) => {
          const isSelected = currentLanguage === option.id

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => { void setLanguage(option.id) }}
              aria-pressed={isSelected}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors"
              style={{
                backgroundColor: isSelected
                  ? 'var(--color-accent-blue-bg)'
                  : 'var(--color-bg-elevated)',
                borderColor: isSelected
                  ? 'var(--color-accent-blue)'
                  : 'var(--color-border-subtle)',
                color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontSize: theme.fontSize.body,
              }}
            >
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

#### App Initialization

**File**: `/Users/a1/work/schaltwerk/src/App.tsx`

Add import (around line 30):

```typescript
import { initializeThemeActionAtom } from './store/atoms/theme'
import { initializeLanguageActionAtom } from './store/atoms/language'  // NEW
import { initializeInlineDiffPreferenceActionAtom } from './store/atoms/diffPreferences'
```

Add initialization hook (around line 126):

```typescript
const initializeFontSizes = useSetAtom(initializeFontSizesActionAtom)
const initializeTheme = useSetAtom(initializeThemeActionAtom)
const initializeLanguage = useSetAtom(initializeLanguageActionAtom)  // NEW
const initializeInlineDiffPreference = useSetAtom(initializeInlineDiffPreferenceActionAtom)
```

Call in useEffect (find the initialization effect and add):

```typescript
useEffect(() => {
  void initializeFontSizes()
  void initializeTheme()
  void initializeLanguage()  // NEW
  void initializeInlineDiffPreference()
  // ... rest of initialization ...
}, [initializeFontSizes, initializeTheme, initializeLanguage, initializeInlineDiffPreference])
```

#### Settings Modal Integration

**File**: `/Users/a1/work/schaltwerk/src/components/modals/SettingsModal.tsx`

Add import (around line 15):

```typescript
import { ThemeSettings } from '../settings/ThemeSettings'
import { LanguageSettings } from '../settings/LanguageSettings'  // NEW
import { logger } from '../../utils/logger'
```

Add LanguageSettings component in Appearance section (find the Appearance category render, around the ThemeSettings usage):

```tsx
{selectedCategory === 'appearance' && (
  <div className="space-y-6">
    <ThemeSettings />
    <LanguageSettings />  {/* NEW */}
    {/* ... rest of appearance settings ... */}
  </div>
)}
```

### Configuration Changes

No build configuration changes required. TypeScript will automatically include JSON files via `resolveJsonModule: true` (already enabled in tsconfig.json).

## Implementation Sequence

### Phase 1: Backend Foundation
1. Add `language` field to `Settings` struct in `/Users/a1/work/schaltwerk/src-tauri/src/domains/settings/types.rs`
2. Add `get_language()` and `set_language()` methods to `SettingsService` in `/Users/a1/work/schaltwerk/src-tauri/src/domains/settings/service.rs`
3. Add Tauri commands in `/Users/a1/work/schaltwerk/src-tauri/src/commands/settings.rs`
4. Register commands in `/Users/a1/work/schaltwerk/src-tauri/src/main.rs`

**Validation**: Run `bun run lint:rust` and `bun run test:rust`

### Phase 2: Frontend Type System
1. Create `/Users/a1/work/schaltwerk/src/common/i18n/types.ts` with Language type and Translations interface
2. Create `/Users/a1/work/schaltwerk/src/locales/en.json` with English translations
3. Create `/Users/a1/work/schaltwerk/src/locales/zh.json` with Chinese translations
4. Update `/Users/a1/work/schaltwerk/src/common/tauriCommands.ts` with new commands
5. Update `/Users/a1/work/schaltwerk/src/common/uiEvents.ts` with LanguageChanged event

**Validation**: Run `bun run lint` to verify TypeScript compilation

### Phase 3: State Management
1. Create `/Users/a1/work/schaltwerk/src/store/atoms/language.ts` following theme.ts pattern
2. Create `/Users/a1/work/schaltwerk/src/common/i18n/useTranslation.ts` hook
3. Update `/Users/a1/work/schaltwerk/src/App.tsx` to initialize language on startup

**Validation**: Run `bun run lint` and verify app starts without errors

### Phase 4: UI Components
1. Create `/Users/a1/work/schaltwerk/src/components/settings/LanguageSettings.tsx`
2. Update `/Users/a1/work/schaltwerk/src/components/modals/SettingsModal.tsx` to include LanguageSettings
3. Update `/Users/a1/work/schaltwerk/src/components/settings/ThemeSettings.tsx` to use translations (optional for initial implementation)

**Validation**: Run `bun run tauri:dev` and manually test language switching in Settings

### Phase 5: Testing
1. Create `/Users/a1/work/schaltwerk/src/store/atoms/language.test.ts` following theme.test.ts pattern
2. Add backend tests in `/Users/a1/work/schaltwerk/src-tauri/src/domains/settings/service.rs` (in `#[cfg(test)]` module)

**Validation**: Run `just test` to ensure all tests pass

## Validation Plan

### Unit Tests

**File**: `/Users/a1/work/schaltwerk/src/store/atoms/language.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'jotai'
import {
  currentLanguageAtom,
  setLanguageActionAtom,
  initializeLanguageActionAtom,
  translationsAtom,
} from './language'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('language atoms', () => {
  let store: ReturnType<typeof createStore>
  const { invoke } = await import('@tauri-apps/api/core')

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
```

**Backend Tests** (add to `/Users/a1/work/schaltwerk/src-tauri/src/domains/settings/service.rs` in `#[cfg(test)]` module):

```rust
#[test]
fn language_defaults_to_en() {
    let repo = InMemoryRepository::default();
    let service = SettingsService::new(Box::new(repo));

    assert_eq!(service.get_language(), "en");
}

#[test]
fn set_language_persists_value() {
    let repo = InMemoryRepository::default();
    let repo_handle = repo.clone();
    let mut service = SettingsService::new(Box::new(repo));

    service
        .set_language("zh")
        .expect("should persist language selection");

    assert_eq!(service.get_language(), "zh");
    assert_eq!(repo_handle.snapshot().language, "zh");
}
```

### Integration Tests

**Manual Testing Checklist**:
1. Open Settings → Appearance
2. Verify Language selector appears below Theme selector
3. Click "中文" button
4. Verify language selector label changes to "语言"
5. Restart application
6. Verify language remains Chinese
7. Switch back to English
8. Verify all text returns to English

### Business Logic Verification

**Success Criteria**:
- ✅ Language selection persists across app restarts
- ✅ UI text updates immediately on language change
- ✅ TypeScript catches missing translation keys at compile time
- ✅ No external i18n dependencies in package.json
- ✅ Translation access is synchronous (no async/await in components)
- ✅ Follows existing patterns (theme.ts, fontSize.ts)

## Technical Constraints

### MUST Requirements
- Use exact Jotai pattern from theme.ts (languageAtom, initializedAtom, setLanguageActionAtom, initializeLanguageActionAtom)
- Static JSON imports (no dynamic loading)
- Type-safe translation keys via TypeScript interface
- Store language in backend Settings struct with serde default
- Synchronous translation access in components
- Follow KISS/YAGNI principles (no translation namespaces, interpolation, pluralization in initial implementation)

### MUST NOT Requirements
- No external i18n libraries (react-i18next, i18next, etc.)
- No dynamic translation loading at runtime
- No string interpolation in initial implementation (add only if needed later)
- No pluralization logic in initial implementation
- No context-based translations (keep simple key-value structure)
- No fallback chains (if key missing, TypeScript compilation fails)

## Future Extensions

**Not in initial scope** (add only when explicitly requested):
- Additional languages (Japanese, Korean, etc.)
- String interpolation for dynamic values
- Pluralization support
- Context-based translations
- RTL language support
- Translation extraction tooling
- Lazy loading of translation files

**Pattern for adding new translatable areas**:
1. Add keys to `Translations` interface in `/Users/a1/work/schaltwerk/src/common/i18n/types.ts`
2. Add translations to both `en.json` and `zh.json`
3. Use `const { t } = useTranslation()` in component
4. Replace hardcoded strings with `t.section.key`

## Notes

- Initial translation coverage focuses on SettingsModal (highest ROI for demonstrating the system)
- Additional UI areas can be translated incrementally following the same pattern
- Translation files are bundled at build time (no runtime loading overhead)
- Type safety ensures all translation keys exist in all languages at compile time
- The system can be extended to support more languages by adding new JSON files and updating the `Language` type
