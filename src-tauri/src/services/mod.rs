pub mod mcp;
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
