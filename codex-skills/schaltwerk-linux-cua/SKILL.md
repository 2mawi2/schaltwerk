---
name: schaltwerk-linux-cua
description: Use when the user wants agent-driven UI testing of Schaltwerk inside an isolated Linux container. This skill builds the local Docker image, syncs the current repo into the container, launches the Linux Schaltwerk build under Xvfb/openbox, exposes a Cua computer-server, and runs OpenAI computer-use tests through scripts/cua/schaltwerk-cua.js.
---

# Schaltwerk Linux CUA

Use this skill from the Schaltwerk repo root when the user wants Schaltwerk tested through OpenAI computer use without controlling the host macOS desktop.

## Preconditions

- Docker or OrbStack is running.
- Work from the Schaltwerk repo root so the source mount points at the current checkout.
- `OPENAI_API_KEY` is only required for autonomous `cua:test` runs. Manual observe/act testing does not need it.

## Default workflow

1. Prepare the containerized Linux desktop:
   `bun run cua:container:prepare`
2. Verify the app, fixture repository, and Cua backend:
   `bun run cua:container:status`
   `bun run cua:container:fixture-status`
   `bun run cua:container:probe`
3. Capture and inspect the current desktop:
   `bun run cua:container:observe`
   Read the returned screenshot path before deciding the next action.
4. Interact through the Cua backend, then observe again:
   `bun run cua:container:click -- --x 100 --y 200`
   `bun run cua:container:type -- --text "Text to enter"`
   `bun run cua:container:press -- --keys CTRL+ENTER`
   Other commands are `cua:double-click`, `cua:drag`, `cua:move`, and `cua:scroll`.
5. Check the app log and fixture state after meaningful transitions:
   `bun run cua:container:logs`
   `bun run cua:container:fixture-status`
6. Optionally run an autonomous computer-use test prompt:
   `bun run cua:container:test -- --no-prepare --prompt "Open Schaltwerk, exercise the target flow, and report findings."`
7. Inspect artifacts under `logs/cua/` for backend probes, screenshots, action traces, status snapshots, and raw Responses API payloads.
8. Shut the container down when finished:
   `bun run cua:container:stop`

## Notes

- The container exposes Schaltwerk over noVNC at `http://127.0.0.1:6081/vnc.html?autoconnect=1`.
- The container also exposes a Cua-compatible `computer-server` on `http://127.0.0.1:8002`.
- Schaltwerk starts against a fresh disposable Git repository under `/home/schaltwerk/runtime/fixture-project`.
- Common agent executables are deterministic local stubs so running-session and terminal flows can be tested without external credentials.
- `bun run cua:container:smoke` reuses the current container unless `--prepare true` is passed.
- The default desktop backend is `cua`; pass `--backend desktopctl` to fall back to the original direct Docker control path.
- `bun run cua:container:test` runs `prepare` automatically unless `--no-prepare` is passed.
- For repeat runs after code changes, rerun `bun run cua:container:prepare` so the container rebuilds the Linux binary from the current checkout.
- Keep prompts explicit about the flow to test and the expected assertions. The runner already tells the model to stay inside the local Schaltwerk desktop.
