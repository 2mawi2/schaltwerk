# Using Schaltwerk

This guide walks through the day-to-day workflow of running agents, reviewing their output, and keeping your repository clean.

## Learn the Layout
- **Top bar**: tabs for each open project, the gear icon for Settings, and an **Open** button that launches the active worktree in Finder or your editor.
- **Sidebar**: the orchestrator entry, session filters (All/Specs/Running/Reviewed), and quick actions for starting agents or creating specs.
- **Center**: terminals and diff/review panels grouped per session.

## Create a Spec
1. Select **orchestrator** (`⌘1`) so you are working on the main repo branch.
2. Click **Create Spec** in the sidebar footer or press `⌘⇧N`.
3. Fill out the markdown prompt with requirements, test expectations, and acceptance criteria.
4. Specs stay in the orchestrator until you promote them; you can edit or duplicate them anytime.

## Start a Session
1. Highlight the spec in the sidebar and click **Start Agent** (or press `⌘N`).
2. Schaltwerk creates a new git worktree in `.schaltwerk/worktrees/<session-name>/` and checks out a dedicated branch with the project’s branch prefix.
3. The new session moves to the **Running** filter and opens two terminals the first time you view it.
4. Any configured worktree setup script runs once; when it finishes, the top terminal launches your agent using the saved binary, CLI arguments, and environment variables.

## Run Your Agent
- The top terminal streams the agent process that Schaltwerk starts automatically. Use the **Restart** action if you need to pick up a new prompt or configuration change.
- The bottom terminal is a regular shell rooted in the session worktree—use it for tests, formatting, and helper scripts.
- Configure Run Mode in Settings to map `⌘E` to a common command (for example `npm run test`). The bottom terminal shows a status header while the command runs.

## Review the Work
- Switch between sessions with `⌘1–9` or cycle with `⌘↑/⌘↓`; terminals stay alive even when you change focus.
- Inspect diffs inside the right panel, leave notes in the spec, or send instructions through the agent terminal.
- Run `npm run test` (or your project suite) in the bottom terminal or via Run Mode before moving on.

## Mark as Reviewed
1. When the changes pass review, press `⌘R` or click the checkmark action to move the session to **Reviewed**.
2. Use the session header actions to create a GitHub pull request, merge, or export the branch. You can also click **Open** in the top bar to work in your editor.

## Convert Back to a Spec
Need to pause development but keep notes? Use `⌘S` to convert a running session back into a spec. The worktree is removed and the markdown remains for future use.

## Merge and Clean Up
- After merging or cherry-picking the reviewed branch, click **Cancel Session** (⌘D) to remove the worktree and close the terminals.
- Cancelled sessions disappear from the sidebar; you can always recreate them from the spec or Git history if needed.
- Schaltwerk never cancels sessions automatically, so it is safe to keep a branch around while you validate changes.

## Tips for Smooth Sessions
- Keep specs focused so agents work on small, testable changes.
- Use separate sessions for competing implementations and pick the best result.
- The orchestrator can orchestrate multiple agents in parallel while you monitor progress.
- Visit [Agent Setup](./agent-setup.md) whenever you need to tweak binaries, environment variables, or the project setup script.
