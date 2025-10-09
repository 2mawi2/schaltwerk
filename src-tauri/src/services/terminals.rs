use crate::domains::terminal::{
    manager::CreateTerminalWithAppAndSizeParams, TerminalManager, TerminalSnapshot,
};
use crate::project_manager::ProjectManager;
use crate::schaltwerk_core::db_project_config::ProjectConfigMethods;
use async_trait::async_trait;
use futures::future::join_all;
use std::collections::HashSet;
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateTerminalRequest {
    pub id: String,
    pub cwd: String,
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateRunTerminalRequest {
    pub id: String,
    pub cwd: String,
    pub env: Option<Vec<(String, String)>>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateTerminalWithSizeRequest {
    pub id: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[async_trait]
pub trait TerminalsBackend: Send + Sync {
    async fn create_terminal(&self, request: CreateTerminalRequest) -> Result<String, String>;
    async fn create_run_terminal(
        &self,
        request: CreateRunTerminalRequest,
    ) -> Result<String, String>;
    async fn create_terminal_with_size(
        &self,
        request: CreateTerminalWithSizeRequest,
    ) -> Result<String, String>;
    async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String>;
    async fn paste_and_submit_terminal(
        &self,
        id: String,
        data: Vec<u8>,
        bracketed: bool,
    ) -> Result<(), String>;
    async fn resize_terminal(&self, id: String, cols: u16, rows: u16) -> Result<(), String>;
    async fn close_terminal(&self, id: String) -> Result<(), String>;
    async fn terminal_exists(&self, id: String) -> Result<bool, String>;
    async fn terminals_exist_bulk(&self, ids: Vec<String>) -> Result<Vec<(String, bool)>, String>;
    async fn get_terminal_buffer(
        &self,
        id: String,
        from_seq: Option<u64>,
    ) -> Result<TerminalSnapshot, String>;
    async fn get_terminal_activity_status(&self, id: String) -> Result<(bool, u64), String>;
    async fn get_all_terminal_activity(&self) -> Result<Vec<(String, u64)>, String>;
    async fn register_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
        terminal_ids: Vec<String>,
    ) -> Result<(), String>;
    async fn suspend_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
    ) -> Result<(), String>;
    async fn resume_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
    ) -> Result<(), String>;
}

#[async_trait]
pub trait TerminalsService: Send + Sync {
    async fn create_terminal(&self, request: CreateTerminalRequest) -> Result<String, String>;
    async fn create_run_terminal(
        &self,
        request: CreateRunTerminalRequest,
    ) -> Result<String, String>;
    async fn create_terminal_with_size(
        &self,
        request: CreateTerminalWithSizeRequest,
    ) -> Result<String, String>;
    async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String>;
    async fn paste_and_submit_terminal(
        &self,
        id: String,
        data: Vec<u8>,
        bracketed: bool,
    ) -> Result<(), String>;
    async fn resize_terminal(&self, id: String, cols: u16, rows: u16) -> Result<(), String>;
    async fn close_terminal(&self, id: String) -> Result<(), String>;
    async fn terminal_exists(&self, id: String) -> Result<bool, String>;
    async fn terminals_exist_bulk(&self, ids: Vec<String>) -> Result<Vec<(String, bool)>, String>;
    async fn get_terminal_buffer(
        &self,
        id: String,
        from_seq: Option<u64>,
    ) -> Result<TerminalSnapshot, String>;
    async fn get_terminal_activity_status(&self, id: String) -> Result<(bool, u64), String>;
    async fn get_all_terminal_activity(&self) -> Result<Vec<(String, u64)>, String>;
    async fn register_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
        terminal_ids: Vec<String>,
    ) -> Result<(), String>;
    async fn suspend_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
    ) -> Result<(), String>;
    async fn resume_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
    ) -> Result<(), String>;
}

pub struct TerminalsServiceImpl<B: TerminalsBackend> {
    backend: B,
}

