# GitHub PR Flow Plan

## Goals
- Let users publish reviewed session changes directly from Schaltwerk.
- Reuse the developer’s existing Git credentials (HTTPS or SSH) to push either a squash branch or the existing session branch, based on user choice.
- Allow users to pick both the base branch (defaults to the session’s recorded base) and the target branch name, respecting any custom naming convention.
- Launch a prefilled GitHub compare URL so the user can finish opening the pull request in the browser.
- Make it clear in the UI that Schaltwerk will push a branch before handing off to the browser.
- Provide a lightweight confirmation path so the session can be cancelled once the user indicates the PR was created.

## End-to-End Flow
1. **Surface Action**
   - Reviewed session cards show a PR icon when git remotes resolve to GitHub.
   - Clicking opens a modal explaining the flow and warning that a new branch will be pushed to the remote.
2. **Collect Inputs**
   - Modal fields: base branch selector (pre-filled with session base), new branch name input with validation, publish mode toggle (`Squash changes into one commit` vs `Keep existing commits`), confirmation checkbox acknowledging the push.
3. **Prepare Branch**
   - If squash mode is selected, backend creates a temporary branch off the session branch, performs a squash commit with session changes, and checks the working tree is clean afterwards.
   - If existing-commits mode is selected, backend reuses the session branch commits and ensures it is fast-forwarded/rebased onto the chosen base branch without altering commit history.
4. **Push & Launch Compare**
   - Push the branch to the chosen remote using existing git credentials.
   - Open `https://github.com/<owner>/<repo>/compare/<base>...<head>?expand=1&quick_pull=1` in the user’s browser (the user fills in title/body there).
5. **User Completes PR**
   - Browser shows GitHub’s compare page with fields prefilled; user reviews and clicks “Create pull request.”
6. **Session Wrap-up**
   - After opening the browser, keep the session active by default. Provide explicit actions: `PR created – cancel session` (optional) and `Keep session` so the user decides whether to archive the session.
   - Provide a “PR failed / retry” path that keeps the session intact and lets the user adjust inputs.

## Backend Work
- Add a focused `github_publish` service (e.g., `src-tauri/src/domains/github/`) responsible for:
  - Detecting GitHub-compatible remotes via `git remote -v` (support both HTTPS and SSH URL formats).
  - Parsing owner/repo from remote URLs and caching them in `project_config`.
  - Preparing publish branches: reuse existing git helpers to compute diffs, ensure no uncommitted changes leak in, and name temporary branches safely for squash mode.
  - In non-squash mode, verify the session branch is up to date with the selected base (fast-forward/rebase) and surface conflicts for manual resolution if needed.
  - Pushing branches with existing credentials; capture push errors and return actionable messages.
  - Building the compare URL with properly URL-encoded branch names.
- Tauri commands/events:
  - `github_publish_get_context` → returns detected remotes, default base branch, suggested head branch, and last PR metadata if available.
  - `github_publish_prepare` → prepares according to selected mode (squash vs keep commits) and pushes branch; returns compare URL.
  - `github_publish_complete` → records optional PR URL and cancels session.
  - Emit `GitHubPublishFailed` for push or git errors and `GitHubPublishCompleted` when user confirms success.
- Persistence:
  - Extend `project_config` with `github_owner`, `github_repo`, `github_remote_name`, `github_last_branch_prefix`, `github_last_base_branch`, and `github_last_publish_mode` to remember user choices.

## Frontend Work
- **Context/State**
  - Extend sessions context (or add `GitHubPublishContext`) to fetch publish status, remotes, and defaults via the new command.
  - Track modal state, validation errors, async progress (preparing, pushing, awaiting user decision on cancellation).
- **UI Placement**
  - Add PR icon to reviewed session actions (can live alongside existing cancel/unmark buttons). Use tooltip to explain requirements when disabled (e.g., non-GitHub remote).
  - Optionally add a toolbar shortcut if we later want project-level access; for now, focus on session cards.
- **Modal UX**
  - Sections: Overview (what happens), Branch configuration & publish mode, Confirmation
  - Highlight branch push warning and allow users to copy the compare URL once available.
  - Provide buttons: `Create Branch & Open PR`, `Cancel`, and after success `PR created – cancel session`, `Keep session`, `Retry`.
- **Inputs & Defaults**
  - Base branch dropdown: list local + remote branches (fetch via git), default to session base branch.
  - New branch name input: default to sanitized session name or recorded branch, allow overrides with validation (supports slashes, hyphens).
- **Testing**
  - Add unit/component tests for state hooks, modal validation, disabled-state logic on session cards, and serialization of compare URLs.

## Git & Validation Details
- Ensure worktree clean prior to publish; surface instructions if uncommitted changes exist.
- Squash mode: author uses user’s git config; commit message derived from the session display name (can be edited later in browser).
- Keep-commits mode: leave commit metadata untouched; perform fast-forward/rebase to align with selected base and halt with clear errors on conflicts.
- After push, optionally remove temporary worktree but keep branch for future pushes.
- Support remotes beyond `origin`; remember user choice per project and reuse next time.
- If remote is not GitHub, disable PR action and surface guidance.

## Edge Cases & Recovery
- Push fails (permissions, branch exists): show error in modal, allow editing branch name or base and retry.
- Browser fails to open: still copy compare URL so the user can open manually.
- User closes modal without confirming: leave session untouched; they can reopen PR flow later.
- Session cancellation only happens after explicit confirmation, preventing accidental cancellations.

## Delivery Checklist
- Implement backend service, commands, and persistence.
- Implement frontend UI and tests.
- Verify the flow on a representative GitHub project before shipping.
- Run `just test` before completion.
