pub mod mcp;
pub mod power;
pub mod projects;
pub mod sessions;
pub mod terminals;

use mcp::{McpService as McpServiceTrait, McpServiceImpl, ProcessMcpBackend};
use projects::{
    ProjectManagerBackend, ProjectsService as ProjectsServiceTrait, ProjectsServiceImpl,
};
use sessions::{
    ProjectSessionsBackend, SessionsService as SessionsServiceTrait, SessionsServiceImpl,
};
use std::sync::Arc;
use tauri::AppHandle;
use terminals::{
    TerminalManagerBackend, TerminalsService as TerminalsServiceTrait, TerminalsServiceImpl,
};

use crate::project_manager::ProjectManager;

pub use crate::domains::agents::{
    AgentLaunchSpec, manifest::AgentManifest, naming, parse_agent_command,
};
pub use crate::domains::attention::AttentionStateRegistry;
pub use crate::domains::git::{
    CommitFileChange, HistoryProviderSnapshot, get_commit_file_changes, get_git_history,
    get_git_history_with_head,
    github_cli::{
        CommandOutput, CommandRunner, CreatePrOptions, GitHubCli, GitHubCliError,
        GitHubIssueComment, GitHubIssueDetails, GitHubIssueLabel, GitHubIssueSummary,
        GitHubPrDetails, GitHubPrReviewComment, GitHubPrSummary,
    },
};
pub use crate::domains::git::{repository, worktrees};
pub use crate::domains::merge::{
    MergeMode, MergeOutcome, MergePreview, MergeService, UpdateFromParentStatus,
    UpdateSessionFromParentResult, types::MergeStateSnapshot, update_session_from_parent,
};
pub use crate::domains::power::types::GlobalState;
pub use crate::domains::sessions::db_sessions::SessionMethods;
pub use crate::domains::sessions::entity::EnrichedSession;
pub use crate::domains::sessions::entity::{
    EnrichedSession as EnrichedSessionEntity, FilterMode, Session, SessionState, SortMode,
};
pub use crate::shared::format_branch_name;
pub use crate::domains::settings::{
    AgentBinaryConfig, AgentPreference, DiffViewPreferences, McpServerConfig, SessionPreferences,
    TerminalSettings, TerminalUIPreferences,
};
pub use crate::domains::terminal::TerminalSnapshot;
pub use crate::domains::terminal::{
    build_login_shell_invocation_with_shell, get_effective_shell,
    manager::CreateTerminalWithAppAndSizeParams, sh_quote_string, shell_invocation_to_posix,
};
pub use crate::domains::workspace::get_project_files_with_status;

pub type DynSessionsService = Arc<dyn SessionsServiceTrait>;
pub type DynTerminalsService = Arc<dyn TerminalsServiceTrait>;
pub type DynProjectsService = Arc<dyn ProjectsServiceTrait>;
pub type DynMcpService = Arc<dyn McpServiceTrait>;

pub struct ServiceHandles {
    pub sessions: DynSessionsService,
    pub terminals: DynTerminalsService,
    pub projects: DynProjectsService,
    pub mcp: DynMcpService,
}

impl ServiceHandles {
    pub fn new(project_manager: Arc<ProjectManager>, app_handle: AppHandle) -> Self {
        let sessions_backend = ProjectSessionsBackend::new(Arc::clone(&project_manager));
        let terminals_backend =
            TerminalManagerBackend::new(Arc::clone(&project_manager), app_handle);
        let projects_backend = ProjectManagerBackend::new(Arc::clone(&project_manager));
        let mcp_backend = ProcessMcpBackend;

        Self {
            sessions: Arc::new(SessionsServiceImpl::new(sessions_backend)),
            terminals: Arc::new(TerminalsServiceImpl::new(terminals_backend)),
            projects: Arc::new(ProjectsServiceImpl::new(projects_backend)),
            mcp: Arc::new(McpServiceImpl::new(mcp_backend)),
        }
    }
}