impl<B: TerminalsBackend> TerminalsServiceImpl<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    fn map_err(context: &str, err: String) -> String {
        log::error!("{context}: {err}");
        format!("{context}: {err}")
    }

    pub async fn create_terminal(&self, request: CreateTerminalRequest) -> Result<String, String> {
        self.backend
            .create_terminal(request)
            .await
            .map_err(|err| Self::map_err("Failed to create terminal", err))
    }

    pub async fn create_run_terminal(
        &self,
        request: CreateRunTerminalRequest,
    ) -> Result<String, String> {
        self.backend
            .create_run_terminal(request)
            .await
            .map_err(|err| Self::map_err("Failed to create run terminal", err))
    }

    pub async fn create_terminal_with_size(
        &self,
        request: CreateTerminalWithSizeRequest,
    ) -> Result<String, String> {
        self.backend
            .create_terminal_with_size(request)
            .await
            .map_err(|err| Self::map_err("Failed to create terminal with requested size", err))
    }

    pub async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String> {
        self.backend
            .write_terminal(id.clone(), data)
            .await
            .map_err(|err| Self::map_err(&format!("Failed to write to terminal {id}"), err))
    }

    pub async fn paste_and_submit_terminal(
        &self,
        id: String,
        data: Vec<u8>,
        bracketed: bool,
    ) -> Result<(), String> {
        self.backend
            .paste_and_submit_terminal(id.clone(), data, bracketed)
            .await
            .map_err(|err| Self::map_err(&format!("Failed to paste into terminal {id}"), err))
    }

    pub async fn resize_terminal(&self, id: String, cols: u16, rows: u16) -> Result<(), String> {
        self.backend
            .resize_terminal(id.clone(), cols, rows)
            .await
            .map_err(|err| Self::map_err(&format!("Failed to resize terminal {id}"), err))
    }

    pub async fn close_terminal(&self, id: String) -> Result<(), String> {
        self.backend
            .close_terminal(id.clone())
            .await
            .map_err(|err| Self::map_err(&format!("Failed to close terminal {id}"), err))
    }

    pub async fn terminal_exists(&self, id: String) -> Result<bool, String> {
        self.backend
            .terminal_exists(id.clone())
            .await
            .map_err(|err| {
                Self::map_err(&format!("Failed to check existence for terminal {id}"), err)
            })
    }

    pub async fn terminals_exist_bulk(
        &self,
        ids: Vec<String>,
    ) -> Result<Vec<(String, bool)>, String> {
        self.backend
            .terminals_exist_bulk(ids)
            .await
            .map_err(|err| Self::map_err("Failed to check terminal existence", err))
    }

    pub async fn get_terminal_buffer(
        &self,
        id: String,
        from_seq: Option<u64>,
    ) -> Result<TerminalSnapshot, String> {
        self.backend
            .get_terminal_buffer(id.clone(), from_seq)
            .await
            .map_err(|err| Self::map_err(&format!("Failed to read buffer for terminal {id}"), err))
    }

    pub async fn get_terminal_activity_status(&self, id: String) -> Result<(bool, u64), String> {
        self.backend
            .get_terminal_activity_status(id.clone())
            .await
            .map_err(|err| {
                Self::map_err(
                    &format!("Failed to fetch activity status for terminal {id}"),
                    err,
                )
            })
    }

    pub async fn get_all_terminal_activity(&self) -> Result<Vec<(String, u64)>, String> {
        self.backend
            .get_all_terminal_activity()
            .await
            .map_err(|err| Self::map_err("Failed to list terminal activity", err))
    }

    pub async fn register_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
        terminal_ids: Vec<String>,
    ) -> Result<(), String> {
        let context = format!(
            "Failed to register session terminals for project {project_id} session {session_id:?}"
        );
        self.backend
            .register_session_terminals(project_id, session_id, terminal_ids)
            .await
            .map_err(|err| Self::map_err(&context, err))
    }

    pub async fn suspend_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
    ) -> Result<(), String> {
        let context =
            format!("Failed to suspend terminals for project {project_id} session {session_id:?}");
        self.backend
            .suspend_session_terminals(project_id, session_id)
            .await
            .map_err(|err| Self::map_err(&context, err))
    }

    pub async fn resume_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
    ) -> Result<(), String> {
        let context =
            format!("Failed to resume terminals for project {project_id} session {session_id:?}");
        self.backend
            .resume_session_terminals(project_id, session_id)
            .await
            .map_err(|err| Self::map_err(&context, err))
    }
}

