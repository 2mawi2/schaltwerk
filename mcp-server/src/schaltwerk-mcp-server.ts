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
} from "@modelcontextprotocol/sdk/types.js"
import { SchaltwerkBridge, Session } from "./schaltwerk-bridge.js"

interface SchaltwerkStartArgs {
  name?: string
  prompt?: string
  agent_type?: 'claude' | 'cursor' | 'opencode'
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
  filter?: 'all' | 'active' | 'plan' | 'reviewed'
}

interface SchaltwerkSendMessageArgs {
  session_name: string
  message: string
}

interface SchaltwerkDraftCreateArgs {
  name?: string
  content?: string
  base_branch?: string
}

interface SchaltwerkDraftUpdateArgs {
  session_name: string
  content: string
  append?: boolean
}

interface SchaltwerkDraftStartArgs {
  session_name: string
  agent_type?: 'claude' | 'cursor' | 'opencode'
  skip_permissions?: boolean
  base_branch?: string
}

interface SchaltwerkDraftListArgs {
  json?: boolean
}

interface SchaltwerkDraftDeleteArgs {
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

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "schaltwerk_create",
        description: `Create a new Schaltwerk session for development work.

🎯 PURPOSE: Start new isolated Git worktrees for development agents with AI assistance.

📋 USAGE:
- Basic: schaltwerk_create(name: "feature-auth", prompt: "implement user authentication")
- With agent type: schaltwerk_create(name: "api-feature", prompt: "add REST API", agent_type: "cursor")
- With base branch: schaltwerk_create(name: "fix-bug", prompt: "fix login issue", base_branch: "develop")
- Skip permissions: schaltwerk_create(name: "quick-fix", prompt: "fix typo", skip_permissions: true)

🤖 AGENT TYPES:
- 'claude': Use Claude AI assistant (default)
- 'cursor': Use Cursor IDE integration

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
              enum: ["claude", "cursor"],
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
- agent_type: "claude" | "cursor"
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
- Cleaning up sessions that are fully committed
- Removing experimental branches with no valuable work
- After work has been merged elsewhere

❌ WHEN NOT TO USE:
- If session has uncommitted work you want to keep
- Without first checking what work would be lost
- If you're unsure about the session's state

🛡️ SAFER ALTERNATIVES:
- 'schaltwerk_pause': Archive session without deletion
- Commit your work first, then cancel
- Use 'schaltwerk_finish' to properly complete and merge work`,
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

🔄 TO RESUME:
- Session remains available in schaltwerk_list
- Worktree and branch are preserved
- Can continue work exactly where you left off

💡 This is the RECOMMENDED way to stop working on a session without losing progress.`,
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
        name: "schaltwerk_draft_create",
        description: `Create a new plan session for later refinement and execution.

🎯 PURPOSE: Create plan sessions to collaborate on agent descriptions before starting agents.

📋 USAGE:
- Basic: schaltwerk_draft_create(name: "auth-feature", content: "# Authentication\\n\\nImplement user login")
- Without content: schaltwerk_draft_create(name: "bug-fix")
- With base branch: schaltwerk_draft_create(name: "hotfix", content: "Fix critical bug", base_branch: "production")

✏️ PLANS:
- Plans are lightweight planning sessions
- No worktree created until plan is started
- Content can be refined multiple times
- Convert to active session when ready

📝 CONTENT FORMAT:
- Use Markdown for structured agent descriptions
- Include requirements, technical details, acceptance criteria
- More detail leads to better AI agent results

⚡ WORKFLOW:
1. Create plan with initial idea
2. Refine content as needed (schaltwerk_draft_update)
3. Start when ready (schaltwerk_draft_start)`,
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Plan session name (alphanumeric, hyphens, underscores). Auto-generated if not provided."
            },
            content: {
              type: "string",
              description: "Initial plan content in Markdown format. Can be updated later."
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
        description: `Update content of an existing plan session.

🎯 PURPOSE: Refine and improve plan content before starting an agent.

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
              description: "Name of the plan session to update"
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
        name: "schaltwerk_draft_start",
        description: `Start a plan session with an AI agent.

🎯 PURPOSE: Convert a refined plan into an active development session.

📋 USAGE:
- Basic: schaltwerk_draft_start(session_name: "auth-feature")
- With agent: schaltwerk_draft_start(session_name: "auth-feature", agent_type: "claude")
- Skip permissions: schaltwerk_draft_start(session_name: "quick-fix", skip_permissions: true)
- Override branch: schaltwerk_draft_start(session_name: "hotfix", base_branch: "production")

🤖 AGENT TYPES:
- 'claude': Claude AI assistant (default)
- 'cursor': Cursor IDE integration
- 'opencode': OpenCode assistant

⚡ WHAT HAPPENS:
1. Creates Git worktree from base branch
2. Starts selected AI agent with plan content
3. Plan content becomes initial prompt
4. Session transitions to active state

⚠️ IMPORTANT: Once started, plan cannot be reverted to plan state.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the plan session to start"
            },
            agent_type: {
              type: "string",
              enum: ["claude", "cursor", "opencode"],
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
        description: `List all plan sessions.

📊 OUTPUT:
- Shows all plan sessions with content preview
- Ordered by last update time (newest first)
- Includes creation time and content length

📋 USAGE:
- Text format: schaltwerk_draft_list()
- JSON format: schaltwerk_draft_list(json: true)

💡 Use this to review plans before starting them.`,
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
        description: `Delete a plan session permanently.

⚠️ DESTRUCTIVE OPERATION
- Permanently removes plan from database
- Cannot be undone
- No worktree to clean up (plans don't create worktrees)

📋 USAGE:
schaltwerk_draft_delete(session_name: "old-plan")

✅ SAFE TO USE: Only affects database record, no files or branches.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the plan session to delete"
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
- status: 'active' | 'plan' | 'cancelled' | 'paused'
- session_state: 'Plan' | 'Running' | 'Reviewed'
- created_at: ISO timestamp
- last_activity: ISO timestamp
- branch: Git branch name
- worktree_path: Local directory path
- ready_to_merge: Boolean for review status
- initial_prompt: Original agent description (can be large)
- draft_content: Full plan content (can be VERY large)

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
  status_filter: "plan",
  content_preview_length: 200
)
Use when: Browsing plans to find the right one to start

4️⃣ FULL DETAILS (use sparingly):
schaltwerk_get_current_tasks(fields: ["all"])
Use when: Need complete information for specific analysis

⚠️ PERFORMANCE TIPS:
- Never request 'draft_content' or 'initial_prompt' unless needed
- Use status_filter to reduce dataset size
- Use content_preview_length for plan browsing
- Default fields are optimized for common operations

🎯 FILTERING:
- status_filter: Filter by status ('plan', 'active', 'reviewed')
- Reduces response size by excluding irrelevant agents

💡 BEST PRACTICES:
- Start with minimal fields, add more if needed
- Use filters to focus on relevant agents
- Request content fields only when examining specific agents`,
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
              enum: ["plan", "active", "reviewed", "all"],
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    let result: string

    switch (name) {
      case "schaltwerk_create": {
        const createArgs = args as SchaltwerkStartArgs
        
        if (createArgs.is_draft) {
          const session = await bridge.createDraftSession(
            createArgs.name || `draft_${Date.now()}`,
            createArgs.draft_content || createArgs.prompt,
            createArgs.base_branch
          )
          
          result = `Plan session created successfully:
- Name: ${session.name}
- Branch: ${session.branch} (will be created when started)
- Base Branch: ${session.parent_branch}
- Content Length: ${session.draft_content?.length || 0} characters
- Status: Plan (ready for refinement)`
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
            status: s.status === 'plan' ? 'plan' : (s.ready_to_merge ? 'reviewed' : 'new'),
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
              if (s.status === 'plan') {
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

      case "schaltwerk_draft_create": {
        const draftCreateArgs = args as SchaltwerkDraftCreateArgs
        
        const session = await bridge.createDraftSession(
          draftCreateArgs.name || `draft_${Date.now()}`,
          draftCreateArgs.content,
          draftCreateArgs.base_branch
        )
        
        result = `Plan session created successfully:
- Name: ${session.name}
- Branch: ${session.branch} (will be created when started)
- Base Branch: ${session.parent_branch}
- Content Length: ${session.draft_content?.length || 0} characters
- Status: Plan (ready for refinement)`
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
        
        result = `Plan '${draftUpdateArgs.session_name}' updated successfully.
- Update Mode: ${draftUpdateArgs.append ? 'Append' : 'Replace'}
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
        
