# Light Mode Theme Support - Implementation Plan

## Overview
Add light mode theme option to Schaltwerk with a toggle in Settings > Appearance. The implementation follows patterns from VS Code's theming system, adapted to Schaltwerk's existing architecture using CSS variables, Jotai atoms, and Tauri commands.

## Design Decisions
- **Theme options**: Dark / Light only (no system auto-detect)
- **Terminal**: Matches app theme (light terminal in light mode)
- **Persistence**: Stored in app settings via Tauri (like font sizes)
- **Runtime switching**: CSS variables updated on `<html>` element via `data-theme` attribute

---

## Implementation Phases

### Phase 1: Backend - Theme Mode Storage

**Files to modify:**
- `src-tauri/src/domains/settings/types.rs`
- `src-tauri/src/commands/schaltwerk_core.rs`

**Changes:**
1. Add `ThemeMode` enum:
   ```rust
   #[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
   #[serde(rename_all = "lowercase")]
   pub enum ThemeMode {
       #[default]
       Dark,
       Light,
   }
   ```

2. Add `theme_mode: ThemeMode` field to `Settings` struct

3. Add Tauri commands:
   - `schaltwerk_core_get_theme_mode` → returns `ThemeMode`
   - `schaltwerk_core_set_theme_mode` → persists `ThemeMode`

---

### Phase 2: CSS - Light Theme Variables

**Files to modify:**
- `src/styles/theme.css`

**Changes:**
1. Keep `:root` with current dark values as defaults
2. Add `[data-theme="light"]` selector with light mode overrides:

```css
[data-theme="light"] {
  /* Background - light sky blue inspired */
  --color-bg-primary: #f8fafc;       /* slate-50 */
  --color-bg-secondary: #f1f5f9;     /* slate-100 */
  --color-bg-tertiary: #e2e8f0;      /* slate-200 */
  --color-bg-elevated: #ffffff;      /* white */
  --color-bg-hover: #e2e8f0;         /* slate-200 */
  --color-bg-active: #cbd5e1;        /* slate-300 */

  /* Text - dark on light */
  --color-text-primary: #0f172a;     /* slate-900 */
  --color-text-secondary: #334155;   /* slate-700 */
  --color-text-tertiary: #475569;    /* slate-600 */
  --color-text-muted: #64748b;       /* slate-500 */
  --color-text-inverse: #f8fafc;     /* slate-50 */

  /* Borders */
  --color-border-default: #e2e8f0;   /* slate-200 */
  --color-border-subtle: #cbd5e1;    /* slate-300 */
  --color-border-strong: #94a3b8;    /* slate-400 */

  /* Editor - light background */
  --color-editor-background: #ffffff;
  --color-editor-text: #1e293b;
  --color-editor-caret: #1e293b;
  --color-editor-gutter-text: #94a3b8;
  --color-editor-gutter-active-text: #475569;
  --color-editor-active-line: rgba(0, 0, 0, 0.04);
  --color-editor-inline-code-bg: rgba(0, 0, 0, 0.06);
  --color-editor-code-block-bg: rgba(0, 0, 0, 0.04);

  /* Syntax - light theme colors (VS Code Light+ inspired) */
  --color-syntax-default: #1e293b;
  --color-syntax-comment: #6a9955;
  --color-syntax-variable: #001080;
  --color-syntax-number: #098658;
  --color-syntax-type: #267f99;
  --color-syntax-keyword: #0000ff;
  --color-syntax-string: #a31515;
  --color-syntax-function: #795e26;

  /* Scrollbar */
  --color-scrollbar-track: rgba(0, 0, 0, 0.05);
  --color-scrollbar-thumb: rgba(0, 0, 0, 0.2);
  --color-scrollbar-thumb-hover: rgba(0, 0, 0, 0.3);

  /* Overlays */
  --color-overlay-backdrop: rgba(0, 0, 0, 0.4);
  --color-surface-modal: #ffffff;

  /* Tabs */
  --color-tab-inactive-text: #64748b;
  --color-tab-inactive-hover-bg: rgba(0, 0, 0, 0.05);
  --color-tab-inactive-hover-text: #334155;
  --color-tab-active-bg: #ffffff;
  --color-tab-active-text: #0f172a;

  /* Selection */
  --color-selection-bg: rgba(6, 182, 212, 0.3);
}
```

