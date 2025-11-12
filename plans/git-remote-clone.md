# Plan: Git Remote Project Onboarding

## Goal
Enable users to create a new Schaltwerk project by cloning any public/private Git repository via HTTPS or SSH URL directly from the home screen.

## UX Integration
- **Entry Point**: add "Clone from Git" tile beside existing project/session actions on the home screen, reusing the shared tile component for consistent sizing + theme.
- **Modal/Wizard**
  - Step 1 collects the remote URL with live validation for HTTPS (`https://host/org/repo(.git)`) and SSH (`git@host:org/repo(.git)` or `ssh://`). Show scheme-specific helper text (SSH hint about ssh-agent; HTTPS note about credential manager/personal tokens).
  - Step 2 lets the user choose the destination folder using the existing directory picker component; default to last used parent path stored in settings + atom.
  - Step 3 is a confirmation summary (repo name, target path, default branch once detected) with a checkbox to auto-open project after clone.
- **Progress UX**: while cloning, disable modal inputs, show progress text fed by backend events, and allow cancellation (soft cancel sends signal to stop process if supported, otherwise we surface that cancellation might leave partial folder).

## Data & State
- Frontend atoms store: `cloneModalState` (open/close + step), `cloneForm` (url, parentDir, targetName, autoOpen flag), and `lastCloneParentDir` persisted via existing settings bridge.
- Maintain a recent remotes list (max 5, sans credentials) for quick selection; store in settings after sanitizing secret tokens.
- Validation ensures destination directory does not exist or is empty; otherwise prompt user to confirm overwrite.

## Backend Integration
- Add `domains/git/clone.rs` with `GitCloner::clone_remote` encapsulating:
  1. Normalizing/sanitizing the remote URL for logs (remove password/query parts).
  2. Resolving destination path (create parent dirs as needed, ensure empty target) and running `git clone --origin origin --progress <url> <dest>`.
  3. Emitting progress via existing event system (new `SchaltEvent.CloneProgress`).
  4. Returning metadata: repo name, default branch, destination path.
- Expose new Tauri command `SchaltwerkCoreCloneProject` wired through `src/common/tauriCommands.ts`, calling backend service and then registering the project on success.

## Security & Safety
- Never log full URLs containing credentials; mask everything after `@` or `:` in SSH user@host segments and strip password/token parts in HTTPS.
- Reject URLs embedding passwords or query parameters that look like secrets unless user explicitly confirms (initial scope: warn and block).
- Only proceed when destination folder is empty; otherwise require user confirmation in UI before invoking backend.

## Testing Strategy (TDD)
1. **Frontend**: add Vitest tests for the new clone modal store + component behavior (validation rules, summary rendering, calling Tauri command with sanitized payload, handling progress events).
2. **Backend**: add Rust tests for `GitCloner` (URL sanitization, command building, error surfaces). Use command mocking harness to avoid real network IO.
3. **Integration**: extend existing session/project creation tests to ensure successful clone triggers project registration + navigation when `autoOpen` is true.
4. Tests run first (RED) before implementing logic; iterate until all pass, then run `bun run test` for the full suite.

## Implementation Steps
1. Scaffold frontend modal UI + atoms (initially failing tests define contract).
2. Implement backend clone service + Tauri command (driven by Rust tests).
3. Wire progress events + navigation, add recent remote persistence.
4. Polish UX copy, validate edge cases, and ensure lint/tests stay green.
