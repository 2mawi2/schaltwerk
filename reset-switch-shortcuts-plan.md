# Plan: Configurable Shortcuts for Reset & Switch Model

## Objective
Deliver configurable keyboard shortcuts that trigger the existing **Reset** and **Switch Model** actions for any running/reviewed session and for the orchestrator, ensuring the shortcuts surface everywhere the shortcut catalogue is shown (settings UI, cheat sheet, tooltips) and mirror the current button logic/callbacks.

## Default Shortcut Proposal (subject to validation)
- **Reset selection / orchestrator:** `Mod+Alt+R` (⌘⌥R on macOS). Communicates "reset" while avoiding conflicts with common macOS/global bindings used inside Tauri webviews.
- **Open switch-model modal:** `Mod+Alt+M` (⌘⌥M). Mnemonic for "model"; low clash risk. Will confirm no overlap with existing app shortcuts before finalizing.

## Work Breakdown
1. **Discovery & Safeguards**
   - Inspect existing keyboard shortcut infrastructure (`src/config/keyboardShortcuts.ts`, `useKeyboardShortcuts.ts`, `KEYBOARD_SHORTCUT_SECTIONS`).
   - Map button behavior for Reset/Switch Model in sidebar/orchestrator components to understand required guards (session state checks, modal gating, orchestrator handling).
   - Verify no current default shortcuts use the proposed chords; adjust if conflicts surface.

2. **TDD: Unit & Integration Tests (Red Phase)**
   - Extend keyboard shortcut hook tests to expect the new actions, including ensure they do not fire when callbacks missing or selection invalid (spec session).
   - Add/render-level tests around sidebar/orchestrator controls to assert that dispatching the shortcut triggers the same side effects as clicking the buttons (reset command execution, switch-model modal open).
   - Cover metadata exposure via snapshot or explicit assertions so the settings UI lists the shortcuts.

3. **Shortcut Configuration Wiring (Green Phase A)**
   - Add new action enums/entries in the shortcut configuration module with defaults and descriptions.
   - Update persistence/normalization helpers so custom bindings round-trip correctly.
   - Place the actions in the correct keyboard shortcut section (likely "Session Management") with label text matching UI terminology.

4. **Hook & UI Integration (Green Phase B)**
   - Expand `useKeyboardShortcuts` (or equivalent dispatcher) to accept `onResetSelection` and `onOpenSwitchModel` handlers and invoke them when the shortcuts match, respecting existing guard rails (e.g., disabled states, modal focus locks).
   - In sidebar/orchestrator components, connect those handlers to the existing button logic: ensure they target the currently selected session, skip specs, and reuse orchestrator-specific flows.
   - Update button tooltips or shortcut badges to display the configured shortcut (fall back to defaults if unchanged).

5. **Settings & Documentation Sync**
   - Ensure `SettingsModal` renders the new entries; tweak copy/explanations so users understand scope (running/reviewed sessions + orchestrator).
   - Update any in-app cheat sheet/help surfaces that enumerate shortcuts so the new actions appear with accurate labels and defaults.

6. **Validation & Regression Checks**
   - Run `just test` per project guidelines; resolve TypeScript, lint, and Rust checks.
   - Spot-check manual behavior (if time) to confirm no interference with existing shortcuts/modal focus handling.

## Risks & Mitigations
- **Shortcut collisions:** Mitigate by auditing existing bindings before finalizing defaults and documenting rationale in code comments where necessary.
- **State edge cases:** Ensure orchestrator, running, and reviewed sessions share the same shortcut pathway while specs remain no-op; add targeted tests to cover those branches.
- **Settings drift:** Leverage centralized metadata so UI surfaces stay in sync; avoid hand-maintaining multiple lists.
