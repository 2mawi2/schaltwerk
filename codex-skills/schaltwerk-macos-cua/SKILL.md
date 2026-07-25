---
name: schaltwerk-macos-cua
description: Build and manually test the real Schaltwerk macOS app with Codex Computer Use against an isolated disposable Git repository and app-data directory. Use for agent-driven UI testing, visual regression checks, or end-to-end verification of local Schaltwerk changes on a Mac.
---

# Schaltwerk macOS Computer Use

Run Schaltwerk natively while keeping the user's projects and normal app state out of scope.

## Prepare

The host must have working, authenticated real Codex and Pi CLIs. The harness checks
the current `PATH`, the Codex binaries bundled with ChatGPT and Codex, or the explicit
`SCHALTWERK_CUA_CODEX_BIN` and `SCHALTWERK_CUA_PI_BIN` overrides. It fails before
launching Schaltwerk if either binary is broken or its authentication is missing.

From the Schaltwerk repository root, run:

```bash
bun run cua:prepare
bun run cua:verify-isolation
```

`cua:prepare` builds the release `.app`, resets `logs/cua/macos-runtime`, creates a disposable Git fixture, and launches Schaltwerk with an isolated home and config database. It pins agent launch to the validated real Codex and Pi binaries. Codex authentication is linked into its isolated home; Pi authentication and model configuration are copied into isolated private files and removed on stop. The harness pre-trusts only the disposable fixture root for Codex. Use `bun run cua:prepare -- --no-build` only when the current app bundle already represents the source under test.

If a harness instance is running, stop it before preparing again:

```bash
bun run cua:stop
```

Never stop another Schaltwerk process. The harness validates the recorded executable before signaling its owned PID.

## Drive the UI

Use the `computer-use` skill and its `node_repl` workflow. Target the full app path `src-tauri/target/release/bundle/macos/schaltwerk.app`; the bundle identifier is ambiguous when `/Applications/Schaltwerk.app` is also installed.

1. Observe the full app state before acting.
2. Prefer accessibility element indices for clicks and text entry.
3. Re-observe after every action that changes the UI.
4. Use screenshots when the WebView accessibility tree is incomplete.
5. Exercise the user-visible flow affected by the change, including success and practical failure states.
6. Keep all created sessions, branches, and file edits inside the disposable fixture.

Do not use shell commands to simulate UI interaction. Use them only to inspect harness state and verify side effects.

For the real-Codex end-to-end smoke flow:

1. Start an agent with a unique name and a prompt that creates a uniquely named
   file with exact contents.
2. Select Codex and confirm the form shows a currently supported model.
3. Select **Skip permissions** because the repository and app state are disposable.
4. Start and select the session, then observe the terminal until Codex reports
   completion.
5. Confirm the file appears in Schaltwerk's Changes panel.

No Codex project-trust prompt should appear. Treat one as a harness failure: stop
the run, prepare fresh state, and inspect
`logs/cua/macos-runtime/codex-home/config.toml` before continuing.

For the real-Pi flow, select Pi, select **Skip permissions** so project-local Pi
resources are approved inside the disposable repository, and use a unique prompt
and output file just like the Codex smoke flow. Confirm the prompt starts
automatically, the file appears in Changes, and restarting the terminal resumes the
same Pi session without replaying the initial prompt.

## Verify

Check the process, isolation, logs, and Git effects:

```bash
bun run cua:status
bun run cua:verify-isolation
bun run cua:fixture-status
bun run cua:logs
```

Verify exact file contents in the disposable worktree as well as the UI result.
Treat panics, frontend errors, unexpected normal-state file access, and unintended
Git changes as failures. A Codex model-discovery fallback warning is acceptable
only when the log also identifies the validated CLI version and the selected
supported model completes the smoke task. Capture screenshots from Computer Use
for visual findings.

Always stop the owned test app when finished. Stopping also removes the temporary
Codex authentication link and the isolated Pi authentication/configuration copies:

```bash
bun run cua:stop
```

Report the exact flows exercised, observed results, isolation result, validation commands, and any untested boundary.