#[async_trait]
impl<B> TerminalsService for TerminalsServiceImpl<B>
where
    B: TerminalsBackend + Sync,
{
    async fn create_terminal(&self, request: CreateTerminalRequest) -> Result<String, String> {
        TerminalsServiceImpl::create_terminal(self, request).await
    }

    async fn create_run_terminal(
        &self,
        request: CreateRunTerminalRequest,
    ) -> Result<String, String> {
        TerminalsServiceImpl::create_run_terminal(self, request).await
    }

    async fn create_terminal_with_size(
        &self,
        request: CreateTerminalWithSizeRequest,
    ) -> Result<String, String> {
        TerminalsServiceImpl::create_terminal_with_size(self, request).await
    }

    async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String> {
        TerminalsServiceImpl::write_terminal(self, id, data).await
    }

    async fn paste_and_submit_terminal(
        &self,
        id: String,
        data: Vec<u8>,
        bracketed: bool,
    ) -> Result<(), String> {
        TerminalsServiceImpl::paste_and_submit_terminal(self, id, data, bracketed).await
    }

    async fn resize_terminal(&self, id: String, cols: u16, rows: u16) -> Result<(), String> {
        TerminalsServiceImpl::resize_terminal(self, id, cols, rows).await
    }

    async fn close_terminal(&self, id: String) -> Result<(), String> {
        TerminalsServiceImpl::close_terminal(self, id).await
    }

    async fn terminal_exists(&self, id: String) -> Result<bool, String> {
        TerminalsServiceImpl::terminal_exists(self, id).await
    }

    async fn terminals_exist_bulk(&self, ids: Vec<String>) -> Result<Vec<(String, bool)>, String> {
        TerminalsServiceImpl::terminals_exist_bulk(self, ids).await
    }

    async fn get_terminal_buffer(
        &self,
        id: String,
        from_seq: Option<u64>,
    ) -> Result<TerminalSnapshot, String> {
        TerminalsServiceImpl::get_terminal_buffer(self, id, from_seq).await
    }

    async fn get_terminal_activity_status(&self, id: String) -> Result<(bool, u64), String> {
        TerminalsServiceImpl::get_terminal_activity_status(self, id).await
    }

    async fn get_all_terminal_activity(&self) -> Result<Vec<(String, u64)>, String> {
        TerminalsServiceImpl::get_all_terminal_activity(self).await
    }

    async fn register_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
        terminal_ids: Vec<String>,
    ) -> Result<(), String> {
        TerminalsServiceImpl::register_session_terminals(self, project_id, session_id, terminal_ids)
            .await
    }

    async fn suspend_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
    ) -> Result<(), String> {
        TerminalsServiceImpl::suspend_session_terminals(self, project_id, session_id).await
    }

    async fn resume_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
    ) -> Result<(), String> {
        TerminalsServiceImpl::resume_session_terminals(self, project_id, session_id).await
    }
}

pub struct TerminalManagerBackend {
    project_manager: Arc<ProjectManager>,
    app_handle: AppHandle,
}

impl TerminalManagerBackend {
    pub fn new(project_manager: Arc<ProjectManager>, app_handle: AppHandle) -> Self {
        Self {
            project_manager,
            app_handle,
        }
    }

    async fn terminal_manager(&self) -> Result<Arc<TerminalManager>, String> {
        self.project_manager
            .current_terminal_manager()
            .await
            .map_err(|e| format!("Failed to get terminal manager: {e}"))
    }

    async fn ensure_app_handle(&self, manager: &Arc<TerminalManager>) {
        manager.set_app_handle(self.app_handle.clone()).await;
    }

    async fn project_environment(&self) -> Vec<(String, String)> {
        if let Ok(project) = self.project_manager.current_project().await {
            let core = project.schaltwerk_core.read().await;
            let db = core.database();
            if let Ok(vars) = db.get_project_environment_variables(&project.path) {
                return vars.into_iter().collect();
            }
        }
        Vec::new()
    }

