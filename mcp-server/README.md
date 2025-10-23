 # Schaltwerk MCP Server

 This is the Model Context Protocol (MCP) server for Schaltwerk, enabling AI assistants to manage Schaltwerk sessions programmatically.

## 🔒 Security & Safety

**CRITICAL**: This MCP server manages Git worktrees and session data. Always follow these security principles:

### Session Protection Rules
- **Never cancel or delete sessions without explicit user consent** - especially reviewed sessions
- **Only cancel reviewed sessions after successful merge to main branch and passing tests**
- **Preserve Git state for all failed merge operations** - never delete sessions that fail to merge
- **Always validate before operations** - check git status, ensure clean working tree, verify on correct branch
- **Test after merge operations** - run tests and only proceed if they pass
- **Send follow-up messages for problematic sessions** - don't force merge when issues arise
- **Git recovery awareness** - commits can be recovered from Git history, but uncommitted changes are permanently lost

### Merge Workflow Security
- **First merge main into session branch** to resolve conflicts before merging back
- **Understand Git diffs after merging main**: Files appearing as "removed" are actually files added to main after session creation - these are NORMAL and should not be considered session deletions
- **Focus on what the session ADDS** (new files, modifications) - ignore apparent "deletions" of files that existed in main but not in session branch point
- **Run tests after merge attempts** - only proceed with cancellation if tests pass
- **Send follow-up messages for merge issues** - don't force merge when conflicts or issues arise

### Validation Criteria for Merges
- ✅ **PROCEED**: Small mechanical conflicts, clean diffs (ignoring false deletions), tests pass
- ❌ **SEND FOLLOW-UP**: Compilation failures, test failures, complex conflicts, unclear changes, obvious regressions
- ❓ **ASK USER**: Content duplication, unclear session purpose, strategic decisions

### Follow-up Message Strategy
- **Technical issues agents can fix**: Send descriptive messages explaining specific problems (compilation errors, integration issues, merge conflicts)
- **Strategic issues**: Ask user for guidance on duplication, purpose clarification, or complex decisions
- **When in doubt**: Send follow-up for technical issues, ask user for strategic issues

### Decision Making Philosophy
- **Automation handles**: Simple conflicts, mechanical merges, integration coordination
- **Agents handle**: Complex conflicts, code logic issues, feature-specific problems
- **User handles**: Content duplication decisions, strategic choices, session purpose clarification
- **Git State Protection**: NEVER delete/cancel sessions unless successfully merged - all failed merges preserve Git state

### Reviewed Sessions Protection
- Sessions marked as 'reviewed' represent validated, approved work ready for integration
- These sessions should only be cancelled after successful merge validation
- Never delete reviewed sessions due to perceived invalidity - seek user guidance instead
- Preserve all Git commits and history even after session operations

### Safe Operation Guidelines
- Use `schaltwerk_pause` instead of `schaltwerk_cancel` when uncertain about session state
- If MCP server is not accessible or operations fail, ask user for help immediately
- Never attempt manual operations when MCP server access is unavailable
- Always prefer safe operations that preserve work over destructive ones

 ## Features

 - **Create Sessions**: Start new development sessions with Git worktrees
 - **List Sessions**: View all sessions with review status
 - **Cancel Sessions**: Remove abandoned sessions (with safety checks)
 - **Review Status**: Track which sessions are reviewed vs new

## Installation

### Quick Setup (Recommended)

From the schaltwerk repository root:

```bash
just mcp-setup
```

This command will:
1. Install dependencies
2. Build the MCP server
3. Display the exact registration command with the correct path

Then follow the displayed instructions to register with Claude Code.

### Manual Installation

If you prefer to set up manually:

#### 1. Build the MCP Server

```bash
cd mcp-server
bun install
bun run build    # or: npm run build
```

#### 2. Configure Claude Code (CLI)

Since the orchestrator runs Claude Code CLI (not Claude Desktop), configure it using one of these methods:

##### Option 1: CLI Command (Recommended)
```bash
claude mcp add --transport stdio --scope project schaltwerk node /path/to/schaltwerk/mcp-server/build/schaltwerk-mcp-server.js
```

##### Option 2: Manual Configuration
Add to `.claude.json` in your project root:

```json
{
  "mcpServers": {
    "schaltwerk": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/schaltwerk/mcp-server/build/schaltwerk-mcp-server.js"]
    }
  }
}
```

