# PR Feedback Feature

## Context

Current PR workflow is missing critical signal for agents: which review comments are resolved vs unresolved, which CI checks failed (by name), and review decisions. When a user clicks "paste comments" today, the agent gets raw review comments without resolution state, no CI details, and no review context. This wastes tokens on already-resolved comments and leaves the agent guessing about failures.

This feature adds:
1. **MCP tool** `schaltwerk_get_pr_feedback` — agents call it for structured PR state
2. **UI button** "PR Feedback" — human-in-the-loop button that fetches comprehensive feedback and pastes a context-optimized prompt to the agent terminal

Key constraint: minimize context window usage. Only include unresolved threads, failed/pending checks, and review decisions. Exclude resolved threads, passed checks (just count), PR description, labels, and URL.

## Files to Modify

### Backend (Rust)
- `src-tauri/src/domains/git/github_cli.rs` — New types, GraphQL query, `get_pr_feedback()`
- `src-tauri/src/commands/github.rs` — New Tauri command `github_get_pr_feedback`
- `src-tauri/src/main.rs:1166` — Register new command
- `src-tauri/src/mcp_api.rs` — New REST endpoint `GET /api/sessions/{name}/pr-feedback`

### MCP Server (TypeScript)
- `mcp-server/src/schaltwerk-mcp-server.ts` — Tool definition + handler + summary formatter
- `mcp-server/src/schaltwerk-bridge.ts` — Bridge method `getPrFeedback()`
- `mcp-server/src/schemas.ts` — Output schema

### Frontend (TypeScript)
- `src/common/tauriCommands.ts` — Add `GitHubGetPrFeedback` enum entry
- `src/types/githubIssues.ts` — New types: `GithubPrFeedback`, `GithubReviewThread`, `GithubStatusCheck`
- `src/components/modals/githubPrFormatting.ts` — New `formatPrFeedbackForTerminal()`
- `src/hooks/usePrFeedback.ts` — New hook (pattern from `usePrComments.ts`)
- `src/components/diff/SimpleDiffPanel.tsx` — Add feedback button
- `src/components/diff/DiffSessionActions.tsx` — Add feedback button
- `src/common/i18n/types.ts` — New i18n keys
- `src/locales/en.json` — English strings
- `src/locales/zh.json` — Chinese strings

## Implementation

### Step 1: Extend `GitHubStatusCheck` with `name` field

In `github_cli.rs`, add `name: Option<String>` to both `GitHubStatusCheck` (line 145) and `StatusCheckRollupNode` (line 2000). Update the mapping in `get_pr_with_comments` (line ~891) to propagate `name`. This gives us per-check identification from the existing `gh pr view --json statusCheckRollup` call.

### Step 2: Add GraphQL types and `get_pr_feedback()` in `github_cli.rs`

New public types:
```rust
pub struct GitHubReviewThreadComment {
    pub author_login: Option<String>,
    pub body: String,
    pub created_at: String,
}

pub struct GitHubReviewThread {
    pub is_resolved: bool,
    pub is_outdated: bool,
    pub path: String,
    pub line: Option<u64>,
    pub comments: Vec<GitHubReviewThreadComment>,
}

pub struct GitHubPrFeedback {
    pub state: String,
    pub is_draft: bool,
    pub review_decision: Option<String>,
    pub latest_reviews: Vec<GitHubPrReview>,
    pub status_checks: Vec<GitHubStatusCheck>,
    pub unresolved_threads: Vec<GitHubReviewThread>,
    pub resolved_thread_count: usize,
}
```

Private deserialization structs for GraphQL response (nested: `GraphQLResponse<T>` → `repository.pullRequest` → `reviewThreads.nodes[]`).

New method `get_pr_feedback()`:
- **Call 1**: Reuse existing `get_pr_with_comments()` for status checks with names + PR metadata
- **Call 2**: `gh api graphql -f query='...'` for review threads with `isResolved`, `isOutdated`, `path`, `line`, and `comments`
- Filter: only keep unresolved, non-outdated threads
- Return `GitHubPrFeedback` combining both results

GraphQL query (using `gh api graphql -f query=...`):
```graphql
{
  repository(owner: "...", name: "...") {
    pullRequest(number: N) {
      state isDraft reviewDecision
      latestReviews(last: 10) { nodes { author { login } state submittedAt } }
      reviewThreads(last: 100) {
        nodes {
          isResolved isOutdated path line
          comments(last: 20) { nodes { author { login } body createdAt } }
        }
      }
    }
  }
}
```