        result = `Plan '${draftStartArgs.session_name}' started successfully:
- Agent Type: ${draftStartArgs.agent_type || 'claude'}
- Skip Permissions: ${draftStartArgs.skip_permissions || false}
- Status: Active (worktree created, agent ready)`
        break
      }

      case "schaltwerk_draft_list": {
        const draftListArgs = args as SchaltwerkDraftListArgs
        
        const plans = await bridge.listDraftSessions()
        
        if (draftListArgs.json) {
          const essentialDrafts = plans.map(d => ({
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
          if (plans.length === 0) {
            result = 'No plan sessions found'
          } else {
            const lines = plans.map((d: Session) => {
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
            
            result = `Plan Sessions (${plans.length}):\n\n${lines.join('\n\n')}`
          }
        }
        break
      }

      case "schaltwerk_draft_delete": {
        const draftDeleteArgs = args as unknown as SchaltwerkDraftDeleteArgs
        
        await bridge.deleteDraftSession(draftDeleteArgs.session_name)
        
        result = `Plan session '${draftDeleteArgs.session_name}' has been deleted permanently`
        break
      }

      case "schaltwerk_get_current_tasks": {
        const taskArgs = args as {
          fields?: string[],
          status_filter?: 'plan' | 'active' | 'reviewed' | 'all',
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
              case 'plan':
                return t.status === 'plan'
              case 'active':
                return t.status !== 'plan' && !t.ready_to_merge
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
        uri: "schaltwerk://plans",
        name: "Plan Sessions",
        description: "All plan sessions awaiting refinement and start",
        mimeType: "application/json"
      },
      {
        uri: "schaltwerk://plans/{name}",
        name: "Plan Content",
        description: "Content of a specific plan session",
        mimeType: "text/markdown"
      }
    ]
  }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
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

      case "schaltwerk://plans": {
        const plans = await bridge.listDraftSessions()
        content = JSON.stringify(plans, null, 2)
        break
      }

      default: {
        // Check if it's a specific plan content request
        const draftMatch = uri.match(/^schaltwerk:\/\/plans\/(.+)$/)
        if (draftMatch) {
          const draftName = draftMatch[1]
          const plans = await bridge.listDraftSessions()
          const plan = plans.find(d => d.name === draftName)
          
          if (!plan) {
            throw new McpError(ErrorCode.InvalidRequest, `Plan '${draftName}' not found`)
          }
          
          return {
            contents: [
              {
                uri,
                mimeType: "text/markdown",
                text: plan.draft_content || ''
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