# Repository Context: i18n Implementation

## Project Overview
- **Version**: 0.10.1
- **Stack**: React 19 + Tauri 2 + TypeScript + Jotai
- **Package Manager**: bun 1.2.16

## Key Patterns to Follow

### 1. State Management (Jotai Atoms)

The project uses a consistent pattern across `theme.ts` and `fontSize.ts`:

```typescript
// Pattern Structure:
// 1. Base atom for state
const stateAtom = atom<StateType>(defaultValue)

// 2. Initialization flag (prevents premature persistence)
const initializedAtom = atom(false)

// 3. Read-only derived atoms
export const readOnlyAtom = atom((get) => get(stateAtom).property)

// 4. Action atoms (write-only with side effects)
export const setStateActionAtom = atom(null, async (get, set, newValue) => {
  set(stateAtom, newValue)
  // DOM side effects (CSS variables, etc.)
  // Emit UI event
  if (get(initializedAtom)) {
    await invoke(TauriCommands.Save, { value: newValue })
  }
})

// 5. Initialize action atom
export const initializeStateActionAtom = atom(null, async (_get, set) => {
  const saved = await invoke<StateType>(TauriCommands.Get)
  set(stateAtom, saved ?? defaultValue)
  set(initializedAtom, true)
})
```

### 2. Tauri Commands

All commands defined in `src/common/tauriCommands.ts`:
- Use PascalCase keys → snake_case values
- Never use string literals directly

### 3. UI Events

Type-safe events in `src/common/uiEvents.ts`:
- `emitUiEvent(UiEvent.EventName, payload)`
- `listenUiEvent(UiEvent.EventName, handler)`

### 4. Settings Storage

- macOS: `~/Library/Application Support/com.mariuswichtner.schaltwerk/settings.json`
- Backend: `src-tauri/src/domains/settings/`

## Hardcoded Text Locations

| Component | Approximate Count | Priority |
|-----------|------------------|----------|
| SettingsModal.tsx | 150+ strings | High |
| Keyboard shortcuts (config.ts) | 50+ actions | High |
| Modal dialogs | 50+ strings | Medium |
| Sidebar labels | 30+ strings | Medium |
| Theme presets | 3 labels | Low |

## Testing Requirements

- TDD mandatory: Write failing tests first
- Run `just test` before any commit
- No dead code (knip + `#![deny(dead_code)]`)
- Mock Tauri commands in tests

## Critical Rules

1. **No hardcoded colors/fonts** - Use theme system
2. **No setTimeout/polling** - Event-driven only
3. **No empty catch blocks** - Log all errors
4. **Type-safe everything** - Enums over strings