Helper: `parse_owner_name(&str) -> Result<(&str, &str)>` to split "owner/repo".

### Step 3: Tauri command in `commands/github.rs`

New payload types (`PrFeedbackPayload`, `ReviewThreadPayload`, `StatusCheckPayload`) with `#[serde(rename_all = "camelCase")]`.

New command `github_get_pr_feedback(app, pr_number) -> Result<PrFeedbackPayload, String>`:
- Get project from `get_project_manager()`
- Call `cli.get_pr_feedback()`
- Map to payload

Register in `main.rs` generate_handler at line ~1169 (after `github_get_pr_review_comments`).

### Step 4: MCP REST endpoint in `mcp_api.rs`

New route: `(&Method::GET, path) if path.starts_with("/api/sessions/") && path.ends_with("/pr-feedback")`

Handler `get_session_pr_feedback(session_name, app)`:
- Look up session → get `pr_number`
- Return 400 if no linked PR
- Call the same impl as the Tauri command
- Return JSON response

### Step 5: MCP bridge + tool

**Bridge** (`schaltwerk-bridge.ts`): `getPrFeedback(sessionName)` → `GET /api/sessions/{name}/pr-feedback`

**Tool** (`schaltwerk-mcp-server.ts`): `schaltwerk_get_pr_feedback` with `session_name` input. Handler calls bridge, formats a context-optimized summary as the text response. The structured JSON is also included for agents that prefer it.

**Summary formatter** `formatPrFeedbackSummary()`:
```
PR: OPEN | Review: CHANGES_REQUESTED | 3 unresolved threads | CI: 1 failed, 0 pending, 5 passed

## Reviews
- @reviewer1: CHANGES_REQUESTED

## CI Checks
- FAILED: Unit Tests

## Unresolved Review Threads
### src/auth/login.ts:42
**@reviewer1:** Validate email format before the API call
```

**Schema** (`schemas.ts`): Define output schema for the structured response.

### Step 6: Frontend types + formatting

**Types** in `githubIssues.ts`: `GithubPrFeedback`, `GithubReviewThread`, `GithubStatusCheck` interfaces.

**Tauri command** in `tauriCommands.ts`: `GitHubGetPrFeedback = 'github_get_pr_feedback'`

**Formatting** in `githubPrFormatting.ts`: New `formatPrFeedbackForTerminal(feedback, prNumber)`:
- One-line summary header with counts
- Reviews section (only if present)
- CI Checks section (only failed/pending by name, count passed)
- Unresolved threads grouped by file with body truncated at 500 chars
- "No action items found" when everything is clean

### Step 7: `usePrFeedback` hook

New file `src/hooks/usePrFeedback.ts` following exact pattern of `usePrComments.ts`:
- `fetchAndPasteFeedback(prNumber)`: invoke → format → determine agent type → PasteAndSubmitTerminal → focus → toast
- Returns `{ fetchingFeedback, fetchAndPasteFeedback }`

### Step 8: UI buttons

**`SimpleDiffPanel.tsx`** (line ~454): Add button next to existing comment button (VscComment). Use `VscChecklist` icon. Smaller style matching the existing icon buttons.

**`DiffSessionActions.tsx`** (line ~93): Add button next to existing "PR Comments" button. Full labeled button: "PR #{number} Feedback".

### Step 9: i18n

**`types.ts`** — Add to `diffSessionActions`: `sendPrFeedback`, `prFeedback`
**`en.json`** — Add strings: `"sendPrFeedback": "Send PR #{number} feedback digest to terminal"`, `"prFeedback": "PR #{number} Feedback"`
**`zh.json`** — Add Chinese equivalents
**Toast strings** in `toasts` section: `feedbackSent`, `feedbackSentDesc`, `fetchFeedbackFailed`

## Testing

### Rust (TDD)
- Test `parse_owner_name` (valid, invalid)
- Test GraphQL response deserialization with mock JSON
- Test `get_pr_feedback` with `MockRunner` — mock both `gh pr view` and `gh api graphql` responses
- Test resolved/outdated thread filtering
- Test `name` field propagation in status check mapping

### TypeScript
- Test `formatPrFeedbackForTerminal` with: no threads/no failures, all combinations, body truncation at 500 chars, empty feedback

### End-to-end verification
1. `just test` — all checks pass
2. Link a PR to a session in the app, click the new feedback button, verify formatted output in terminal
3. Call `schaltwerk_get_pr_feedback` via MCP, verify structured response
