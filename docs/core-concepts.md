# Core Concepts

Schaltwerk revolves around isolated git worktrees and the lifecycle of each AI-driven session. These concepts are the backbone of the app.

## Sessions
- Every running session is a dedicated git worktree branching from your repository.
- Two terminals come with each session so agents and humans can work side-by-side.
- You can switch between sessions instantly—terminals stay alive in the background.
- Sessions appear in the left sidebar under **Agents**. Use the tabs at the top of the list (All, Specs, Running, Reviewed) to filter what you see.

## Specs
- Specs are markdown planning documents that live in the orchestrator.
- They capture the desired outcome before any code is written.
- When you start a spec session, Schaltwerk turns the document into the agent’s first prompt and spins up a worktree.
- Specs live in the same sidebar list as running sessions and carry an amber badge until you start them.

## Orchestrator
- The orchestrator runs directly on your main branch and never creates a worktree.
- Use it to draft specs, launch multiple sessions, and coordinate reviews.
- It also powers automation through the MCP REST API.
- Access it from the **Repository (Orchestrator)** section at the top of the sidebar or with `⌘1`.
- The orchestrator has its own agent terminal on top and your shell below, just like regular sessions.

## Session States
1. **Spec** – Drafting the work. No worktree yet.
2. **Running** – The session owns a worktree and active terminals.
3. **Reviewed** – The worktree is ready for merge or further manual edits.

Transitions are explicit: start a spec to enter Running, mark as reviewed when tests pass, or convert back to a spec if you want to pause work but keep the notes.

## Terminals
- Schaltwerk spawns PTY terminals using the session’s worktree as the working directory.
- The top terminal is reserved for the agent process, the bottom terminal is yours.
- Terminals persist until you close the session, making context switches instant.
- Terminal history stays in-memory (about 4 MB per terminal) so high-volume sessions may trim the oldest output; nothing is written to disk.
- The bottom terminal includes a **Run** button (`⌘E`) when a project run script is configured so you can launch dev servers or tests without leaving the app.