Replace `/path/to/schaltwerk` with the actual path to your schaltwerk repository.

### 3. Restart Orchestrator

Use the Settings modal (⌘,) in Schaltwerk to restart the orchestrator and reload the MCP configuration.

## Usage

Once configured, Claude (and other supported agents) can use the following tools:

### Creating Sessions

```
Use schaltwerk_create to start a new session:
- name: "feature-auth"
- prompt: "implement user authentication with JWT"
- agent_type: "claude" (supported: claude, opencode, gemini, codex, droid, qwen, amp, terminal)
- base_branch: "main" (optional)
- skip_permissions: true (for autonomous operation)

Note: Use agent_type "terminal" for manual work without AI agents - opens only a usable terminal without starting an agent.
```

### Listing Sessions

```
Use schaltwerk_list to see all sessions:
- Shows review status ([NEW] or [REVIEWED])
- Shows last modified time
- Shows agent type used
- Use json: true for structured output
```

 ### Cancelling Sessions (EXTREME CAUTION REQUIRED)

  ```
  Use schaltwerk_cancel ONLY for sessions that are fully committed and merged:
  - session_name: "feature-auth"
  - force: true (required for safety bypass)
  - CRITICAL: Only cancel after successful merge to main AND passing tests
  - DANGER: This permanently deletes Git branch and loses ALL uncommitted work
  - PROTECTION: NEVER cancel reviewed sessions without user consent and merge validation
  - SAFETY: Use schaltwerk_pause for uncertain sessions (preserves all work)
  - RECOVERY: Git commits can be recovered, but uncommitted changes are permanently lost
  ```

## Resources

The MCP server also exposes resources you can read:

- `schaltwerk://sessions` - All active sessions
- `schaltwerk://sessions/reviewed` - Only reviewed sessions
- `schaltwerk://sessions/new` - Only new (unreviewed) sessions

## Development

### Running in Development Mode

```bash
cd mcp-server
bun run dev  # Watch mode for TypeScript (or: npm run dev)
node build/schaltwerk-mcp-server.js  # Run the server
```

### Testing

```bash
bun run test     # or: npm run test
```

  ## Session Protection & Recovery

  ### Safety Features
  - **Automatic Safety Checks**: Session cancellation checks for uncommitted work by default
  - **Git State Preservation**: All commits are preserved in Git history even after session operations
  - **Review Status Protection**: Reviewed sessions require special handling and user consent
  - **Graceful Failure**: Operations preserve existing work when they cannot complete successfully
  - **Merge Validation Required**: Never cancel sessions without successful merge and test validation

  ### Recovery Options
  If a session is accidentally cancelled:
  1. **Check Git History**: Commits may still exist in Git database
  2. **Recover from Commits**: Use `git checkout -b recover-session <commit-hash>`
  3. **Re-merge Work**: Merge recovered branch back to main if valuable
  4. **Contact User**: Always seek user guidance for recovery operations

  ### Critical Recovery Notes
  - **Commits are recoverable** from Git database even after session cancellation
  - **Uncommitted changes are permanently lost** when sessions are cancelled
  - **Reviewed sessions should never be cancelled** unless successfully merged
  - **Always preserve Git state** for failed merge operations

  ### Best Practices
  - Use `schaltwerk_pause` instead of `schaltwerk_cancel` when uncertain
  - Never delete reviewed sessions without successful merge validation
  - Preserve Git state for all session operations
  - Ask user for help if MCP server is not accessible
  - Always validate merges with tests before considering sessions complete

 ## Architecture

 The MCP server communicates directly with the Schaltwerk SQLite database to manage sessions. It:

 1. Reads session data from `~/Library/Application Support/schaltwerk/sessions.db`
 2. Creates Git worktrees for new sessions
 3. Updates session metadata in the database
 4. Manages review status tracking

## Troubleshooting

### Server Not Starting

1. Check that the database exists at the expected location
2. Ensure you have Git installed and configured
3. Verify the repository path is correct

### Sessions Not Creating

1. Ensure you're in a Git repository
2. Check that the base branch exists
3. Verify you have write permissions

### Claude Not Finding the Server

1. Check the configuration file path is correct
2. Ensure the MCP server path is absolute, not relative
3. Restart Claude Desktop after configuration changes
