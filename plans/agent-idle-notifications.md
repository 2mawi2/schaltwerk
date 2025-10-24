# Agent Idle Attention Notifications Plan

## Goals
- Surface an immediate, high-signal cue when an agent transitions to idle/needs-input and the Schaltwerk window is not frontmost.
- Respect user intent with per-person notification preferences while avoiding noisy repeats for sessions that were already idle.
- Support multiple simultaneously open project windows without clobbering shared dock indicators.

## Current Signals & Constraints
- Backend emits `TerminalAttention` (`needs_attention: true|false`) for the top (agent) terminal only when the idle detector flips state.
- `SessionsContext` reflects this via `session.info.attention_required`; sidebar already shows an “Idle” pill but only when the app is foregrounded.
- Idle detection runs per session worktree; none of the events currently carry project/window identity beyond the session id.
- No existing plumbing for macOS dock badges or system notifications. No persistent user preference governing attention cues.

## Desired UX (first iteration)
- Only act on the *transition* to `needs_attention: true` that happens after the window lost focus or became hidden; we notify per session as it flips, not when *every* session idles.
- Default behaviour: bounce the macOS dock icon (`requestUserAttention('informational')`) and set a dock badge count that reflects the total number of unattended idle sessions across all open projects.
- Optional behaviour (user-controlled): fire a macOS notification (HTML5 Notification API) with the project + session display name; fall back to dock-only if permission denied.
- Clear dock badge and stop notifying when every session that demanded attention has either been reactivated (`needs_attention: false`) or acknowledged by bringing Schaltwerk back to the foreground.

## Notification Preferences
- Extend `SessionPreferences` with an `attention_notification_mode` enum: `'off' | 'dock' | 'system' | 'both'` (default `'dock'`).
- Add `remember_idle_baseline` boolean (default `true`) that gates whether we suppress notifications for sessions that were already idle before losing focus/enabling notifications.
- Surface both controls in Settings → Sessions with clear copy about the dock bounce vs system notification behaviour and a “Test notification” button to validate permissions.
- Persist via existing `Get/SetSessionPreferences` commands; ensure serde defaults keep old settings files valid.

## Multi-window / Multi-project Strategy
- Introduce a lightweight backend singleton (`AttentionStateRegistry`) keyed by window label that stores the current count of unattended idle sessions per window.
- Add a Tauri command `report_attention_snapshot` that accepts `{ window_label, idle_session_ids: string[] }`; backend updates the registry, recomputes the global total, and invokes `app_handle().set_badge(total > 0 ? Some(total_string) : None)`.
- When a window closes/unmounts it reports an empty snapshot so totals stay accurate.
- Each frontend window only notifies for sessions that belong to its own project (which is already true because `SessionsContext` scopes to the active project), but the shared dock badge reflects the union across windows.

## Frontend Flow
1. Build a `useWindowVisibility()` hook:
   - Listen to `@tauri-apps/api/window` events (`tauri://focus`, `tauri://blur`, `tauri://visible-change`) and `document.visibilitychange`.
   - Expose `isForeground` (focused & visible) and `lastFocusLostAt` timestamps.
2. Create `useAttentionNotifications()` hook mounted once inside `AppContent` after contexts are ready.
   - Track previous `attention_required` state per session to detect rising/falling edges.
   - Maintain `alreadyIdleBeforeBlur` set captured when focus is lost (if `remember_idle_baseline` true) to suppress legacy idles.
   - On rising edge while `isForeground === false`, evaluate user preference:
     - `'dock'` or `'both'`: call `requestUserAttention('informational')`.
     - `'system'` or `'both'`: ensure Notification permission (prompt once on first need), show notification body (`"{sessionDisplayName} is ready for input"`). Record refusal to avoid repeated prompts.
   - Update a `Set` of sessions currently needing attention and push snapshot to backend via `report_attention_snapshot`.
   - Clear per-session notification bookkeeping when `needs_attention` flips to false or the user focuses the window (which implies they saw the dock bounce).
3. Add a small badge counter in the sidebar app chrome (optional) driven by the same `Set` to mirror dock count while window hidden.

## Backend Additions
- Extend `SessionPreferences` struct and its serde defaults with the new fields.
- Implement `AttentionStateRegistry` in `src-tauri/src/domains/settings/service.rs` or a new domain (e.g., `domains/attention`). Provide thread-safe `update_snapshot(window_label, session_ids)` and `clear_for_window(window_label)` helpers.
- Add new Tauri command in `commands/settings.rs` (or dedicated module) that resolves the current `AppHandle`, updates the registry, and calls `set_badge` / `remove_badge`.
- Unit tests covering:
  - Default deserialization of `attention_notification_mode` & `remember_idle_baseline`.
  - Registry correctly sums totals, removes windows, and clamps badge label at a reasonable string (e.g., "9+" past 9).

## Frontend Work Items
- Update `useSettings` & related tests to read/write the new preference fields with sensible defaults.
- Expand `SettingsModal` Session section with radio buttons (Dock bounce, System notification, Both, Off) and the baseline toggle.
- Implement the new hooks plus a `NotificationBridge` module to abstract `requestUserAttention`, `setBadgeLabel`, and `Notification` permission checks (facilitates Vitest mocks).
- Add Vitest coverage:
  - Rising edge while hidden triggers bridge call(s); visible windows do not.
  - Sessions already idle before blur do not trigger when `remember_idle_baseline` enabled; disabling the option re-enables immediate alerts.
  - Hook sends aggregated snapshot to backend command whenever the idle set changes.

## Open Questions / Risks
- Verify `Window.set_badge` availability in our current Tauri version; if unsupported, fall back to `appWindow.setBadgeLabel` polyfill or omit badge and document limitation.
- Decide on throttle/debounce for repeated `requestUserAttention` calls (macOS ignores duplicates, but we may still guard with a cooldown).
- Ensure Notification permission prompts behave gracefully when multiple windows attempt to request simultaneously (we can centralize prompt once per profile).
- Confirm session IDs are globally unique; if not, augment backend snapshot payload with project path to disambiguate before summing.

## Next Steps
- Prototype `useWindowVisibility` + detection hook behind a feature flag to validate idle edge cases before wiring preference UI, ensuring the approach gracefully degrades on non-macOS platforms (document-based fallback until Linux support lands).
- After implementation, run `just test` (full suite) and manual smoke-test: start agent, hide window, wait for idle transition, confirm dock bounce + badge + optional notification, clear on focus.
