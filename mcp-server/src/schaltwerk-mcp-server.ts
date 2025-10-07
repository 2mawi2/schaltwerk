#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  CallToolRequest,
  ListResourcesRequest,
} from "@modelcontextprotocol/sdk/types.js"
import { SchaltwerkBridge, Session } from "./schaltwerk-bridge.js"

interface SchaltwerkStartArgs {
  name?: string
  prompt?: string
  agent_type?: 'claude' | 'opencode' | 'gemini' | 'codex'
  base_branch?: string
  skip_permissions?: boolean
  is_draft?: boolean
  draft_content?: string
}

interface SchaltwerkCancelArgs {
  session_name: string
  force?: boolean
}

interface SchaltwerkPauseArgs {
  session_name: string
}

interface SchaltwerkListArgs {
  json?: boolean
  filter?: 'all' | 'active' | 'spec' | 'reviewed'
}

interface SchaltwerkSendMessageArgs {
  session_name: string
  message: string
}

interface SchaltwerkSpecCreateArgs {
  name?: string
  content?: string
  base_branch?: string
}

interface SchaltwerkDraftUpdateArgs {
  session_name: string
  content: string
  append?: boolean
}

interface SchaltwerkCurrentSpecUpdateArgs {
  content: string
  append?: boolean
}

interface SchaltwerkDraftStartArgs {
  session_name: string
  agent_type?: 'claude' | 'opencode' | 'gemini' | 'codex'
  skip_permissions?: boolean
  base_branch?: string
}

interface SchaltwerkDraftListArgs {
  json?: boolean
}

interface SchaltwerkDraftDeleteArgs {
  session_name: string
}

interface SchaltwerkMarkReviewedArgs {
  session_name: string
}

interface SchaltwerkConvertToSpecArgs {
  session_name: string
}