    fn merge_env(
        &self,
        mut base: Vec<(String, String)>,
        mut override_env: Vec<(String, String)>,
    ) -> Vec<(String, String)> {
        if override_env.is_empty() {
            return base;
        }

        let override_keys: HashSet<String> = override_env.iter().map(|(k, _)| k.clone()).collect();
        base.retain(|(k, _)| !override_keys.contains(k));
        base.append(&mut override_env);
        base
    }
}

#[async_trait]
impl TerminalsBackend for TerminalManagerBackend {
    async fn create_terminal(&self, request: CreateTerminalRequest) -> Result<String, String> {
        let manager = self.terminal_manager().await?;
        self.ensure_app_handle(&manager).await;

        let env = self.merge_env(self.project_environment().await, request.env);

        if !env.is_empty() {
            log::info!(
                "Adding {} project environment variables to terminal {}",
                env.len(),
                request.id
            );
            manager
                .create_terminal_with_env(request.id.clone(), request.cwd, env)
                .await?;
        } else {
            manager
                .create_terminal(request.id.clone(), request.cwd)
                .await?;
        }

        Ok(request.id)
    }

    async fn create_run_terminal(
        &self,
        request: CreateRunTerminalRequest,
    ) -> Result<String, String> {
        let manager = self.terminal_manager().await?;
        self.ensure_app_handle(&manager).await;

        let env = self.merge_env(
            self.project_environment().await,
            request.env.unwrap_or_default(),
        );

        let bash = "/bin/bash".to_string();
        let args = vec!["-l".to_string()];

        if let (Some(cols), Some(rows)) = (request.cols, request.rows) {
            manager
                .create_terminal_with_app_and_size(CreateTerminalWithAppAndSizeParams {
                    id: request.id.clone(),
                    cwd: request.cwd,
                    command: bash,
                    args,
                    env,
                    cols,
                    rows,
                })
                .await?;
        } else {
            manager
                .create_terminal_with_app(request.id.clone(), request.cwd, bash, args, env)
                .await?;
        }

        Ok(request.id)
    }

    async fn create_terminal_with_size(
        &self,
        request: CreateTerminalWithSizeRequest,
    ) -> Result<String, String> {
        let manager = self.terminal_manager().await?;
        self.ensure_app_handle(&manager).await;

        log::info!(
            "Creating terminal {} with initial size {}x{}",
            request.id,
            request.cols,
            request.rows
        );

        let env = self.project_environment().await;

        if !env.is_empty() {
            log::info!(
                "Adding {} project environment variables to terminal {}",
                env.len(),
                request.id
            );
            manager
                .create_terminal_with_size_and_env(
                    request.id.clone(),
                    request.cwd,
                    request.cols,
                    request.rows,
                    env,
                )
                .await?;
        } else {
            manager
                .create_terminal_with_size(
                    request.id.clone(),
                    request.cwd,
                    request.cols,
                    request.rows,
                )
                .await?;
        }

        Ok(request.id)
    }

    async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String> {
        let manager = self.terminal_manager().await?;
        manager.write_terminal(id, data).await
    }

    async fn paste_and_submit_terminal(
        &self,
        id: String,
        data: Vec<u8>,
        bracketed: bool,
    ) -> Result<(), String> {
        let manager = self.terminal_manager().await?;
        manager.paste_and_submit_terminal(id, data, bracketed).await
    }

    async fn resize_terminal(&self, id: String, cols: u16, rows: u16) -> Result<(), String> {
        let manager = self.terminal_manager().await?;
        manager.resize_terminal(id, cols, rows).await
    }

    async fn close_terminal(&self, id: String) -> Result<(), String> {
        let manager = self.terminal_manager().await?;
        manager.close_terminal(id).await
    }

    async fn terminal_exists(&self, id: String) -> Result<bool, String> {
        let manager = self.terminal_manager().await?;
        manager.terminal_exists(&id).await
    }

    async fn terminals_exist_bulk(&self, ids: Vec<String>) -> Result<Vec<(String, bool)>, String> {
        let manager: Arc<TerminalManager> = self.terminal_manager().await?;
        let futures = ids.into_iter().map(|id| {
            let manager = Arc::clone(&manager);
            async move {
                let exists = manager.terminal_exists(&id).await.unwrap_or(false);
                (id, exists)
            }
        });
        Ok(join_all(futures).await)
    }

