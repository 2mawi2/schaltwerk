# Schaltwerk Agent Guide

`AGENTS.md` links to this file. Keep it concise and limited to repository-specific
information that is easy to miss or expensive to rediscover.

## Project

Schaltwerk is a Tauri desktop app for running AI coding agents in isolated Git
worktrees. The frontend is React/TypeScript; the backend is Rust. macOS and
Windows are supported, and Linux builds are beta. WSL is not supported.

Use `bun` for JavaScript commands because the repository is pinned to Bun.

## Working in the Repository

- Work in the checkout or worktree provided for the task. Do not search for or
  switch to another copy of the repository.
- Inspect `git status` before editing. Preserve existing user changes and stage
  only files that belong to the task.
- Keep changes focused. Follow existing patterns before introducing a new
  abstraction, state container, command, or service.
- Business logic belongs in the appropriate module under
  `src-tauri/src/domains/`. Consolidate overlapping legacy logic instead of
  creating another implementation.

## Architecture Map

- `src/App.tsx`: frontend orchestration and agent/session startup.
- `src/store/atoms/`: shared Jotai application state, including selection.
- `src/components/terminal/`: terminal panes, tabs, and xterm integration.
- `src/common/tauriCommands.ts`: typed frontend registry of Tauri commands.
- `src/common/eventSystem.ts`: typed frontend event helpers.
- `src-tauri/src/commands/`: thin Tauri command boundary.
- `src-tauri/src/domains/`: backend business domains.
- `src-tauri/src/domains/sessions/`: session and worktree lifecycle.
- `src-tauri/src/domains/terminal/`: PTY lifecycle.
- `src-tauri/src/domains/git/`: Git and worktree operations.
- `src-tauri/src/events.rs`: backend event definitions and emission.
- `src-tauri/src/mcp_api.rs`: project-scoped REST API used by the MCP server.
- `mcp-server/`: external MCP server package.
- `docs-site/`: Mintlify product documentation.
- `codex-skills/`: repository-owned manual test workflows.

## Invariants

### Sessions, terminals, and data

- A running session owns an isolated branch/worktree. Specs do not have a
  worktree until started; the orchestrator intentionally operates on the main
  checkout.
- Never cancel sessions automatically on project switch, close, or restart.
  Destructive or bulk lifecycle actions require explicit user confirmation.
- Terminal creation is lazy. The top pane is the active agent terminal; bottom
  tabs are user shells.
- Terminal IDs are derived only from the sanitized session name. Project
  switches rebind existing IDs; do not make terminal caches project-scoped.
- Project data is stored in the project `sessions.db`; application settings are
  stored in the OS app-data directory.
- SQLite uses WAL, `synchronous=NORMAL`, and a connection pool. Preserve that
  model; pool size is configurable through `SCHALTWERK_DB_POOL_SIZE`.

### State and communication

- Shared frontend state belongs in Jotai atoms under `src/store/atoms/`.
  Component-local state can remain in React state.
- Use `TauriCommands` from `src/common/tauriCommands.ts`; do not invoke backend
  commands with string literals.
- Use the typed helpers and `SchaltEvent` definitions in
  `src/common/eventSystem.ts` and `src-tauri/src/events.rs`; do not introduce
  ad-hoc event names.
- Keep one source of truth for lifecycle or initialization state. Check for an
  existing atom/module before adding another cache, `Set`, or `Map`.
- MCP operations go through the REST API in `src-tauri/src/mcp_api.rs`, never
  through direct database access.

### UI

- Use theme tokens from `src/common/theme.ts` and `src/styles/themes/`; do not
  hardcode colors.
- Use semantic typography from `src/common/typography.ts` or theme font
  variables; do not hardcode UI font sizes or font families.
- Keep all themes working when changing UI. Update keyboard-shortcut
  documentation when adding or changing a shortcut.

### Reliability

- Prefer lifecycle events, callbacks, and awaited operations over sleeps,
  polling, or timing-based synchronization. Operational command timeouts are
  fine when they only prevent a manual workflow from hanging.
- Do not use empty catch blocks. Return or log actionable context without
  exposing secrets.
- Use the project logger (`src/utils/logger.ts`) instead of new console logging.
- Keep `#![deny(dead_code)]`; remove unused Rust code rather than suppressing
  the lint.
- Comments should explain non-obvious intent or constraints, not narrate the
  code or the edit history.

## Implementation and Verification

- Understand the affected call path and existing tests before changing it.
- Add or update tests when they provide regression value for behavior, logic,
  or edge cases. The required outcome is a focused implementation with
  meaningful verification.
- During iteration, run the narrowest relevant tests. Before handing off a
  code, runtime, build, or configuration change, run the full suite:

```bash
just test
```

`just test` covers TypeScript lint/type-checking, MCP checks, frontend tests,
Rust clippy and dependency checks, `knip`, Rust tests, and a Rust build.
Documentation-only changes need `git diff --check` and any relevant
documentation validation, not the full application suite.

Useful focused commands:

```bash
bun run lint
bun run lint:ts
bun run test:frontend
bun run lint:rust
bun run test:rust
bun run lint:mcp
bun run test:mcp
bun run tauri:dev
bun run tauri:build
```

- Do not skip or weaken tests to make a change pass.
- When a check fails, determine whether the change caused it. Fix failures in
  scope; report confirmed pre-existing or unrelated failures rather than
  silently expanding the task.
- Report the commands run, the behavior exercised, and any boundary that was
  not verified.

## Manual App Self-Testing

Automated tests do not replace exercising changed user-visible behavior. UI
changes and frontend/Tauri integration changes should be tested in the real app
before completion.

On macOS, follow `codex-skills/schaltwerk-macos-cua/SKILL.md`:

```bash
bun run cua:prepare
bun run cua:verify-isolation
# Drive the changed flow with Computer Use.
bun run cua:fixture-status
bun run cua:logs
bun run cua:stop
```

- Test the changed flow, not only app startup. Include a relevant error, empty,
  loading, persistence, or restart state when the change affects one.
- Confirm visible state and important filesystem/log side effects.
- Keep all test sessions, branches, app data, and file edits inside the
  disposable fixture. Never use the installed app or the user's real projects.
- Always stop the owned harness when finished; this also removes its temporary
  Codex authentication link.
- If the host, Computer Use, authentication, or another dependency is
  unavailable, run the remaining checks and state the exact untested boundary.

On Linux, follow `codex-skills/schaltwerk-linux-cua/SKILL.md` and use the
isolated Docker harness.

## Logs and Documentation

- Run with `RUST_LOG=schaltwerk=debug bun run tauri:dev` for application debug
  logging.
- macOS logs are under
  `~/Library/Application Support/schaltwerk/logs/`; frontend entries include a
  `[Frontend]` prefix.
- Never log credentials, tokens, prompts, or other sensitive user data.
- Product documentation belongs in `docs-site/`.
- If the user requests a Schaltwerk technical spec, use the Schaltwerk MCP spec
  workflow. Put explicitly requested Markdown plan files in `plans/`.
- Release commands (`just release`, `just release minor`, `just release major`)
  mutate versions, commits, tags, and remotes; run them only when the user
  explicitly requests a release.
