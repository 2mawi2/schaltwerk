export const TAURI_COMMANDS = {
  // MCP Configuration Commands
  MCP_GET_STATUS: 'get_mcp_status',
  MCP_CONFIGURE_PROJECT: 'configure_mcp_for_project', 
  MCP_REMOVE_PROJECT: 'remove_mcp_for_project',
  MCP_ENSURE_GITIGNORED: 'ensure_mcp_gitignored',
  
  // Session Management Commands
  SCHALTWERK_CORE_LIST_ENRICHED_SESSIONS: 'schaltwerk_core_list_enriched_sessions',
  SCHALTWERK_CORE_CREATE_SESSION: 'schaltwerk_core_create_session',
  SCHALTWERK_CORE_DELETE_SESSION: 'schaltwerk_core_delete_session',
  SCHALTWERK_CORE_CANCEL_SESSION: 'schaltwerk_core_cancel_session',
  SCHALTWERK_CORE_START_SPEC_SESSION: 'schaltwerk_core_start_spec_session',
  
  // Git Commands  
  GET_CURRENT_BRANCH_NAME: 'get_current_branch_name',
  GET_GIT_DIFF: 'get_git_diff',
  GET_GIT_COMMIT_DIFF: 'get_git_commit_diff',
  
  // Project Settings
  GET_PROJECT_SESSIONS_SETTINGS: 'get_project_sessions_settings',
  SET_PROJECT_SESSIONS_SETTINGS: 'set_project_sessions_settings',
  
  // Development Info
  GET_DEVELOPMENT_INFO: 'get_development_info'
} as const

export type TauriCommand = typeof TAURI_COMMANDS[keyof typeof TAURI_COMMANDS]