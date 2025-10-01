pub mod agent_binaries;
pub mod clipboard;
pub mod github;
pub mod mcp;
pub mod mcp_config;
pub mod project;
pub mod pty;
pub mod schaltwerk_core;
pub mod session_lookup_cache;
pub mod sessions_refresh;
pub mod settings;
pub mod terminal;
pub mod utility;

#[cfg(test)]
mod tests;

// Export schaltwerk_core commands individually to avoid unused import warnings
pub use agent_binaries::*;
pub use github::*;
pub use mcp::*;
pub use mcp_config::*;
pub use project::*;
pub use pty::*;
pub use schaltwerk_core::{
    schaltwerk_core_append_spec_content, schaltwerk_core_archive_spec_session,
    schaltwerk_core_cancel_session, schaltwerk_core_cleanup_orphaned_worktrees,
    schaltwerk_core_convert_session_to_draft, schaltwerk_core_create_and_start_spec_session,
    schaltwerk_core_create_session, schaltwerk_core_create_spec_session,
    schaltwerk_core_delete_archived_spec, schaltwerk_core_discard_file_in_orchestrator,
    schaltwerk_core_discard_file_in_session, schaltwerk_core_get_agent_type,
    schaltwerk_core_get_archive_max_entries, schaltwerk_core_get_font_sizes,
    schaltwerk_core_get_merge_preview, schaltwerk_core_get_orchestrator_agent_type,
    schaltwerk_core_get_orchestrator_skip_permissions, schaltwerk_core_get_session,
    schaltwerk_core_get_session_agent_content, schaltwerk_core_get_skip_permissions,
    schaltwerk_core_has_uncommitted_changes, schaltwerk_core_list_archived_specs,
    schaltwerk_core_list_enriched_sessions, schaltwerk_core_list_enriched_sessions_sorted,
    schaltwerk_core_list_project_files, schaltwerk_core_list_sessions,
    schaltwerk_core_list_sessions_by_state, schaltwerk_core_mark_session_ready,
    schaltwerk_core_merge_session_to_main, schaltwerk_core_rename_draft_session,
    schaltwerk_core_rename_version_group, schaltwerk_core_reset_orchestrator,
    schaltwerk_core_reset_session_worktree, schaltwerk_core_restore_archived_spec,
    schaltwerk_core_set_agent_type, schaltwerk_core_set_archive_max_entries,
    schaltwerk_core_set_font_sizes, schaltwerk_core_set_orchestrator_agent_type,
    schaltwerk_core_set_orchestrator_skip_permissions, schaltwerk_core_set_session_agent_type,
    schaltwerk_core_set_skip_permissions, schaltwerk_core_start_claude,
    schaltwerk_core_start_claude_orchestrator, schaltwerk_core_start_claude_with_restart,
    schaltwerk_core_start_fresh_orchestrator, schaltwerk_core_start_spec_session,
    schaltwerk_core_unmark_session_ready, schaltwerk_core_update_git_stats,
    schaltwerk_core_update_session_state, schaltwerk_core_update_spec_content,
};
pub use settings::*;
pub use terminal::*;
pub use utility::*;
