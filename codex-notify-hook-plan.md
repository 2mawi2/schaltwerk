# Codex Notify Hook – Investigation & Validation Plan

## What We Found
- **Settings toggle already exists.** `SettingsModal.tsx` exposes the Codex notify checkbox backed by `useSettings.saveCodexFeatures()` which calls the `set_codex_features` Tauri command.
- **Backend wiring is complete.** `src-tauri/src/commands/settings.rs:set_codex_features` writes the helper script, updates `~/.codex/config.toml` via `codex_config::enable_notify`, and persists the feature flag in `SettingsService`.
- **Helper script + env injection shipped.** `helper_script_content()` matches the documentation: it shells out to `curl` with session/project/token headers, and `agent_launcher::launch_in_terminal` injects the required `SCHALTWERK_*` env vars (port, session, project, token) for Codex terminals once the toggle is on.
- **Webhook + idle override implemented.** `start_webhook_server` exposes `/webhook/codex-notify`, validates the token, records activity through `SessionService::record_codex_turn_completion`, emits the `CodexTurnComplete` event, and `start_terminal_monitoring` skips idle heuristics whenever a Codex session has an active token.
- **Frontend reacts to the event.** `SessionsContext` listens for `CodexTurnComplete` and immediately marks the session active, replacing the slower terminal-idle heuristic.

## Gaps / Risks To Verify
1. **Conflict path UX:** If `~/.codex/config.toml` already defines `notify`, enabling returns a raw error string. We should confirm the UI surfaces this gracefully and possibly add copy guidance.
2. **Helper script idempotency:** Ensure updates to `helper_script_content()` keep permissions/existing scripts intact and the stored `helper_path` stays current after toggling on/off.
3. **Token lifecycle:** Verify tokens clear when terminals close, so stale tokens do not block re-connecting sessions.
4. **Multi-session Codex usage:** Confirm simultaneous Codex terminals (top/bottom or multiple sessions) each receive distinct tokens and the feature still bypasses idle polling correctly.
5. **Tests coverage check:** Existing unit tests cover config enable/disable and settings plumbing; we should audit for missing integration coverage (e.g., webhook handler success path).

## Validation Plan (No Code Changes Yet)
1. **Manual toggle dry run** (staged HOME): enable/disable via `set_codex_features`, inspect generated helper script and TOML edits, confirm conflict error message.
2. **Webhook simulation**: call `/webhook/codex-notify` with valid headers/payload from a test harness to ensure session activity updates and UI event fires.
3. **Token lifecycle audit**: run Codex session launch/close flow in tests or via instrumented logging to ensure `generate_session_token`/`clear_session_token` behave as expected.
4. **Document findings**: summarize validation results and recommend any follow-up fixes (only then decide if implementation work is required).

*Awaiting review before proceeding to any implementation or test authoring.*