    async fn get_terminal_buffer(
        &self,
        id: String,
        from_seq: Option<u64>,
    ) -> Result<TerminalSnapshot, String> {
        let manager = self.terminal_manager().await?;
        manager.get_terminal_buffer(id, from_seq).await
    }

    async fn get_terminal_activity_status(&self, id: String) -> Result<(bool, u64), String> {
        let manager = self.terminal_manager().await?;
        manager.get_terminal_activity_status(id).await
    }

    async fn get_all_terminal_activity(&self) -> Result<Vec<(String, u64)>, String> {
        let manager = self.terminal_manager().await?;
        Ok(manager.get_all_terminal_activity().await)
    }

    async fn register_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
        terminal_ids: Vec<String>,
    ) -> Result<(), String> {
        let manager = self.terminal_manager().await?;
        for id in terminal_ids {
            manager
                .register_terminal(&project_id, session_id.as_deref(), &id)
                .await;
        }
        Ok(())
    }

    async fn suspend_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
    ) -> Result<(), String> {
        let manager = self.terminal_manager().await?;
        manager
            .suspend_session_terminals(&project_id, session_id.as_deref())
            .await
    }

    async fn resume_session_terminals(
        &self,
        project_id: String,
        session_id: Option<String>,
    ) -> Result<(), String> {
        let manager = self.terminal_manager().await?;
        manager
            .resume_session_terminals(&project_id, session_id.as_deref())
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::{Arc, Mutex};

    struct RecordingBackend {
        calls: Arc<Mutex<Vec<CreateTerminalRequest>>>,
        response_id: String,
    }

    #[async_trait]
    impl TerminalsBackend for RecordingBackend {
        async fn create_terminal(&self, request: CreateTerminalRequest) -> Result<String, String> {
            self.calls.lock().unwrap().push(request);
            Ok(self.response_id.clone())
        }

        async fn write_terminal(&self, _id: String, _data: Vec<u8>) -> Result<(), String> {
            Ok(())
        }

        async fn create_run_terminal(
            &self,
            _request: CreateRunTerminalRequest,
        ) -> Result<String, String> {
            panic!("unused in test backend");
        }

        async fn create_terminal_with_size(
            &self,
            _request: CreateTerminalWithSizeRequest,
        ) -> Result<String, String> {
            panic!("unused in test backend");
        }

        async fn paste_and_submit_terminal(
            &self,
            _id: String,
            _data: Vec<u8>,
            _bracketed: bool,
        ) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn resize_terminal(&self, _id: String, _cols: u16, _rows: u16) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn close_terminal(&self, _id: String) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn terminal_exists(&self, _id: String) -> Result<bool, String> {
            panic!("unused in test backend");
        }

        async fn terminals_exist_bulk(
            &self,
            _ids: Vec<String>,
        ) -> Result<Vec<(String, bool)>, String> {
            panic!("unused in test backend");
        }

        async fn get_terminal_buffer(
            &self,
            _id: String,
            _from_seq: Option<u64>,
        ) -> Result<TerminalSnapshot, String> {
            panic!("unused in test backend");
        }

        async fn get_terminal_activity_status(&self, _id: String) -> Result<(bool, u64), String> {
            panic!("unused in test backend");
        }

        async fn get_all_terminal_activity(&self) -> Result<Vec<(String, u64)>, String> {
            panic!("unused in test backend");
        }

        async fn register_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
            _terminal_ids: Vec<String>,
        ) -> Result<(), String> {
            Ok(())
        }

        async fn suspend_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
        ) -> Result<(), String> {
            Ok(())
        }

        async fn resume_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
        ) -> Result<(), String> {
            Ok(())
        }
    }

    struct ErrorBackend;

    #[async_trait]
    impl TerminalsBackend for ErrorBackend {
        async fn create_terminal(&self, _request: CreateTerminalRequest) -> Result<String, String> {
            Err("spawn failed".to_string())
        }

        async fn write_terminal(&self, _id: String, _data: Vec<u8>) -> Result<(), String> {
            Ok(())
        }

        async fn create_run_terminal(
            &self,
            _request: CreateRunTerminalRequest,
        ) -> Result<String, String> {
            panic!("unused in test backend");
        }

        async fn create_terminal_with_size(
            &self,
            _request: CreateTerminalWithSizeRequest,
        ) -> Result<String, String> {
            panic!("unused in test backend");
        }

        async fn paste_and_submit_terminal(
            &self,
            _id: String,
            _data: Vec<u8>,
            _bracketed: bool,
        ) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn resize_terminal(&self, _id: String, _cols: u16, _rows: u16) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn close_terminal(&self, _id: String) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn terminal_exists(&self, _id: String) -> Result<bool, String> {
            panic!("unused in test backend");
        }

        async fn terminals_exist_bulk(
            &self,
            _ids: Vec<String>,
        ) -> Result<Vec<(String, bool)>, String> {
            panic!("unused in test backend");
        }

        async fn get_terminal_buffer(
            &self,
            _id: String,
            _from_seq: Option<u64>,
        ) -> Result<TerminalSnapshot, String> {
            panic!("unused in test backend");
        }

        async fn get_terminal_activity_status(&self, _id: String) -> Result<(bool, u64), String> {
            panic!("unused in test backend");
        }

        async fn get_all_terminal_activity(&self) -> Result<Vec<(String, u64)>, String> {
            panic!("unused in test backend");
        }

        async fn register_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
            _terminal_ids: Vec<String>,
        ) -> Result<(), String> {
            Ok(())
        }

        async fn suspend_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
        ) -> Result<(), String> {
            Ok(())
        }

        async fn resume_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
        ) -> Result<(), String> {
            Ok(())
        }
    }

    struct WriteRecordingBackend {
        writes: Arc<Mutex<Vec<(String, Vec<u8>)>>>,
    }

    #[async_trait]
    impl TerminalsBackend for WriteRecordingBackend {
        async fn create_terminal(&self, _request: CreateTerminalRequest) -> Result<String, String> {
            Ok("unused".to_string())
        }

        async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String> {
            self.writes.lock().unwrap().push((id, data));
            Ok(())
        }

        async fn create_run_terminal(
            &self,
            _request: CreateRunTerminalRequest,
        ) -> Result<String, String> {
            panic!("unused in test backend");
        }

        async fn create_terminal_with_size(
            &self,
            _request: CreateTerminalWithSizeRequest,
        ) -> Result<String, String> {
            panic!("unused in test backend");
        }

        async fn paste_and_submit_terminal(
            &self,
            _id: String,
            _data: Vec<u8>,
            _bracketed: bool,
        ) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn resize_terminal(&self, _id: String, _cols: u16, _rows: u16) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn close_terminal(&self, _id: String) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn terminal_exists(&self, _id: String) -> Result<bool, String> {
            panic!("unused in test backend");
        }

        async fn terminals_exist_bulk(
            &self,
            _ids: Vec<String>,
        ) -> Result<Vec<(String, bool)>, String> {
            panic!("unused in test backend");
        }

        async fn get_terminal_buffer(
            &self,
            _id: String,
            _from_seq: Option<u64>,
        ) -> Result<TerminalSnapshot, String> {
            panic!("unused in test backend");
        }

        async fn get_terminal_activity_status(&self, _id: String) -> Result<(bool, u64), String> {
            panic!("unused in test backend");
        }

        async fn get_all_terminal_activity(&self) -> Result<Vec<(String, u64)>, String> {
            panic!("unused in test backend");
        }

        async fn register_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
            _terminal_ids: Vec<String>,
        ) -> Result<(), String> {
            Ok(())
        }

        async fn suspend_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
        ) -> Result<(), String> {
            Ok(())
        }

        async fn resume_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
        ) -> Result<(), String> {
            Ok(())
        }
    }

    struct WriteErrorBackend;

    #[async_trait]
    impl TerminalsBackend for WriteErrorBackend {
        async fn create_terminal(&self, _request: CreateTerminalRequest) -> Result<String, String> {
            Ok("unused".to_string())
        }

        async fn write_terminal(&self, _id: String, _data: Vec<u8>) -> Result<(), String> {
            Err("write failed".to_string())
        }

        async fn create_run_terminal(
            &self,
            _request: CreateRunTerminalRequest,
        ) -> Result<String, String> {
            panic!("unused in test backend");
        }

        async fn create_terminal_with_size(
            &self,
            _request: CreateTerminalWithSizeRequest,
        ) -> Result<String, String> {
            panic!("unused in test backend");
        }

        async fn paste_and_submit_terminal(
            &self,
            _id: String,
            _data: Vec<u8>,
            _bracketed: bool,
        ) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn resize_terminal(&self, _id: String, _cols: u16, _rows: u16) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn close_terminal(&self, _id: String) -> Result<(), String> {
            panic!("unused in test backend");
        }

        async fn terminal_exists(&self, _id: String) -> Result<bool, String> {
            panic!("unused in test backend");
        }

        async fn terminals_exist_bulk(
            &self,
            _ids: Vec<String>,
        ) -> Result<Vec<(String, bool)>, String> {
            panic!("unused in test backend");
        }

        async fn get_terminal_buffer(
            &self,
            _id: String,
            _from_seq: Option<u64>,
        ) -> Result<TerminalSnapshot, String> {
            panic!("unused in test backend");
        }

        async fn get_terminal_activity_status(&self, _id: String) -> Result<(bool, u64), String> {
            panic!("unused in test backend");
        }

        async fn get_all_terminal_activity(&self) -> Result<Vec<(String, u64)>, String> {
            panic!("unused in test backend");
        }

        async fn register_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
            _terminal_ids: Vec<String>,
        ) -> Result<(), String> {
            Ok(())
        }

        async fn suspend_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
        ) -> Result<(), String> {
            Ok(())
        }

        async fn resume_session_terminals(
            &self,
            _project_id: String,
            _session_id: Option<String>,
        ) -> Result<(), String> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn passes_request_to_backend() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let backend = RecordingBackend {
            calls: Arc::clone(&calls),
            response_id: "terminal-123".to_string(),
        };
        let service = TerminalsServiceImpl::new(backend);

        let request = CreateTerminalRequest {
            id: "terminal-123".to_string(),
            cwd: "/tmp".to_string(),
            env: vec![("A".to_string(), "1".to_string())],
        };

        let response = service.create_terminal(request.clone()).await;
        assert!(
            response.is_ok(),
            "expected successful response: {response:?}"
        );
        assert_eq!(response.unwrap(), "terminal-123");

        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0], request);
    }

    #[tokio::test]
    async fn wraps_backend_error_with_context() {
        let service = TerminalsServiceImpl::new(ErrorBackend);
        let request = CreateTerminalRequest {
            id: "terminal-err".to_string(),
            cwd: "/tmp".to_string(),
            env: vec![],
        };

        let response = service.create_terminal(request).await;
        assert!(response.is_err(), "expected error response");
        let message = response.unwrap_err();
        assert!(
            message.contains("spawn failed"),
            "error should include backend cause: {message}"
        );
        assert!(
            message.contains("Failed to create terminal"),
            "error should include context: {message}"
        );
    }

    #[tokio::test]
    async fn write_terminal_delegates_to_backend() {
        let writes = Arc::new(Mutex::new(Vec::new()));
        let backend = WriteRecordingBackend {
            writes: Arc::clone(&writes),
        };
        let service = TerminalsServiceImpl::new(backend);

        service
            .write_terminal("term-1".to_string(), b"hello".to_vec())
            .await
            .expect("write should succeed");

        let recorded = writes.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].0, "term-1");
        assert_eq!(recorded[0].1, b"hello".to_vec());
    }

    #[tokio::test]
    async fn write_terminal_wraps_error_with_context() {
        let service = TerminalsServiceImpl::new(WriteErrorBackend);
        let result = service
            .write_terminal("term-err".to_string(), vec![1, 2, 3])
            .await;
        assert!(result.is_err(), "expected error when backend fails");
        let message = result.unwrap_err();
        assert!(
            message.contains("write failed"),
            "error should include backend cause: {message}"
        );
        assert!(
            message.contains("Failed to write to terminal"),
            "error should include context: {message}"
        );
    }
}
