# GitHub Login & PR Flow Plan

## Goals
- Allow users to authenticate Schaltwerk with GitHub via OAuth.
- Enable granting repository access for the active project workspace.
- Surface a PR action on reviewed sessions when GitHub auth and repo access are in place.
- Guide users through branch selection/creation, title, and description via a modal.
- Create the PR in the browser with a squash merge of session changes into the chosen branch.
- Cancel the session only when PR creation succeeds.

## Architecture Overview
- **Backend Domain**: introduce `domains/github` to encapsulate GitHub API, OAuth, token storage, and PR orchestration.
- **Frontend State**: extend contexts to track GitHub auth state and repository linkage; persist project-level settings in SQLite (project_config).
- **Modals/UI Flow**: new modal components owned by modal context for login, repo grant, and PR creation.
- **Events/Commands**: new Tauri commands for login, logout, repo access check/grant, PR creation; events for auth state changes.

## Key Questions / Assumptions
1. OAuth Redirect Handling: rely on GitHub device flow vs. custom callback using localhost deep-link? Prefer OAuth device flow to avoid custom URL scheme.
2. Token Storage: leverage macOS Keychain via a new secure storage utility (e.g., `security` CLI or keychain bindings). Assume we can shell out using `security add-generic-password`.
3. Git Operations: reuse existing git worktree state; gather diff from session branch and push scratch branch via git CLI authenticated with ephemeral token? Need to confirm remote origin uses HTTPS for token auth.
4. Browser Launch: opening GitHub PR page via `open` command to default browser.
5. Branch pick/create: we can fetch branch list via GitHub API; allow user to enter new branch; backend will create branch on remote via Git operations before PR creation.

## Backend Tasks
1. **Domain Scaffolding**
   - Create `src-tauri/src/domains/github/mod.rs`, `service.rs`, `types.rs`, `oauth.rs`, `storage.rs`.
   - Expose through `src-tauri/src/domains/mod.rs`.
2. **Token Storage**
   - Implement macOS keychain helper (may exist? verify). Provide get/set/delete functions keyed by project path hash.
   - Write unit tests with mock storage for in-memory mode.
3. **OAuth Device Flow**
   - Implement GitHub device authorization (POST /login/device/code, poll /oauth/access_token).
   - Launch verification URI via `open` command.
   - Emit event when auth completes or fails.
4. **Repository Access Grant**
   - API to list user repos with admin/write rights; verify the current project remote is accessible.
   - Store mapping in project_config (new columns for GitHub repo owner/name & permission flag).
5. **Session PR Creation**
   - Provide command `github_create_session_pr`:
     - Preconditions: auth token + repo access.
     - Gather session diff via existing git domain (needs new helper) and create temporary branch.
     - Push branch using token (set env `GITHUB_TOKEN` for `git push`).
     - Call GitHub GraphQL/REST to open PR with squash merge; return HTML URL.
     - On success emit event for frontend to cancel session via existing command.
6. **Tauri Commands & Events**
   - Add commands: `github_start_login`, `github_logout`, `github_get_status`, `github_grant_repo_access`, `github_create_pr_for_session`.
   - Register in `main.rs`; wire to domain service.
   - Events: `GitHubAuthChanged`, `GitHubRepoAccessUpdated`, `GitHubPrCreated`.

## Frontend Tasks
1. **Types & Context**
   - Extend `ProjectContext` or create `GitHubContext` to hold auth state, repo mapping, and loader states.
   - Add TypeScript types for GitHub status (authenticated, repos, errors).
2. **API Layer**
   - Add entries to `tauriCommands.ts` for new commands.
   - Create hooks/services (e.g., `useGitHubIntegration`) to call commands and subscribe to events.
3. **Modals**
   - Modal 1: GitHub Login with explanation + CTA triggers `github_start_login`.
   - Modal 2: Repo Access selection (list repos and allow linking to current project remote).
   - Modal 3: PR Creation (branch select/create, title, description). Validate inputs.
   - Use theme tokens for styling.
4. **Session Card Integration**
   - Update `SessionActions` to add PR icon for reviewed sessions when GitHub status is ready.
   - Clicking opens PR modal; on completion, await backend response then show success toast.
5. **State Refresh**
   - Listen for backend events to refresh context state.
   - Cancel session after PR success via existing cancel command; handle error path gracefully.
6. **Testing**
   - Add frontend tests for contexts/hooks and modal component rendering logic.

## Data Model Updates
- Extend `project_config` table with columns:
  - `github_repo_owner TEXT`
  - `github_repo_name TEXT`
  - `github_repo_permissions TEXT`
  - `github_default_branch TEXT`
- Store auth metadata per project (likely in app_config or dedicated table if needed).

## Validation & Tooling
- Update just/checklists to include new commands if necessary.
- Ensure `just test` passes after implementation.
- Provide manual test plan covering login, repo grant, PR creation, error handling.

## Risks & Mitigations
- **OAuth Polling Limits**: respect interval from device flow response; implement exponential backoff.
- **Keychain Access Failures**: surface detailed errors and allow retry/reset.
- **Git Conflicts**: handle branch push failures gracefully; reset worktree state on errors.
- **Session Cancellation Safety**: only cancel after confirmation of PR creation and local git state clean.

## Open Questions for Review
- Should auth be per project or global? Current plan stores per project but token could be global; confirm preference.
- Need to confirm remote names (assume `origin`). Provide configuration option if different.