const bridge = new SchaltwerkBridge()

 const server = new Server({
   name: "schaltwerk-mcp-server",
   version: "1.0.0",
 }, {
   capabilities: {
     tools: {},
     resources: {},
   }
 })

  // 🔒 SECURITY NOTICE: This MCP server manages Git worktrees and sessions
  // - All session operations preserve Git history and commits
  // - Reviewed sessions represent validated work that should be protected
  // - Never delete sessions without user consent or successful merge validation
  // - If MCP server is not accessible, ask user for help immediately
  // - Session cancellation requires explicit force parameter for safety
  // - First merge main into session branch before merging back
  // - Understand Git diffs: false "deletions" are normal after merging main
  // - Send follow-up messages for merge issues, don't force problematic merges
  // - Git recovery: commits can be recovered from git cat-file, uncommitted changes are lost

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "schaltwerk_create",
        description: `Create a new Schaltwerk session for development work.

🎯 PURPOSE: Start new isolated Git worktrees for development agents with AI assistance.

📋 USAGE:
- Basic: schaltwerk_create(name: "feature-auth", prompt: "implement user authentication")
- With agent type: schaltwerk_create(name: "api-feature", prompt: "add REST API", agent_type: "opencode")
- With base branch: schaltwerk_create(name: "fix-bug", prompt: "fix login issue", base_branch: "develop")
- Skip permissions: schaltwerk_create(name: "quick-fix", prompt: "fix typo", skip_permissions: true)

🤖 AGENT TYPES:
- 'claude': Use Claude AI assistant (default)
- 'opencode': Run the OpenCode CLI agent
- 'gemini': Use Google's Gemini CLI tooling
- 'codex': Use Codex CLI with sandbox controls
- 'droid': Use Factory Droid for build-and-test automation

📝 PROMPTING:
When creating sessions for AI agents, provide clear, specific prompts:
- GOOD: "implement user authentication with JWT tokens and password reset"
- GOOD: "fix the login bug where users can't sign in with email addresses"
- BAD: "add auth"
- BAD: "fix bug"

The prompt becomes the initial context for the AI agent working in that session.

⚙️ OPTIONS:
- skip_permissions: Skip permission warnings (use --dangerously-skip-permissions)
- base_branch: Branch to create from (defaults to main/master)

⚠️ IMPORTANT: Each session creates a separate Git worktree, allowing parallel development.`,
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Session name (alphanumeric, hyphens, underscores). Will be used in branch name: schaltwerk/{name}"
            },
            prompt: {
              type: "string",
              description: "Initial agent description or context for AI agent. Be specific and detailed."
            },
            agent_type: {
              type: "string",
              enum: ["claude", "opencode", "gemini", "codex"],
              description: "AI agent type to use (default: claude)"
            },
            base_branch: {
              type: "string",
              description: "Base branch to create session from (default: main/master)"
            },
            skip_permissions: {
              type: "boolean",
              description: "Skip permission warnings for autonomous operation (use with caution)"
            }
          },
          required: ["name", "prompt"]
        }
      },
       {
         name: "schaltwerk_list",
         description: `List all Schaltwerk sessions with essential metadata for session management.

 📊 JSON OUTPUT (json: true):
 - name: Session identifier
 - display_name: Human-readable name
 - status: "new" | "reviewed"
 - created_at: ISO timestamp
 - last_activity: ISO timestamp or null
 - agent_type: "claude" | "opencode" | "gemini" | "codex" | "droid"
 - branch: Git branch name
 - worktree_path: Local path
 - initial_prompt: Original agent description

 📋 TEXT OUTPUT (default):
 - Formatted list showing review status, name, agent, and last modified

 💡 COMMON AGENTS:
 - List unreviewed sessions: filter by status="new"
 - Find active work: check last_activity timestamps
 - Identify sessions by agent type
 - Get session paths for file operations

   🔒 SESSION PROTECTION NOTICE:
   - Sessions marked as 'reviewed' represent validated work ready for merge
   - These sessions should only be cancelled after successful merge to main branch and passing tests
   - Never delete reviewed sessions due to perceived invalidity - seek user guidance instead
   - Preserve Git state for all failed merge operations - never delete sessions that fail to merge
   - If MCP server is not accessible, ask user for help immediately rather than attempting manual operations
   - Always validate merges with tests before considering sessions complete

   🔄 MERGE WORKFLOW SECURITY:
   - First merge main into session branch to resolve conflicts before merging back
   - Understand Git diffs: false "deletions" are normal after merging main (files added to main after session creation)
   - Focus on what session ADDS (new/modified files) - ignore apparent deletions of main's newer files
   - Send follow-up messages for merge issues - don't force problematic merges
   - Git recovery: commits recoverable via git cat-file, uncommitted changes permanently lost

  Use json: true for programmatic access with clean, essential data only.`,
        inputSchema: {
          type: "object",
          properties: {
            json: {
              type: "boolean",
              description: "Return structured JSON data instead of formatted text",
              default: false
            }
          },
          additionalProperties: false
        }
      },
      {
        name: "schaltwerk_send_message",
        description: `Send a follow-up message to an existing Schaltwerk session.

PURPOSE: Send messages to agents already working in sessions for updates, clarifications, or new instructions.

USAGE:
schaltwerk_send_message(session_name: "feature-auth", message: "Please also add email validation")

FEATURES:
- Messages are pasted and submitted to the active terminal in the session
- Messages are queued if the terminal is not yet active
- Validates that the target session exists before sending

REQUIREMENTS: Target session must exist and be active.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the existing session to send the message to"
            },
            message: {
              type: "string",
              description: "The message content to send to the session"
            }
          },
          required: ["session_name", "message"]
        }
      },
       {
         name: "schaltwerk_cancel",
         description: `Cancel and permanently delete a Schaltwerk session.

 ⚠️ EXTREMELY DESTRUCTIVE OPERATION - READ CAREFULLY ⚠️

 🔒 SAFETY CHECKS:
 - By default, checks for uncommitted changes and REFUSES to proceed
 - Requires 'force: true' to bypass safety checks
 - Suggests committing work before cancellation
 - Provides clear warnings about data loss

 📋 SAFE USAGE:
 schaltwerk_cancel(session_name: "feature-auth")  // Checks for uncommitted work first
 schaltwerk_cancel(session_name: "feature-auth", force: true)  // Forces deletion

 🔥 DESTRUCTIVE ACTIONS (only with force: true):
 - Removes the Git worktree
 - Deletes the Git branch
 - Loses ALL uncommitted changes
 - Cannot be undone

  ✅ WHEN TO USE:
  - Cleaning up sessions that are fully committed and merged
  - Removing experimental branches with no valuable work
  - After work has been successfully merged to main and tests pass

  ❌ WHEN NOT TO USE:
  - If session has uncommitted work you want to keep
  - Without first checking what work would be lost
  - If you're unsure about the session's state
  - Sessions marked as 'reviewed' - these should only be cancelled after successful merge to main AND passing tests
  - Sessions with valuable work that hasn't been merged yet
  - Any session that has not been validated through merge and testing

   🚨 CRITICAL SECURITY: SESSION PROTECTION
   - NEVER cancel sessions that have been marked as 'reviewed' unless they have been successfully merged to main branch and all tests pass
   - Reviewed sessions represent work that has been validated and approved for integration
   - If a reviewed session cannot be merged due to conflicts or issues, preserve the session and seek user guidance
   - Only cancel reviewed sessions after successful merge validation - never delete them due to perceived invalidity
   - Git state protection: All commits in reviewed sessions are preserved in Git history even after cancellation
   - Uncommitted changes are permanently lost when sessions are cancelled - commits can be recovered

   🔄 MERGE WORKFLOW SECURITY:
   - First merge main into session branch to resolve conflicts before merging back
   - Understand Git diffs after merging main: files appearing as "removed" are actually files added to main after session creation
   - Focus on what the session ADDS (new files, modifications) - ignore apparent "deletions" of files that existed in main but not in session branch point
   - Run tests after merge attempts - only proceed with cancellation if tests pass
   - Send follow-up messages for merge issues - don't force merge when conflicts or issues arise

   📋 VALIDATION CRITERIA:
   - ✅ PROCEED: Small mechanical conflicts, clean diffs (ignoring false deletions), tests pass
   - ❌ SEND FOLLOW-UP: Compilation failures, test failures, complex conflicts, unclear changes, obvious regressions
   - ❓ ASK USER: Content duplication, unclear session purpose, strategic decisions

   💬 FOLLOW-UP STRATEGY:
   - Technical issues agents can fix: Send descriptive messages explaining specific problems
   - Strategic issues: Ask user for guidance on duplication, purpose clarification, or complex decisions
   - When in doubt: Send follow-up for technical issues, ask user for strategic issues

   🎯 DECISION PHILOSOPHY:
   - Automation handles: Simple conflicts, mechanical merges, integration coordination
   - Agents handle: Complex conflicts, code logic issues, feature-specific problems
   - User handles: Content duplication decisions, strategic choices, session purpose clarification

  🛡️ SAFER ALTERNATIVES:
  - 'schaltwerk_pause': Archive session without deletion (RECOMMENDED for uncertain sessions)
  - Commit your work first, then cancel
  - Use proper merge workflow to integrate work before cancellation

  💡 SESSION RECOVERY: If commits exist in Git database, they can be recovered even after session cancellation using 'git checkout -b recover-session <commit-hash>'`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the session to cancel and delete permanently"
            },
            force: {
              type: "boolean",
              description: "Force deletion even if uncommitted changes exist. DANGEROUS - only use if you're certain you want to lose uncommitted work.",
              default: false
            }
          },
          required: ["session_name"]
        }
      },
       {
         name: "schaltwerk_pause",
         description: `Pause a Schaltwerk session without deleting it (SAFE alternative to cancel).

 🛡️ SAFE OPERATION - NO DATA LOSS
 - Preserves all uncommitted changes
 - Keeps Git branch intact
 - Maintains worktree for future use
 - Can be easily resumed later

 📋 USAGE:
 schaltwerk_pause(session_name: "feature-auth")

 ✅ WHEN TO USE:
 - Taking a break from current work
 - Switching to other priorities
 - Keeping work for later review
 - Uncertain about whether to keep the session
 - When you need to preserve work but cannot complete it immediately

 🔄 TO RESUME:
 - Session remains available in schaltwerk_list
 - Worktree and branch are preserved
 - Can continue work exactly where you left off

 💡 This is the RECOMMENDED way to stop working on a session without losing progress.

  🔒 SESSION PROTECTION:
  - Pausing is always safe - no work is ever lost (RECOMMENDED for uncertain sessions)
  - Use pause instead of cancel when uncertain about session state
  - Reviewed sessions can be paused and resumed without affecting their reviewed status
  - All Git commits and uncommitted changes are preserved when pausing
  - If MCP server is not accessible, ask user for help rather than attempting risky operations
  - Safe alternative to cancellation - preserves all work for future use`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the session to pause (preserves all work)"
            }
          },
          required: ["session_name"]
        }
      },
      {
        name: "schaltwerk_spec_create",
        description: `Create a new spec session for later refinement and execution.

🎯 PURPOSE: Create spec sessions to collaborate on agent descriptions before starting agents.

📋 USAGE:
- Basic: schaltwerk_spec_create(name: "auth-feature", content: "# Authentication\\n\\nImplement user login")
- Without content: schaltwerk_spec_create(name: "bug-fix")
- With base branch: schaltwerk_spec_create(name: "hotfix", content: "Fix critical bug", base_branch: "production")

✏️ PLANS:
- Specs are lightweight specning sessions
- No worktree created until spec is started
- Content can be refined multiple times
- Convert to active session when ready

📝 CONTENT FORMAT:
- Use Markdown for structured agent descriptions
- Include requirements, technical details, acceptance criteria
- More detail leads to better AI agent results

⚡ WORKFLOW:
1. Create spec with initial idea
2. Refine content as needed (schaltwerk_draft_update)
3. Start when ready (schaltwerk_draft_start)`,
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Spec session name (alphanumeric, hyphens, underscores). Auto-generated if not provided."
            },
            content: {
              type: "string",
              description: "Initial spec content in Markdown format. Can be updated later."
            },
            base_branch: {
              type: "string",
              description: "Base branch for future worktree (default: main/master)"
            }
          },
          additionalProperties: false
        }
      },
      {
        name: "schaltwerk_draft_update",
        description: `Update content of an existing spec session.

🎯 PURPOSE: Refine and improve spec content before starting an agent.

📋 USAGE:
- Replace content: schaltwerk_draft_update(session_name: "auth-feature", content: "# Updated Requirements...")
- Append content: schaltwerk_draft_update(session_name: "auth-feature", content: "\\n## Additional Notes...", append: true)

📝 UPDATE MODES:
- Replace (default): Completely replace existing content
- Append: Add to existing content with newline separator

💡 BEST PRACTICES:
- Iteratively refine requirements
- Add technical details as discovered
- Include acceptance criteria
- Document edge cases and constraints`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the spec session to update"
            },
            content: {
              type: "string",
              description: "New or additional content in Markdown format"
            },
            append: {
              type: "boolean",
              description: "Append to existing content instead of replacing (default: false)",
              default: false
            }
          },
          required: ["session_name", "content"]
        }
      },
      {
        name: "schaltwerk_current_spec_update",
        description: `Update the currently active spec in Spec Mode.

🎯 PURPOSE: Quickly update the spec that's currently being viewed in Spec Mode without needing to specify the spec name.

📋 USAGE:
- Replace content: schaltwerk_current_spec_update(content: "# Updated Spec\\n\\nNew content here...")  
- Append content: schaltwerk_current_spec_update(content: "\\n\\n## Additional Section", append: true)

📝 UPDATE MODES:
- Replace (default): Completely replace existing content
- Append: Add to existing content with newline separator

💡 CONVENIENCE: Automatically targets the spec currently open in Spec Mode - no need to specify session_name.

⚠️ NOTE: Only works when Spec Mode is active with a spec selected.`,
        inputSchema: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "New or additional content in Markdown format"
            },
            append: {
              type: "boolean",
              description: "Append to existing content instead of replacing (default: false)",
              default: false
            }
          },
          required: ["content"]
        }
      },
      {
        name: "schaltwerk_draft_start",
        description: `Start a spec session with an AI agent.

🎯 PURPOSE: Convert a refined spec into an active development session.

📋 USAGE:
- Basic: schaltwerk_draft_start(session_name: "auth-feature")
- With agent: schaltwerk_draft_start(session_name: "auth-feature", agent_type: "claude")
- Skip permissions: schaltwerk_draft_start(session_name: "quick-fix", skip_permissions: true)
- Override branch: schaltwerk_draft_start(session_name: "hotfix", base_branch: "production")

🤖 AGENT TYPES:
- 'claude': Claude AI assistant (default)
- 'opencode': OpenCode assistant
- 'gemini': Gemini CLI agent
- 'codex': Codex assistant with sandbox controls
- 'droid': Factory Droid for build-and-test automation

⚡ WHAT HAPPENS:
1. Creates Git worktree from base branch
2. Starts selected AI agent with spec content
3. Spec content becomes initial prompt
4. Session transitions to active state

⚠️ IMPORTANT: Once started, spec cannot be reverted to spec state.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the spec session to start"
            },
            agent_type: {
              type: "string",
              enum: ["claude", "opencode", "gemini", "codex"],
              description: "AI agent type to use (default: claude)"
            },
            skip_permissions: {
              type: "boolean",
              description: "Skip permission checks for autonomous operation",
              default: false
            },
            base_branch: {
              type: "string",
              description: "Override base branch if needed"
            }
          },
          required: ["session_name"]
        }
      },
      {
        name: "schaltwerk_draft_list",
        description: `List all spec sessions.

📊 OUTPUT:
- Shows all spec sessions with content preview
- Ordered by last update time (newest first)
- Includes creation time and content length

📋 USAGE:
- Text format: schaltwerk_draft_list()
- JSON format: schaltwerk_draft_list(json: true)

💡 Use this to review specs before starting them.`,
        inputSchema: {
          type: "object",
          properties: {
            json: {
              type: "boolean",
              description: "Return as JSON for programmatic access (default: false)",
              default: false
            }
          },
          additionalProperties: false
        }
      },
       {
         name: "schaltwerk_draft_delete",
         description: `Delete a spec session permanently.

 ⚠️ DESTRUCTIVE OPERATION
 - Permanently removes spec from database
 - Cannot be undone
 - No worktree to clean up (specs don't create worktrees)

 📋 USAGE:
 schaltwerk_draft_delete(session_name: "old-spec")

 ✅ SAFE TO USE: Only affects database record, no files or branches.

 🔒 SECURITY CONSIDERATIONS:
 - Only delete specs that are truly obsolete or completed
 - Consider converting to active session instead of deleting if work might be valuable
 - If MCP server is not accessible, ask user for help rather than attempting deletion
 - Specs represent planning work - preserve them when in doubt`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the spec session to delete"
            }
          },
          required: ["session_name"]
        }
       },
        {
          name: "schaltwerk_mark_session_reviewed",
          description: `Mark a running session as reviewed and ready for merge.

 🎯 PURPOSE: Mark active development sessions as complete and ready for code review/merge.

 📋 USAGE:
 schaltwerk_mark_session_reviewed(session_name: "feature-auth")

 ⚡ WHAT HAPPENS:
 1. Sets the session's ready_to_merge flag to true
 2. Session status changes from 'running' to 'reviewed'
 3. Session appears in reviewed sessions list
 4. Worktree and branch are preserved for potential rollback

 ✅ WHEN TO USE:
 - Development work is complete and tested
 - Session is ready to be marked as reviewed
 - Want to mark session as done without deleting it

 ⚠️ IMPORTANT: This is reversible - you can convert reviewed sessions back to specs for rework.

   🔒 SECURITY CONSIDERATIONS:
   - Reviewed sessions represent validated work that should be preserved
   - These sessions should only be cancelled after successful merge to main branch and passing tests
   - Never delete reviewed sessions due to perceived invalidity - they represent approved work
   - If merge conflicts or issues arise, preserve the session and seek user guidance
   - Always validate merges with tests before considering sessions complete
   - Git state protection: All commits in reviewed sessions are preserved in Git history
   - Uncommitted changes are permanently lost when sessions are cancelled - preserve work through proper merge workflow

   🔄 NEXT STEPS AFTER MARKING REVIEWED:
   - Reviewed sessions are ready for merge workflow: first merge main into session branch, then merge session back to main
   - Understand Git diffs after merging main: false "deletions" are normal (files added to main after session creation)
   - Focus on session additions/modifications when validating merge content
   - Send follow-up messages for technical issues, ask user for strategic decisions`,
         inputSchema: {
           type: "object",
           properties: {
             session_name: {
               type: "string",
               description: "Name of the running session to mark as reviewed"
             }
           },
           required: ["session_name"]
         }
       },
        {
          name: "schaltwerk_convert_to_spec",
          description: `Convert a running or reviewed session back to spec state for rework.

 🎯 PURPOSE: Convert active or reviewed sessions back to spec state when changes are needed.

 📋 USAGE:
 schaltwerk_convert_to_spec(session_name: "feature-auth")

 ⚡ WHAT HAPPENS:
 1. Session state changes from 'running'/'reviewed' to 'spec'
 2. ready_to_merge flag is reset to false
 3. Worktree is removed (branch preserved)
 4. Session content becomes spec content for refinement
 5. Can be started again with schaltwerk_draft_start

 ✅ WHEN TO USE:
 - Need to rework a session after review
 - Want to convert a running session to spec for specning
 - Session needs significant changes before completion

 ⚠️ IMPORTANT: Worktree is removed but branch and all commits are preserved.

 🔒 SESSION PROTECTION:
 - Converting reviewed sessions back to spec preserves all Git history and commits
 - This operation is safe and reversible - no work is lost
 - Reviewed sessions converted to spec can be restarted later with schaltwerk_draft_start
 - If MCP server is not accessible during this operation, ask user for help immediately`,
         inputSchema: {
           type: "object",
           properties: {
             session_name: {
               type: "string",
               description: "Name of the running or reviewed session to convert back to spec"
             }
           },
           required: ["session_name"]
         }
       },
        {
          name: "schaltwerk_get_current_tasks",
         description: `Get current agents with flexible field selection to manage response size.

 🎯 PURPOSE: Retrieve agent information with control over which fields to include, preventing large responses.

 📊 FIELD SELECTION:
 Use the 'fields' parameter to specify which fields to include. This is critical for managing response size.

 🔧 AVAILABLE FIELDS:
 - name: Agent identifier (always included)
 - display_name: Human-readable name
 - status: 'active' | 'spec' | 'cancelled' | 'paused'
 - session_state: 'Spec' | 'Running' | 'Reviewed'
 - created_at: ISO timestamp
 - last_activity: ISO timestamp
 - branch: Git branch name
 - worktree_path: Local directory path
 - ready_to_merge: Boolean for review status
 - initial_prompt: Original agent description (can be large)
 - draft_content: Full spec content (can be VERY large)

 📋 USAGE PATTERNS:

 1️⃣ QUICK OVERVIEW (default - minimal fields):
 schaltwerk_get_current_tasks()
 Returns: name, status, session_state, branch only

 2️⃣ AGENT MANAGEMENT (medium detail):
 schaltwerk_get_current_tasks(fields: ["name", "status", "session_state", "branch", "created_at", "last_activity"])
 Use when: Managing sessions, checking activity, organizing work

 3️⃣ PLAN SELECTION (content preview):
 schaltwerk_get_current_tasks(
   fields: ["name", "status", "session_state", "draft_content"],
   status_filter: "spec",
   content_preview_length: 200
 )
 Use when: Browsing specs to find the right one to start

 4️⃣ FULL DETAILS (use sparingly):
 schaltwerk_get_current_tasks(fields: ["all"])
 Use when: Need complete information for specific analysis

 ⚠️ PERFORMANCE TIPS:
 - Never request 'draft_content' or 'initial_prompt' unless needed
 - Use status_filter to reduce dataset size
 - Use content_preview_length for spec browsing
 - Default fields are optimized for common operations

 🎯 FILTERING:
 - status_filter: Filter by status ('spec', 'active', 'reviewed')
 - Reduces response size by excluding irrelevant agents

 💡 BEST PRACTICES:
 - Start with minimal fields, add more if needed
 - Use filters to focus on relevant agents
 - Request content fields only when examining specific agents

   🔒 SESSION PROTECTION:
   - Sessions with 'ready_to_merge: true' are reviewed and should be preserved
   - Never delete reviewed sessions without successful merge validation and passing tests
   - Preserve Git state for all failed merge operations - never delete sessions that fail to merge
   - Always validate merges with tests before considering sessions complete
   - If MCP server is not accessible, ask user for help immediately
   - Uncommitted changes are permanently lost when sessions are cancelled - preserve work through proper merge workflow

   🔄 MERGE WORKFLOW FOR REVIEWED SESSIONS:
   - First merge main into session branch to resolve conflicts before merging back
   - Understand Git diffs: false "deletions" are normal after merging main (files added to main after session creation)
   - Focus on what session ADDS (new/modified files) - ignore apparent deletions of main's newer files
   - Send follow-up messages for technical issues, ask user for strategic decisions`,
        inputSchema: {
          type: "object",
          properties: {
            fields: {
              type: "array",
              items: {
                type: "string",
                enum: ["name", "display_name", "status", "session_state", "created_at", "last_activity", "branch", "worktree_path", "ready_to_merge", "initial_prompt", "draft_content", "all"]
              },
              description: "Fields to include in response. Defaults to ['name', 'status', 'session_state', 'branch']. Use 'all' for complete data.",
              default: ["name", "status", "session_state", "branch"]
            },
            status_filter: {
              type: "string",
              enum: ["spec", "active", "reviewed", "all"],
              description: "Filter agents by status. 'reviewed' shows ready_to_merge sessions.",
              default: "all"
            },
            content_preview_length: {
              type: "number",
              description: "When including draft_content or initial_prompt, limit to this many characters (default: no limit)",
              minimum: 0
            }
          },
          additionalProperties: false
        }
      }
    ]
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params

  try {
    let result: string

    switch (name) {
      case "schaltwerk_create": {
        const createArgs = args as SchaltwerkStartArgs
        
        if (createArgs.is_draft) {
          const session = await bridge.createSpecSession(
            createArgs.name || `draft_${Date.now()}`,
            createArgs.draft_content || createArgs.prompt,
            createArgs.base_branch
          )
          
          result = `Spec session created successfully:
- Name: ${session.name}
- Branch: ${session.branch} (will be created when started)
- Base Branch: ${session.parent_branch}
- Content Length: ${session.draft_content?.length || 0} characters
- Status: Spec (ready for refinement)`
        } else {
          const session = await bridge.createSession(
            createArgs.name || `mcp_session_${Date.now()}`,
            createArgs.prompt,
            createArgs.base_branch,
            createArgs.agent_type,
            createArgs.skip_permissions
          )
          
          result = `Session created successfully:
- Name: ${session.name}
- Branch: ${session.branch}
- Worktree: ${session.worktree_path}
- Agent: ${session.original_agent_type}
- Base Branch: ${session.parent_branch}
${session.initial_prompt ? `- Initial Prompt: ${session.initial_prompt}` : ''}`
        }
        break
      }

      case "schaltwerk_list": {
        const listArgs = args as SchaltwerkListArgs
        
        const sessions = await bridge.listSessionsByState(listArgs.filter)
        
        if (listArgs.json) {
          // Return only essential fields for LLM session management
          const essentialSessions = sessions.map(s => ({
            name: s.name,
            display_name: s.display_name || s.name,
            status: s.status === 'spec' ? 'spec' : (s.ready_to_merge ? 'reviewed' : 'new'),
            session_state: s.session_state,
            ready_to_merge: s.ready_to_merge || false,
            created_at: s.created_at && !isNaN(new Date(s.created_at).getTime()) ? new Date(s.created_at).toISOString() : null,
            last_activity: s.last_activity && !isNaN(new Date(s.last_activity).getTime()) ? new Date(s.last_activity).toISOString() : null,
            agent_type: s.original_agent_type || 'claude',
            branch: s.branch,
            worktree_path: s.worktree_path,
            initial_prompt: s.initial_prompt || null,
            draft_content: s.draft_content || null
          }))
          result = JSON.stringify(essentialSessions, null, 2)
        } else {
          if (sessions.length === 0) {
            result = 'No sessions found'
          } else {
            // Format as human-readable text
            const lines = sessions.map((s: Session) => {
              if (s.status === 'spec') {
                const created = s.created_at && !isNaN(new Date(s.created_at).getTime()) ? new Date(s.created_at).toLocaleDateString() : 'unknown'
                const contentLength = s.draft_content?.length || 0
                const name = s.display_name || s.name
                return `[PLAN] ${name} - Created: ${created}, Content: ${contentLength} chars`
              } else {
                const reviewed = s.ready_to_merge ? '[REVIEWED]' : '[NEW]'
                const agent = s.original_agent_type || 'unknown'
                const modified = s.last_activity && !isNaN(new Date(s.last_activity).getTime()) ? new Date(s.last_activity).toLocaleString() : 'never'
                const name = s.display_name || s.name
                return `${reviewed} ${name} - Agent: ${agent}, Modified: ${modified}`
              }
            })
            
            const filterLabel = listArgs.filter ? ` (${listArgs.filter})` : ''
            result = `Sessions${filterLabel} (${sessions.length}):\n${lines.join('\n')}`
          }
        }
        break
      }

      case "schaltwerk_send_message": {
        const sendMessageArgs = args as unknown as SchaltwerkSendMessageArgs
        
        await bridge.sendFollowUpMessage(
          sendMessageArgs.session_name,
          sendMessageArgs.message
        )
        
        result = `Message sent to session '${sendMessageArgs.session_name}': ${sendMessageArgs.message}`
        break
      }

      case "schaltwerk_cancel": {
        const cancelArgs = args as unknown as SchaltwerkCancelArgs
        
        await bridge.cancelSession(cancelArgs.session_name, cancelArgs.force)
        
        result = `Session '${cancelArgs.session_name}' has been cancelled and removed`
        break
      }

      case "schaltwerk_pause": {
        const pauseArgs = args as unknown as SchaltwerkPauseArgs
        
        await bridge.pauseSession(pauseArgs.session_name)
        
        result = `Session '${pauseArgs.session_name}' has been paused (all work preserved)`
        break
      }

      case "schaltwerk_spec_create": {
        const specCreateArgs = args as SchaltwerkSpecCreateArgs

        const session = await bridge.createSpecSession(
          specCreateArgs.name || `spec_${Date.now()}`,
          specCreateArgs.content,
          specCreateArgs.base_branch
        )

        result = `Spec session created successfully:
- Name: ${session.name}
- Branch: ${session.branch} (will be created when started)
- Base Branch: ${session.parent_branch}
- Content Length: ${session.draft_content?.length || 0} characters
- Status: Spec (ready for refinement)`
        break
      }

      case "schaltwerk_draft_update": {
        const draftUpdateArgs = args as unknown as SchaltwerkDraftUpdateArgs
        
        await bridge.updateDraftContent(
          draftUpdateArgs.session_name,
          draftUpdateArgs.content,
          draftUpdateArgs.append
        )
        
        const contentPreview = draftUpdateArgs.content.length > 100 
          ? draftUpdateArgs.content.substring(0, 100) + '...'
          : draftUpdateArgs.content
        
        result = `Spec '${draftUpdateArgs.session_name}' updated successfully.
- Update Mode: ${draftUpdateArgs.append ? 'Append' : 'Replace'}
- Content Preview: ${contentPreview}`
        break
      }

      case "schaltwerk_current_spec_update": {
        const currentSpecUpdateArgs = args as unknown as SchaltwerkCurrentSpecUpdateArgs
        
        // Get the currently active spec in Spec Mode
        const currentSpec = await bridge.getCurrentSpecModeSession()
        if (!currentSpec) {
          result = 'Spec mode session tracking not yet implemented. Please use schaltwerk_draft_update with explicit session name instead.\n\nAlternatively, check available specs with schaltwerk_draft_list first.'
          break
        }
        
        await bridge.updateDraftContent(
          currentSpec,
          currentSpecUpdateArgs.content,
          currentSpecUpdateArgs.append
        )
        
        const contentPreview = currentSpecUpdateArgs.content.length > 100 
          ? currentSpecUpdateArgs.content.substring(0, 100) + '...'
          : currentSpecUpdateArgs.content
        
        result = `Current spec '${currentSpec}' updated successfully.
- Update Mode: ${currentSpecUpdateArgs.append ? 'Append' : 'Replace'}
- Content Preview: ${contentPreview}`
        break
      }

      case "schaltwerk_draft_start": {
        const draftStartArgs = args as unknown as SchaltwerkDraftStartArgs
        
        await bridge.startDraftSession(
          draftStartArgs.session_name,
          draftStartArgs.agent_type,
          draftStartArgs.skip_permissions,
          draftStartArgs.base_branch
        )
        
        result = `Spec '${draftStartArgs.session_name}' started successfully:
- Agent Type: ${draftStartArgs.agent_type || 'claude'}
- Skip Permissions: ${draftStartArgs.skip_permissions || false}
- Status: Active (worktree created, agent ready)`
        break
      }

      case "schaltwerk_draft_list": {
        const draftListArgs = args as SchaltwerkDraftListArgs
        
        const specs = await bridge.listDraftSessions()
        
        if (draftListArgs.json) {
          const essentialDrafts = specs.map(d => ({
            name: d.name,
            display_name: d.display_name || d.name,
            created_at: d.created_at ? new Date(d.created_at).toISOString() : null,
            updated_at: d.updated_at ? new Date(d.updated_at).toISOString() : null,
            base_branch: d.parent_branch,
            content_length: d.draft_content?.length || 0,
            content_preview: d.draft_content?.substring(0, 200) || ''
          }))
          result = JSON.stringify(essentialDrafts, null, 2)
        } else {
          if (specs.length === 0) {
            result = 'No spec sessions found'
          } else {
            const lines = specs.map((d: Session) => {
              const name = d.display_name || d.name
              const created = d.created_at ? new Date(d.created_at).toLocaleDateString() : 'unknown'
              const updated = d.updated_at ? new Date(d.updated_at).toLocaleDateString() : 'unknown'
              const contentLength = d.draft_content?.length || 0
              const preview = d.draft_content?.substring(0, 50)?.replace(/\n/g, ' ') || '(empty)'
              
              return `${name}:
  - Created: ${created}, Updated: ${updated}
  - Content: ${contentLength} chars
  - Preview: ${preview}${contentLength > 50 ? '...' : ''}`
            })
            
            result = `Spec Sessions (${specs.length}):\n\n${lines.join('\n\n')}`
          }
        }
        break
      }

      case "schaltwerk_draft_delete": {
        const draftDeleteArgs = args as unknown as SchaltwerkDraftDeleteArgs
        
        await bridge.deleteDraftSession(draftDeleteArgs.session_name)
        
        result = `Spec session '${draftDeleteArgs.session_name}' has been deleted permanently`
        break
      }

      case "schaltwerk_get_current_tasks": {
        const taskArgs = args as {
          fields?: string[],
          status_filter?: 'spec' | 'active' | 'reviewed' | 'all',
          content_preview_length?: number
        }
        
        // Default to minimal fields if not specified
        const requestedFields = taskArgs.fields || ['name', 'status', 'session_state', 'branch']
        const includeAll = requestedFields.includes('all')
        
        let agents = await bridge.getCurrentTasks()
        
        // Apply status filter
        if (taskArgs.status_filter && taskArgs.status_filter !== 'all') {
          agents = agents.filter(t => {
            switch (taskArgs.status_filter) {
              case 'spec':
                return t.status === 'spec'
              case 'active':
                return t.status !== 'spec' && !t.ready_to_merge
              case 'reviewed':
                return t.ready_to_merge === true
              default:
                return true
            }
          })
        }
        
        // Build response with only requested fields
        const formattedTasks = agents.map(t => {
          const agent: Record<string, unknown> = {
            name: t.name // Always include name
          }
          
          // Add requested fields
          if (includeAll || requestedFields.includes('display_name')) {
            agent.display_name = t.display_name || t.name
          }
          if (includeAll || requestedFields.includes('status')) {
            agent.status = t.status
          }
          if (includeAll || requestedFields.includes('session_state')) {
            agent.session_state = t.session_state
          }
          if (includeAll || requestedFields.includes('created_at')) {
            agent.created_at = t.created_at ? new Date(t.created_at).toISOString() : null
          }
          if (includeAll || requestedFields.includes('last_activity')) {
            agent.last_activity = t.last_activity ? new Date(t.last_activity).toISOString() : null
          }
          if (includeAll || requestedFields.includes('branch')) {
            agent.branch = t.branch
          }
          if (includeAll || requestedFields.includes('worktree_path')) {
            agent.worktree_path = t.worktree_path
          }
          if (includeAll || requestedFields.includes('ready_to_merge')) {
            agent.ready_to_merge = t.ready_to_merge || false
          }
          
          // Handle content fields with optional preview
          if (includeAll || requestedFields.includes('initial_prompt')) {
            let prompt = t.initial_prompt || null
            if (prompt && taskArgs.content_preview_length && prompt.length > taskArgs.content_preview_length) {
              prompt = prompt.substring(0, taskArgs.content_preview_length) + '...'
            }
            agent.initial_prompt = prompt
          }
          
          if (includeAll || requestedFields.includes('draft_content')) {
            let content = t.draft_content || null
            if (content && taskArgs.content_preview_length && content.length > taskArgs.content_preview_length) {
              content = content.substring(0, taskArgs.content_preview_length) + '...'
            }
            agent.draft_content = content
          }
          
          return agent
        })
        
        result = JSON.stringify(formattedTasks, null, 2)
        break
       }

       case "schaltwerk_mark_session_reviewed": {
         const markReviewedArgs = args as unknown as SchaltwerkMarkReviewedArgs

         await bridge.markSessionReviewed(markReviewedArgs.session_name)

         result = `Session '${markReviewedArgs.session_name}' has been marked as reviewed and is ready for merge`
         break
       }

       case "schaltwerk_convert_to_spec": {
         const convertToSpecArgs = args as unknown as SchaltwerkConvertToSpecArgs

         await bridge.convertToSpec(convertToSpecArgs.session_name)

         result = `Session '${convertToSpecArgs.session_name}' has been converted back to spec state for rework`
         break
       }

       default:
         throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
    }

    return {
      content: [
        {
          type: "text",
          text: result
        }
      ]
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`)
  }
})

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "schaltwerk://sessions",
        name: "Schaltwerk Sessions",
        description: "List of all active Schaltwerk sessions with full metadata",
        mimeType: "application/json"
      },
      {
        uri: "schaltwerk://sessions/reviewed",
        name: "Reviewed Sessions",
        description: "Sessions marked as ready to merge",
        mimeType: "application/json"
      },
      {
        uri: "schaltwerk://sessions/new",
        name: "New Sessions",
        description: "Sessions not yet reviewed",
        mimeType: "application/json"
      },
      {
        uri: "schaltwerk://specs",
        name: "Spec Sessions",
        description: "All spec sessions awaiting refinement and start",
        mimeType: "application/json"
      },
      {
        uri: "schaltwerk://specs/{name}",
        name: "Spec Content",
        description: "Content of a specific spec session",
        mimeType: "text/markdown"
      }
    ]
  }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request: { params: { uri: string } }) => {
  const { uri } = request.params

  try {
    let content: string

    switch (uri) {
      case "schaltwerk://sessions": {
        const sessions = await bridge.listSessions()
        content = JSON.stringify(sessions, null, 2)
        break
      }

      case "schaltwerk://sessions/reviewed": {
        const sessions = await bridge.listSessions()
        const reviewed = sessions.filter(s => s.ready_to_merge)
        content = JSON.stringify(reviewed, null, 2)
        break
      }

      case "schaltwerk://sessions/new": {
        const sessions = await bridge.listSessions()
        const newSessions = sessions.filter(s => !s.ready_to_merge)
        content = JSON.stringify(newSessions, null, 2)
        break
      }

      case "schaltwerk://specs": {
        const specs = await bridge.listDraftSessions()
        content = JSON.stringify(specs, null, 2)
        break
      }

      default: {
        // Check if it's a specific spec content request
        const draftMatch = uri.match(/^schaltwerk:\/\/specs\/(.+)$/)
        if (draftMatch) {
          const draftName = draftMatch[1]
          const specs = await bridge.listDraftSessions()
          const spec = specs.find(d => d.name === draftName)
          
          if (!spec) {
            throw new McpError(ErrorCode.InvalidRequest, `Spec '${draftName}' not found`)
          }
          
          return {
            contents: [
              {
                uri,
                mimeType: "text/markdown",
                text: spec.draft_content || ''
              }
            ]
          }
        }
        
        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`)
      }
    }

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: content
        }
      ]
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new McpError(ErrorCode.InternalError, `Resource read failed: ${errorMessage}`)
  }
})

async function main(): Promise<void> {
  // Connect to database on startup
  // Bridge no longer needs connection - it's stateless
  
  const transport = new StdioServerTransport()
  await server.connect(transport)
  
  console.error("Schaltwerk MCP server running")
  console.error(`Project path: ${process.env.SCHALTWERK_PROJECT_PATH || 'auto-detected from git root'}`)
  console.error("Connected to database, ready to manage sessions")
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    // Bridge no longer needs disconnection - it's stateless
    process.exit(0)
  })
  
  process.on('SIGTERM', async () => {
    // Bridge no longer needs disconnection - it's stateless
    process.exit(0)
  })
}

main().catch(console.error)
