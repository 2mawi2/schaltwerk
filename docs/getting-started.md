# Getting Started

Follow these steps to install Schaltwerk, approve the first launch, and spin up your initial agent session.

## Requirements
- macOS (Apple Silicon or Intel)
- Git available in your shell
- Homebrew for the quickest installation path

## Install the App
```bash
# Add the tap once
brew tap 2mawi2/tap https://github.com/2mawi2/homebrew-tap

# Install Schaltwerk
brew install --cask schaltwerk

# Launch the app
open -a Schaltwerk
```

Prefer manual installation? Download the latest `.tar.gz` from the Schaltwerk releases page, extract it, and drag `Schaltwerk.app` into `/Applications`.

## Approve the First Launch
Because the app is ad-hoc signed, macOS Gatekeeper will block the initial run:
1. Try launching Schaltwerk once (`schaltwerk` in a terminal or double-click the app).
2. Open **System Settings → Privacy & Security**.
3. Click **Open Anyway** beside the Schaltwerk warning and confirm.

After approving it once, Schaltwerk will launch normally on future runs.

## Open Your Repository

On launch you land on the **Home** screen:

1. Click **Open Repository** and pick an existing Git project. Schaltwerk verifies the folder before attaching it.
2. The project is added to **Recent Projects** so you can reopen it later with one click.
3. Alternatively, **New Project** creates an empty Git repository in the directory you choose.

When a project is active the top bar shows its name, branch indicator, and a gear button that opens Settings.

## First Session Checklist
1. Press `⌘1` or click **orchestrator** in the sidebar to open the control panel for your repo.
2. Write a spec describing what you want an agent to build (use `⌘⇧N` or the **Create Spec** button in the sidebar footer).
3. Convert the spec into a running session (`⌘N` or **Start Agent**). Schaltwerk spins up a git worktree, branch, and two terminals.
4. The top terminal launches your configured agent automatically after any setup script finishes; the bottom terminal is ready for manual commands.
5. Run tests locally before marking the session as reviewed (`⌘R`).

## Development Setup (Optional)
If you plan to build or extend Schaltwerk from source:
```bash
git clone https://github.com/2mawi2/schaltwerk.git
cd schaltwerk
npm install
npm run tauri:dev
```
Use `npm run test` to run the full validation suite (TypeScript linting, `cargo clippy`, `cargo test`, and a release build check).

## Where Schaltwerk Stores Data
- App settings (agent binaries, CLI args, personal defaults) live in `~/Library/Application Support/schaltwerk/settings.json`.
- Project state (sessions, specs, project-level environment variables) lives in `~/Library/Application Support/schaltwerk/<project-name>/database.db`.
- Git worktrees are created under `<repo>/.schaltwerk/worktrees/<session-name>/` and are removed when you cancel the session.

## Database Performance Tuning
- The bundled SQLite database now runs with Write-Ahead Logging (`journal_mode=WAL`) and `synchronous=NORMAL` for better concurrent read/write throughput.
- A small connection pool (default size `4`) fans out read-heavy UI work; override with `SCHALTWERK_DB_POOL_SIZE=<N>` when you need to stress-test higher parallelism.
- Listing queries hydrate only the columns they need for the UI and fetch large text blobs (spec content, prompts) on demand, keeping sidebar refreshes responsive even with hundreds of sessions.
