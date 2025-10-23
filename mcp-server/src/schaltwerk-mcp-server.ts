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
} from "@modelcontextprotocol/sdk/types.js"
import { SchaltwerkBridge, Session, MergeModeOption } from "./schaltwerk-bridge.js"

interface SchaltwerkStartArgs {
  name?: string
  prompt?: string
  agent_type?: 'claude' | 'opencode' | 'gemini' | 'codex' | 'qwen' | 'droid' | 'amp'
  base_branch?: string
  skip_permissions?: boolean
  is_draft?: boolean
  draft_content?: string
}

interface SchaltwerkCancelArgs {
  session_name: string
  force?: boolean
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
  agent_type?: 'claude' | 'opencode' | 'gemini' | 'codex' | 'qwen' | 'droid' | 'amp'
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

interface SchaltwerkMergeArgs {
  session_name: string
  commit_message?: string | null
  mode?: 'squash' | 'reapply'
  cancel_after_merge?: boolean
}

interface SchaltwerkCreatePrArgs {
  session_name: string
  options?: {
    commit_message?: string
    default_branch?: string
    repository?: string
    cancel_after_pr?: boolean
  }
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
        description: `Create a new Schaltwerk session and matching git worktree for an AI agent. Provide a unique session name plus a specific, implementation-focused prompt; that prompt seeds the agent. Optional fields let you select agent_type (claude, opencode, gemini, codex, qwen, droid), choose a base_branch, or bypass manual permission prompts when you understand the risk. Use this whenever you need a fresh, isolated development branch.`,
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
            enum: ["claude", "opencode", "gemini", "codex", "qwen", "droid", "amp"],
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
        description: `List Schaltwerk sessions for quick status checks. Default output is a readable summary; set json: true for structured fields (name, status, timestamps, agent_type, branch, prompts). Use filter to focus on all, active, spec, or reviewed sessions. Treat reviewed sessions as protected; only cancel them after a successful merge and passing tests.`,
        inputSchema: {
          type: "object",
          properties: {
            json: {
              type: "boolean",
              description: "Return structured JSON data instead of formatted text",
              default: false
            },
            filter: {
              type: "string",
              enum: ["all", "active", "spec", "reviewed"],
              description: "Limit results to a subset of sessions",
              default: "all"
            }
          },
          additionalProperties: false
        }
      },
      {
        name: "schaltwerk_send_message",
        description: `Push a follow-up message into an existing session's agent terminal. The session must exist and be running; the server validates this before sending. Messages queue until the terminal is ready, so you can safely issue reminders or extra instructions.`,
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
        description: `Cancel a session by deleting its worktree and branch. The server blocks the operation if uncommitted changes are present; pass force: true to override (irreversible and drops unstaged work). Only use after the session has been merged and validated. Reviewed sessions should almost always stay; if uncertain, use schaltwerk_convert_to_spec to preserve the work.`,
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
        name: "schaltwerk_spec_create",
        description: `Create a spec session for planning (no worktree yet). Provide optional name, Markdown content, and base_branch. Refine the draft with schaltwerk_draft_update and start it with schaltwerk_draft_start when the plan is ready.`,
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
        description: `Replace or append Markdown content on an existing spec session. Leave append false to overwrite the draft or set it true to add on. Use this for iterative refinement before starting the agent.`,
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
        description: `Update the spec currently open in Spec Mode without naming it explicitly. Works only when Spec Mode has a selected draft. Set append true to add text instead of replacing it.`,
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
        name: "schaltwerk_spec_list",
        description: `List available specs with content length and last update time. Useful for spotting stale or empty drafts before starting them.`,
        inputSchema: {
          type: "object",
          additionalProperties: false
        }
      },
      {
        name: "schaltwerk_spec_read",
        description: `Fetch the full markdown content for a spec session by id or name.`,
        inputSchema: {
          type: "object",
          properties: {
            session: {
              type: "string",
              description: "Spec session id or name to read"
            }
          },
          required: ["session"],
          additionalProperties: false
        }
      },
      {
        name: "schaltwerk_diff_summary",
        description: `List changed files for a session (or orchestrator when session is omitted) using merge-base(HEAD, parent_branch) semantics. Supports pagination through cursor and page_size and mirrors the desktop diff summary.` ,
        inputSchema: {
          type: "object",
          properties: {
            session: {
              type: "string",
              description: "Optional session id or name to target"
            },
            cursor: {
              type: "string",
              description: "Opaque cursor returned from a previous call"
            },
            page_size: {
              type: "number",
              description: "Maximum number of files to return (default 100)",
              minimum: 1
            }
          },
          additionalProperties: false
        }
      },
      {
        name: "schaltwerk_diff_chunk",
        description: `Fetch unified diff lines for a file. Large diffs paginate via cursor, follow the same merge-base rules as the desktop app, and binaries return an empty list automatically.`,
        inputSchema: {
          type: "object",
          properties: {
            session: {
              type: "string",
              description: "Optional session id or name to target"
            },
            path: {
              type: "string",
              description: "Repository-relative path to the file",
            },
            cursor: {
              type: "string",
              description: "Cursor returned from a previous chunk request"
            },
            line_limit: {
              type: "number",
              description: "Maximum number of diff lines to return (default 400, max 1000)",
              minimum: 1
            }
          },
          required: ["path"],
          additionalProperties: false
        }
      },
      {
        name: "schaltwerk_session_spec",
        description: `Fetch spec markdown (and the last updated timestamp) for a running session by id or name.`,
        inputSchema: {
          type: "object",
          properties: {
            session: {
              type: "string",
              description: "Session id or name"
            }
          },
          required: ["session"],
          additionalProperties: false
        }
      },
      {
        name: "schaltwerk_draft_start",
        description: `Start an AI agent from an existing spec. This creates the session's worktree from the chosen base_branch, launches the selected agent with the spec content as its prompt, and moves the session to running state. Once started, you must use schaltwerk_convert_to_spec if you later need to re-draft.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Name of the spec session to start"
            },
            agent_type: {
            type: "string",
            enum: ["claude", "opencode", "gemini", "codex", "qwen", "droid", "amp"],
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
        description: `List all spec sessions in chronological order. Default output is human readable; set json: true for machine parsing with content length and timestamps so you can pick the right draft to start next.`,
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
        description: `Delete a spec record permanently (specs have no worktree, but the draft content is lost). Use only for obsolete plans and confirm with the user when unsure.`,
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
        description: `Mark a running session as reviewed and ready_to_merge. The worktree stays intact for verification, but the session is now protected; only cancel it after a successful merge and green tests.`,
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
        description: `Convert a running or reviewed session back into a spec for rework. The worktree is removed but the branch and commits remain, so you can refine the plan and restart it with schaltwerk_draft_start.`,
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
        name: "schaltwerk_merge_session",
        description: `Merge a reviewed session back onto its parent branch using the same pipeline as the desktop app. Run this only after the session is reviewed, clean, and tests are green. Optional parameters select the merge mode (squash or reapply), supply the squash commit_message, and request cancel_after_merge to queue worktree cleanup. The tool rejects spec sessions, unresolved conflicts, and empty merges, and it never runs tests for you.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Reviewed session to merge back into its parent branch."
            },
            commit_message: {
              type: "string",
              description: "Commit message for the squash merge commit; include the session slug and a concise summary. Required when mode is 'squash'."
            },
            mode: {
              type: "string",
              enum: ["squash", "reapply"],
              description: "Merge strategy. Defaults to 'squash' for a single review commit."
            },
            cancel_after_merge: {
              type: "boolean",
              description: "Queue session cancellation after a successful merge (default false)."
            }
          },
          required: ["session_name"]
        }
      },
      {
        name: "schaltwerk_create_pr",
        description: `Push a session branch and open or update a GitHub PR through the GitHub CLI integration. Make sure \`gh\` is authenticated and the branch is ready; the command will auto-commit staged files if required. Optional settings adjust the commit_message, default_branch, target repository, or queue cancel_after_pr to remove the worktree after the PR succeeds. Spec sessions are not eligible for PR creation.`,
        inputSchema: {
          type: "object",
          properties: {
            session_name: {
              type: "string",
              description: "Reviewed session to push and open a pull request for."
            },
            options: {
              type: "object",
              description: "Optional overrides for PR creation (all keys optional).",
              properties: {
                commit_message: {
                  type: "string",
                  description: "Commit message used if uncommitted changes must be committed before pushing."
                },
                default_branch: {
                  type: "string",
                  description: "Override the repository default branch (e.g. 'main', 'develop')."
                },
                repository: {
                  type: "string",
                  description: "Target GitHub repository in owner/name form if it differs from the connected repo."
                },
                cancel_after_pr: {
                  type: "boolean",
                  description: "Queue session cancellation after the PR is created (default false)."
                }
              }
            }
          },
          required: ["session_name"]
        }
      },
      {
        name: "schaltwerk_get_current_tasks",
        description: `Return the active Schaltwerk agents with controllable verbosity. Use fields to request only the properties you need (defaults to a minimal set), status_filter to limit by session state, and content_preview_length to trim large text when including draft_content or initial_prompt. Helpful for keeping responses lightweight while still exposing full session metadata on demand.`,
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
    let resultMimeType: string | undefined

    switch (name) {
      case "schaltwerk_spec_list": {
        const payload = await bridge.listSpecSummaries()
        result = JSON.stringify({ specs: payload }, null, 2)
        resultMimeType = "application/json"
        break
      }

      case "schaltwerk_spec_read": {
        const specArgs = args as { session?: string }
        if (!specArgs.session || specArgs.session.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'session' is required when invoking schaltwerk_spec_read.")
        }
        const payload = await bridge.getSpecDocument(specArgs.session)
        result = JSON.stringify(payload, null, 2)
        resultMimeType = "application/json"
        break
      }

      case "schaltwerk_diff_summary": {
        const diffArgs = args as { session?: string; cursor?: string; page_size?: number }
        const payload = await bridge.getDiffSummary({
          session: diffArgs.session,
          cursor: diffArgs.cursor,
          pageSize: diffArgs.page_size,
        })
        result = JSON.stringify(payload, null, 2)
        resultMimeType = "application/json"
        break
      }

      case "schaltwerk_diff_chunk": {
        const diffArgs = args as { session?: string; path?: string; cursor?: string; line_limit?: number }
        if (!diffArgs.path || diffArgs.path.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'path' is required when invoking schaltwerk_diff_chunk.")
        }

        const cappedLineLimit = diffArgs.line_limit !== undefined
          ? Math.min(diffArgs.line_limit, 1000)
          : undefined

        const payload = await bridge.getDiffChunk({
          session: diffArgs.session,
          path: diffArgs.path,
          cursor: diffArgs.cursor,
          lineLimit: cappedLineLimit,
        })
        result = JSON.stringify(payload, null, 2)
        resultMimeType = "application/json"
        break
      }

      case "schaltwerk_session_spec": {
        const specArgs = args as { session: string }
        if (!specArgs.session || specArgs.session.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "'session' is required when invoking schaltwerk_session_spec.")
        }
        const payload = await bridge.getSessionSpec(specArgs.session)
        result = JSON.stringify(payload, null, 2)
        resultMimeType = "application/json"
        break
      }

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
- Agent: ${createArgs.agent_type || 'claude'}
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
          if (includeAll || requestedFields.includes('agent_type')) {
            agent.agent_type = t.original_agent_type || 'claude'
          }
          if (includeAll || requestedFields.includes('skip_permissions')) {
            agent.skip_permissions = t.original_skip_permissions ?? null
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

      case "schaltwerk_merge_session": {
        const mergeArgs = args as unknown as SchaltwerkMergeArgs

        if (!mergeArgs.session_name || typeof mergeArgs.session_name !== 'string') {
          throw new Error('session_name is required when invoking schaltwerk_merge_session.')
        }

        const requestedMode: MergeModeOption = mergeArgs.mode === 'reapply' ? 'reapply' : 'squash'
        const trimmedCommit = mergeArgs.commit_message?.trim() ?? ''

        if (requestedMode === 'squash' && trimmedCommit.length === 0) {
          throw new Error('commit_message is required and cannot be empty when performing a squash merge via schaltwerk_merge_session.')
        }

        const mergeResult = await bridge.mergeSession(mergeArgs.session_name, {
          commitMessage: trimmedCommit.length > 0 ? trimmedCommit : undefined,
          mode: requestedMode,
          cancelAfterMerge: mergeArgs.cancel_after_merge
        })

        const cancelLine = mergeResult.cancelRequested
          ? (mergeResult.cancelQueued
              ? '- Session cancellation queued (cleanup runs asynchronously).'
              : `- Cancellation requested but failed: ${mergeResult.cancelError ?? 'unknown error'}`)
          : '- Session retained (cancel_after_merge=false).'

        result = `Merge completed for '${mergeArgs.session_name}':
- Merge mode: ${mergeResult.mode}
- Parent branch: ${mergeResult.parentBranch}
- Session branch: ${mergeResult.sessionBranch}
- Merge commit: ${mergeResult.commit}
${cancelLine}`
        break
      }

      case "schaltwerk_create_pr": {
        const prArgs = args as unknown as SchaltwerkCreatePrArgs

        if (!prArgs.session_name || typeof prArgs.session_name !== 'string') {
          throw new Error('session_name is required when invoking schaltwerk_create_pr.')
        }

        const prOptions = prArgs.options ?? {}

        const prResult = await bridge.createPullRequest(prArgs.session_name, {
          commitMessage: prOptions.commit_message,
          defaultBranch: prOptions.default_branch,
          repository: prOptions.repository,
          cancelAfterPr: prOptions.cancel_after_pr
        })

        const urlLine = prResult.url && prResult.url.length > 0
          ? `- Pull request URL: ${prResult.url}`
          : '- GitHub CLI opened the PR form in a browser (no URL returned).'

        const cancelLine = prResult.cancelRequested
          ? (prResult.cancelQueued
              ? '- Session cancellation queued (cleanup runs asynchronously).'
              : `- Cancellation requested but failed: ${prResult.cancelError ?? 'unknown error'}`)
          : '- Session retained (cancel_after_pr=false).'

        result = `Pull request workflow completed for '${prArgs.session_name}':
- Branch pushed: ${prResult.branch}
${urlLine}
${cancelLine}`
        break
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
    }

    const contentEntry: { type: string; text: string; mimeType?: string } = {
      type: "text",
      text: result
    }
    if (resultMimeType) {
      contentEntry.mimeType = resultMimeType
    }

    return {
      content: [contentEntry]
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
