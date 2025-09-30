# Agent Setup

Configure each agent from **Settings → Agent Configuration** before you launch sessions. Open Settings by clicking the gear icon in the top bar.

- Settings are saved locally in `~/Library/Application Support/schaltwerk/settings.json` (plain JSON). Keep this file protected if you store API keys.
- Project-specific options (setup scripts, project env vars, run scripts) are stored per repository in `~/Library/Application Support/schaltwerk/<project>/database.db`.
- Changes only apply after you click **Save** in the bottom-right corner of the Settings modal.

## Choose the Agent Binary
- Select the agent tab (Claude, Codex, OpenCode, Gemini).
- Pick a detected binary or paste an absolute path if you maintain your own build.
- Schaltwerk shows the installation method and version next to every option so you can confirm you are pointing at the right executable.
- Examples:
  - Claude Code CLI installed via Homebrew: `/opt/homebrew/bin/claude`
  - Codex CLI installed via npm: `~/.npm-global/bin/codex`
  - Google Gemini CLI: `/usr/local/bin/gcloud`

## Add Custom CLI Arguments
- Use the **CLI Arguments** field to append extra flags to the launch command.
- Arguments are parsed with shell-style quoting. For example:
  - `--profile work`
  - `--model gpt-4`
  - `--sandbox danger-full-access`
- Codex launches are normalized automatically (single-dash long flags are fixed and profiles come before `--model`).
- CLI arguments are appended every time the top terminal starts, including restarts triggered from the session toolbar.

## Set Agent Environment Variables
- Add key/value pairs that should be present in the agent terminal (API keys, profile names, feature flags).
- Environment variables are scoped to the agent type—Claude settings do not leak into Codex, and so on.
- When an agent starts, Schaltwerk merges these variables with the project-level variables described below.
- Variables are stored unencrypted alongside your settings; rotate keys if the machine is shared.
- Use the **Edit variables** button to toggle a table view for larger sets of keys without retyping them.

## Project Defaults
Open **Settings → Projects** to configure shared defaults for every session:

### Worktree Setup Script
- Runs once when Schaltwerk creates a new worktree.
- Receives `$WORKTREE_PATH`, `$REPO_PATH`, `$SESSION_NAME`, and `$BRANCH_NAME` environment variables.
- Typical uses: copy `.env` files, install dependencies, seed databases, or create directories.
- Execution happens in the session’s top terminal before the agent process launches. A marker file at `.schaltwerk/setup.done` prevents the script from running again inside the same worktree.
- The setup script is optional; leave it empty if your project does not require bootstrapping.

### Project Environment Variables
- Added to every agent launch after the agent-specific variables.
- Useful for tokens and configuration shared by all agents working in the repository.
- Combine project variables with agent-specific ones to avoid duplicating credentials across tabs.

### Run Script (⌘E)
- Define the command that Run Mode executes (for example `npm run dev`).
- Optional working directory and environment variables let you tailor the run terminal to your project.
- The run terminal streams output in the bottom pane and shows a status header while the command is active.
- The **Run/Stop** button in the bottom toolbar mirrors the `⌘E` shortcut and displays the exit status when the process finishes.
- Run Mode uses the same environment variables as the project configuration plus anything you add under **Run Script**.

## Recommended Setup Flow
1. Fill in project environment variables and the setup script so every session starts with the same baseline.
2. Configure each agent’s binary, CLI arguments, and secrets in **Agent Configuration**.
3. Launch a test session and verify that the top terminal shows the setup script output followed by your agent’s startup log.
4. Use Run Mode (⌘E) to confirm the project run script behaves as expected.