Also add RGB variants for all new light values (for Tailwind opacity support).

---

### Phase 3: Frontend - Theme Mode Atom

**Files to create:**
- `src/store/atoms/themeMode.ts`
- `src/store/atoms/themeMode.test.ts`

**Pattern:** Follow `fontSize.ts` exactly:
1. Private `themeModeAtom` with default `'dark'`
2. Read-only `themeModeValueAtom`
3. `setThemeModeActionAtom` that:
   - Updates atom value
   - Sets `document.documentElement.dataset.theme`
   - Persists via Tauri command
4. `initializeThemeModeActionAtom` that loads from backend on startup

**Files to modify:**
- `src/common/tauriCommands.ts` - add command enum entries
- `src/App.tsx` - call `initializeThemeModeActionAtom` on startup

---

### Phase 4: Terminal Theme Switching

**Files to modify:**
- `src/terminal/xterm/XtermTerminal.ts`

**Changes:**
1. Make `buildTheme()` read from CSS variables instead of static `theme.ts` values:
   ```typescript
   function getComputedColor(varName: string): string {
     return getComputedStyle(document.documentElement)
       .getPropertyValue(varName).trim()
   }

   function buildTheme(): TerminalTheme {
     return {
       background: getComputedColor('--color-bg-secondary'),
       foreground: getComputedColor('--color-text-primary'),
       // ... etc
     }
   }
   ```

2. Add theme change listener in `XtermTerminal.mount()`:
   - Subscribe to theme mode changes
   - Call `terminal.options.theme = buildTheme()` to update

**Files to modify:**
- `src/common/uiEvents.ts` - add `ThemeModeChanged` event

---

### Phase 5: Settings UI

**Files to modify:**
- `src/components/modals/SettingsModal.tsx`

**Changes:**
Add theme toggle at the top of `renderAppearanceSettings()`:
```tsx
<div>
  <h3 className="text-body font-medium text-slate-200 mb-4">Theme</h3>
  <div className="flex gap-2">
    <button
      onClick={() => setThemeMode('dark')}
      className={themeMode === 'dark' ? 'active-styles' : 'inactive-styles'}
    >
      Dark
    </button>
    <button
      onClick={() => setThemeMode('light')}
      className={themeMode === 'light' ? 'active-styles' : 'inactive-styles'}
    >
      Light
    </button>
  </div>
</div>
```

---

### Phase 6: Static Theme Object Cleanup

**Files to modify:**
- `src/common/theme.ts`

**Option chosen:** Keep `theme.ts` as the source of truth for TypeScript type safety, but components that need runtime theme-aware colors should read from CSS variables. The static values in `theme.ts` remain for:
- Non-color values (spacing, borderRadius, fontSize, etc.)
- Type definitions
- Places where we need the color for computation (like building gradient strings)

For components using theme colors in inline styles, they should migrate to using CSS variables or theme classes.

---

## Critical Files Summary

| File | Action |
|------|--------|
| `src-tauri/src/domains/settings/types.rs` | Add `ThemeMode` enum and field |
| `src-tauri/src/commands/schaltwerk_core.rs` | Add get/set commands |
| `src/styles/theme.css` | Add `[data-theme="light"]` variables |
| `src/store/atoms/themeMode.ts` | Create (new file) |
| `src/store/atoms/themeMode.test.ts` | Create (new file) |
| `src/common/tauriCommands.ts` | Add command entries |
| `src/common/uiEvents.ts` | Add ThemeModeChanged event |
| `src/terminal/xterm/XtermTerminal.ts` | Dynamic theme building |
| `src/components/modals/SettingsModal.tsx` | Add theme toggle UI |
| `src/App.tsx` | Initialize theme on startup |

---

## Testing Checklist
- [ ] Theme persists across app restart
- [ ] Toggle works in Settings > Appearance
- [ ] All UI components respect theme
- [ ] Terminal switches theme correctly
- [ ] Xterm ANSI colors readable in both modes
- [ ] Modals and overlays work in light mode
- [ ] Diff view colors visible in light mode
- [ ] Session cards readable in light mode
