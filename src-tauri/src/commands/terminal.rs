use schaltwerk::services::ServiceHandles;
use schaltwerk::services::terminals::{
    CreateRunTerminalRequest, CreateTerminalRequest, CreateTerminalWithSizeRequest,
};
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub async fn create_terminal(
    services: State<'_, ServiceHandles>,
    id: String,
    cwd: String,
) -> Result<String, String> {
    services
        .terminals
        .create_terminal(CreateTerminalRequest {
            id,
            cwd,
            env: vec![],
        })
        .await
}

/// Create a terminal with an interactive shell for running commands.
/// This spawns an interactive shell that stays alive after commands complete,
/// allowing the UI to preserve output history and run additional commands.
#[tauri::command]
pub async fn create_run_terminal(
    services: State<'_, ServiceHandles>,
    id: String,
    cwd: String,
    _command: String,
    env: Option<Vec<(String, String)>>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    services
        .terminals
        .create_run_terminal(CreateRunTerminalRequest {
            id,
            cwd,
            env,
            cols,
            rows,
        })
        .await
}

#[tauri::command]
pub async fn create_terminal_with_size(
    services: State<'_, ServiceHandles>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    services
        .terminals
        .create_terminal_with_size(CreateTerminalWithSizeRequest {
            id,
            cwd,
            cols,
            rows,
        })
        .await
}

#[tauri::command]
pub async fn write_terminal(
    services: State<'_, ServiceHandles>,
    id: String,
    data: String,
) -> Result<(), String> {
    services
        .terminals
        .write_terminal(id, data.into_bytes())
        .await
}

#[tauri::command]
pub async fn paste_and_submit_terminal(
    services: State<'_, ServiceHandles>,
    id: String,
    data: String,
    use_bracketed_paste: Option<bool>,
    needs_delayed_submit: Option<bool>,
) -> Result<(), String> {
    services
        .terminals
        .paste_and_submit_terminal(
            id,
            data.into_bytes(),
            use_bracketed_paste.unwrap_or(false),
            needs_delayed_submit.unwrap_or(false),
        )
        .await
}

#[tauri::command]
pub async fn resize_terminal(
    services: State<'_, ServiceHandles>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    services.terminals.resize_terminal(id, cols, rows).await
}

#[tauri::command]
pub async fn close_terminal(services: State<'_, ServiceHandles>, id: String) -> Result<(), String> {
    services.terminals.close_terminal(id).await
}

#[tauri::command]
pub async fn terminal_exists(
    services: State<'_, ServiceHandles>,
    id: String,
) -> Result<bool, String> {
    services.terminals.terminal_exists(id).await
}

#[tauri::command]
pub async fn terminals_exist_bulk(
    services: State<'_, ServiceHandles>,
    ids: Vec<String>,
) -> Result<Vec<(String, bool)>, String> {
    services.terminals.terminals_exist_bulk(ids).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalBufferResponse {
    pub seq: u64,
    pub start_seq: u64,
    pub data: String,
}

#[tauri::command]
pub async fn get_terminal_buffer(
    services: State<'_, ServiceHandles>,
    id: String,
    from_seq: Option<u64>,
) -> Result<TerminalBufferResponse, String> {
    let snapshot = services.terminals.get_terminal_buffer(id, from_seq).await?;
    let data = String::from_utf8_lossy(&snapshot.data).to_string();
    Ok(TerminalBufferResponse {
        seq: snapshot.seq,
        start_seq: snapshot.start_seq,
        data,
    })
}

#[tauri::command]
pub async fn get_terminal_activity_status(
    services: State<'_, ServiceHandles>,
    id: String,
) -> Result<(bool, u64), String> {
    services.terminals.get_terminal_activity_status(id).await
}

#[tauri::command]
pub async fn get_all_terminal_activity(
    services: State<'_, ServiceHandles>,
) -> Result<Vec<(String, u64)>, String> {
    services.terminals.get_all_terminal_activity().await
}

#[tauri::command]
pub async fn register_session_terminals(
    services: State<'_, ServiceHandles>,
    project_id: String,
    session_id: Option<String>,
    terminal_ids: Vec<String>,
) -> Result<(), String> {
    services
        .terminals
        .register_session_terminals(project_id, session_id, terminal_ids)
        .await
}

#[tauri::command]
pub async fn suspend_session_terminals(
    services: State<'_, ServiceHandles>,
    project_id: String,
    session_id: Option<String>,
) -> Result<(), String> {
    services
        .terminals
        .suspend_session_terminals(project_id, session_id)
        .await
}

#[tauri::command]
pub async fn resume_session_terminals(
    services: State<'_, ServiceHandles>,
    project_id: String,
    session_id: Option<String>,
) -> Result<(), String> {
    services
        .terminals
        .resume_session_terminals(project_id, session_id)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use schaltwerk::services::TerminalSnapshot;
    use schaltwerk::services::terminals::{TerminalsBackend, TerminalsServiceImpl};
    use std::sync::{Arc, Mutex};

    struct MockTerminalsBackend {
        create_calls: Arc<Mutex<Vec<CreateTerminalRequest>>>,
        create_run_calls: Arc<Mutex<Vec<CreateRunTerminalRequest>>>,
        create_sized_calls: Arc<Mutex<Vec<CreateTerminalWithSizeRequest>>>,
        write_calls: Arc<Mutex<Vec<(String, Vec<u8>)>>>,
        paste_calls: Arc<Mutex<Vec<(String, Vec<u8>, bool, bool)>>>,
        resize_calls: Arc<Mutex<Vec<(String, u16, u16)>>>,
        close_calls: Arc<Mutex<Vec<String>>>,
        exists_calls: Arc<Mutex<Vec<String>>>,
        exists_bulk_calls: Arc<Mutex<Vec<Vec<String>>>>,
        buffer_calls: Arc<Mutex<Vec<(String, Option<u64>)>>>,
        activity_status_calls: Arc<Mutex<Vec<String>>>,
        activity_all_calls: Arc<Mutex<usize>>,
        register_calls: Arc<Mutex<Vec<(String, Option<String>, Vec<String>)>>>,
        suspend_calls: Arc<Mutex<Vec<(String, Option<String>)>>>,
        resume_calls: Arc<Mutex<Vec<(String, Option<String>)>>>,
        should_error: bool,
    }

    impl MockTerminalsBackend {
        fn new() -> Self {
            Self {
                create_calls: Arc::new(Mutex::new(Vec::new())),
                create_run_calls: Arc::new(Mutex::new(Vec::new())),
                create_sized_calls: Arc::new(Mutex::new(Vec::new())),
                write_calls: Arc::new(Mutex::new(Vec::new())),
                paste_calls: Arc::new(Mutex::new(Vec::new())),
                resize_calls: Arc::new(Mutex::new(Vec::new())),
                close_calls: Arc::new(Mutex::new(Vec::new())),
                exists_calls: Arc::new(Mutex::new(Vec::new())),
                exists_bulk_calls: Arc::new(Mutex::new(Vec::new())),
                buffer_calls: Arc::new(Mutex::new(Vec::new())),
                activity_status_calls: Arc::new(Mutex::new(Vec::new())),
                activity_all_calls: Arc::new(Mutex::new(0)),
                register_calls: Arc::new(Mutex::new(Vec::new())),
                suspend_calls: Arc::new(Mutex::new(Vec::new())),
                resume_calls: Arc::new(Mutex::new(Vec::new())),
                should_error: false,
            }
        }

        fn with_error(mut self) -> Self {
            self.should_error = true;
            self
        }
    }

    #[async_trait]
    impl TerminalsBackend for MockTerminalsBackend {
        async fn create_terminal(&self, request: CreateTerminalRequest) -> Result<String, String> {
            self.create_calls.lock().unwrap().push(request.clone());
            if self.should_error {
                Err("create failed".to_string())
            } else {
                Ok(request.id)
            }
        }

        async fn create_run_terminal(
            &self,
            request: CreateRunTerminalRequest,
        ) -> Result<String, String> {
            self.create_run_calls.lock().unwrap().push(request.clone());
            if self.should_error {
                Err("create run failed".to_string())
            } else {
                Ok(request.id)
            }
        }

        async fn create_terminal_with_size(
            &self,
            request: CreateTerminalWithSizeRequest,
        ) -> Result<String, String> {
            self.create_sized_calls
                .lock()
                .unwrap()
                .push(request.clone());
            if self.should_error {
                Err("create sized failed".to_string())
            } else {
                Ok(request.id)
            }
        }

        async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String> {
            self.write_calls.lock().unwrap().push((id, data));
            if self.should_error {
                Err("write failed".to_string())
            } else {
                Ok(())
            }
        }

        async fn paste_and_submit_terminal(
            &self,
            id: String,
            data: Vec<u8>,
            bracketed: bool,
            needs_delayed_submit: bool,
        ) -> Result<(), String> {
            self.paste_calls
                .lock()
                .unwrap()
                .push((id, data, bracketed, needs_delayed_submit));
            if self.should_error {
                Err("paste failed".to_string())
            } else {
                Ok(())
            }
        }

        async fn resize_terminal(&self, id: String, cols: u16, rows: u16) -> Result<(), String> {
            self.resize_calls.lock().unwrap().push((id, cols, rows));
            if self.should_error {
                Err("resize failed".to_string())
            } else {
                Ok(())
            }
        }

        async fn close_terminal(&self, id: String) -> Result<(), String> {
            self.close_calls.lock().unwrap().push(id);
            if self.should_error {
                Err("close failed".to_string())
            } else {
                Ok(())
            }
        }

        async fn terminal_exists(&self, id: String) -> Result<bool, String> {
            self.exists_calls.lock().unwrap().push(id);
            if self.should_error {
                Err("exists failed".to_string())
            } else {
                Ok(true)
            }
        }

        async fn terminals_exist_bulk(
            &self,
            ids: Vec<String>,
        ) -> Result<Vec<(String, bool)>, String> {
            self.exists_bulk_calls.lock().unwrap().push(ids.clone());
            if self.should_error {
                Err("exists bulk failed".to_string())
            } else {
                Ok(ids.into_iter().map(|id| (id, true)).collect())
            }
        }

        async fn get_terminal_buffer(
            &self,
            id: String,
            from_seq: Option<u64>,
        ) -> Result<TerminalSnapshot, String> {
            self.buffer_calls.lock().unwrap().push((id, from_seq));
            if self.should_error {
                Err("buffer failed".to_string())
            } else {
                Ok(TerminalSnapshot {
                    seq: 42,
                    start_seq: 0,
                    data: b"test output".to_vec(),
                })
            }
        }

        async fn get_terminal_activity_status(&self, id: String) -> Result<(bool, u64), String> {
            self.activity_status_calls.lock().unwrap().push(id);
            if self.should_error {
                Err("activity status failed".to_string())
            } else {
                Ok((true, 100))
            }
        }

        async fn get_all_terminal_activity(&self) -> Result<Vec<(String, u64)>, String> {
            *self.activity_all_calls.lock().unwrap() += 1;
            if self.should_error {
                Err("activity all failed".to_string())
            } else {
                Ok(vec![("term-1".to_string(), 10), ("term-2".to_string(), 20)])
            }
        }

        async fn register_session_terminals(
            &self,
            project_id: String,
            session_id: Option<String>,
            terminal_ids: Vec<String>,
        ) -> Result<(), String> {
            self.register_calls.lock().unwrap().push((
                project_id,
                session_id.clone(),
                terminal_ids.clone(),
            ));
            if self.should_error {
                Err("register failed".to_string())
            } else {
                Ok(())
            }
        }

        async fn suspend_session_terminals(
            &self,
            project_id: String,
            session_id: Option<String>,
        ) -> Result<(), String> {
            self.suspend_calls
                .lock()
                .unwrap()
                .push((project_id, session_id.clone()));
            if self.should_error {
                Err("suspend failed".to_string())
            } else {
                Ok(())
            }
        }

        async fn resume_session_terminals(
            &self,
            project_id: String,
            session_id: Option<String>,
        ) -> Result<(), String> {
            self.resume_calls
                .lock()
                .unwrap()
                .push((project_id, session_id.clone()));
            if self.should_error {
                Err("resume failed".to_string())
            } else {
                Ok(())
            }
        }
    }

    fn error_service() -> TerminalsServiceImpl<MockTerminalsBackend> {
        TerminalsServiceImpl::new(MockTerminalsBackend::new().with_error())
    }

    #[tokio::test]
    async fn create_terminal_passes_id_and_cwd_to_service() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.create_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .create_terminal(CreateTerminalRequest {
                id: "term-1".to_string(),
                cwd: "/home/user".to_string(),
                env: vec![],
            })
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "term-1");
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "term-1");
        assert_eq!(calls[0].cwd, "/home/user");
        assert_eq!(calls[0].env.len(), 0);
    }

    #[tokio::test]
    async fn create_run_terminal_with_env_none_uses_empty_vec() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.create_run_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .create_run_terminal(CreateRunTerminalRequest {
                id: "run-1".to_string(),
                cwd: "/tmp".to_string(),
                env: None,
                cols: None,
                rows: None,
            })
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].env, None);
    }

    #[tokio::test]
    async fn create_run_terminal_with_env_preserves_pairs() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.create_run_calls);
        let service = TerminalsServiceImpl::new(backend);

        let env = vec![
            ("KEY1".to_string(), "value1".to_string()),
            ("KEY2".to_string(), "value2".to_string()),
        ];

        let result = service
            .create_run_terminal(CreateRunTerminalRequest {
                id: "run-2".to_string(),
                cwd: "/tmp".to_string(),
                env: Some(env.clone()),
                cols: None,
                rows: None,
            })
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].env, Some(env));
    }

    #[tokio::test]
    async fn create_run_terminal_with_cols_rows_passes_correctly() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.create_run_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .create_run_terminal(CreateRunTerminalRequest {
                id: "run-3".to_string(),
                cwd: "/tmp".to_string(),
                env: None,
                cols: Some(80),
                rows: Some(24),
            })
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].cols, Some(80));
        assert_eq!(calls[0].rows, Some(24));
    }

    #[tokio::test]
    async fn create_terminal_with_size_passes_dimensions() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.create_sized_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .create_terminal_with_size(CreateTerminalWithSizeRequest {
                id: "sized-1".to_string(),
                cwd: "/home".to_string(),
                cols: 100,
                rows: 30,
            })
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].cols, 100);
        assert_eq!(calls[0].rows, 30);
    }

    #[tokio::test]
    async fn write_terminal_converts_string_to_utf8_bytes() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.write_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .write_terminal("term-write".to_string(), "hello world".as_bytes().to_vec())
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "term-write");
        assert_eq!(calls[0].1, b"hello world".to_vec());
    }

    #[tokio::test]
    async fn write_terminal_with_special_characters() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.write_calls);
        let service = TerminalsServiceImpl::new(backend);

        let input = "café™🚀";
        let result = service
            .write_terminal("term-unicode".to_string(), input.as_bytes().to_vec())
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls[0].1, input.as_bytes().to_vec());
    }

    #[tokio::test]
    async fn paste_and_submit_terminal_defaults_bracketed_paste_to_false() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.paste_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .paste_and_submit_terminal("term-paste".to_string(), b"data".to_vec(), false, false)
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "term-paste");
        assert_eq!(calls[0].1, b"data".to_vec());
        assert_eq!(calls[0].2, false);
        assert_eq!(calls[0].3, false);
    }

    #[tokio::test]
    async fn paste_and_submit_terminal_respects_bracketed_paste_true() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.paste_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .paste_and_submit_terminal(
                "term-paste-bracketed".to_string(),
                b"code".to_vec(),
                true,
                false,
            )
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].2, true);
    }

    #[tokio::test]
    async fn paste_and_submit_terminal_respects_delayed_submit_true() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.paste_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .paste_and_submit_terminal(
                "term-paste-delayed".to_string(),
                b"claude-review".to_vec(),
                false,
                true,
            )
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "term-paste-delayed");
        assert_eq!(calls[0].2, false);
        assert_eq!(calls[0].3, true);
    }

    #[tokio::test]
    async fn resize_terminal_passes_cols_and_rows() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.resize_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .resize_terminal("term-resize".to_string(), 120, 40)
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "term-resize");
        assert_eq!(calls[0].1, 120);
        assert_eq!(calls[0].2, 40);
    }

    #[tokio::test]
    async fn close_terminal_delegates_to_service() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.close_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service.close_terminal("term-close".to_string()).await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], "term-close");
    }

    #[tokio::test]
    async fn terminal_exists_returns_boolean() {
        let backend = MockTerminalsBackend::new();
        let service = TerminalsServiceImpl::new(backend);

        let result = service.terminal_exists("term-exists".to_string()).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), true);
    }

    #[tokio::test]
    async fn terminal_exists_returns_false_when_not_exists() {
        let backend = MockTerminalsBackend::new();
        let service = TerminalsServiceImpl::new(backend);

        let result = service.terminal_exists("term-notfound".to_string()).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), true);
    }

    #[tokio::test]
    async fn terminals_exist_bulk_returns_pairs_of_ids_and_booleans() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.exists_bulk_calls);
        let service = TerminalsServiceImpl::new(backend);

        let ids = vec![
            "term-a".to_string(),
            "term-b".to_string(),
            "term-c".to_string(),
        ];

        let result = service.terminals_exist_bulk(ids.clone()).await;

        assert!(result.is_ok());
        let pairs = result.unwrap();
        assert_eq!(pairs.len(), 3);
        assert_eq!(pairs[0].0, "term-a");
        assert_eq!(pairs[0].1, true);
        assert_eq!(pairs[1].0, "term-b");
        assert_eq!(pairs[1].1, true);
        assert_eq!(pairs[2].0, "term-c");
        assert_eq!(pairs[2].1, true);

        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], ids);
    }

    #[tokio::test]
    async fn get_terminal_buffer_converts_from_seq_option_handling() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.buffer_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .get_terminal_buffer("term-buffer".to_string(), Some(10))
            .await;

        assert!(result.is_ok());
        let snapshot = result.unwrap();
        assert_eq!(snapshot.seq, 42);
        assert_eq!(snapshot.start_seq, 0);
        assert_eq!(snapshot.data, b"test output".to_vec());

        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "term-buffer");
        assert_eq!(calls[0].1, Some(10));
    }

    #[tokio::test]
    async fn get_terminal_buffer_with_no_from_seq() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.buffer_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .get_terminal_buffer("term-buffer-no-seq".to_string(), None)
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls[0].1, None);
    }

    #[tokio::test]
    async fn get_terminal_activity_status_returns_tuple() {
        let backend = MockTerminalsBackend::new();
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .get_terminal_activity_status("term-activity".to_string())
            .await;

        assert!(result.is_ok());
        let (active, seq) = result.unwrap();
        assert_eq!(active, true);
        assert_eq!(seq, 100);
    }

    #[tokio::test]
    async fn get_all_terminal_activity_returns_vector_of_tuples() {
        let backend = MockTerminalsBackend::new();
        let service = TerminalsServiceImpl::new(backend);

        let result = service.get_all_terminal_activity().await;

        assert!(result.is_ok());
        let activities = result.unwrap();
        assert_eq!(activities.len(), 2);
        assert_eq!(activities[0].0, "term-1");
        assert_eq!(activities[0].1, 10);
        assert_eq!(activities[1].0, "term-2");
        assert_eq!(activities[1].1, 20);
    }

    #[test]
    fn terminal_buffer_response_serializes_with_camel_case() {
        let response = TerminalBufferResponse {
            seq: 42,
            start_seq: 0,
            data: "test".to_string(),
        };

        let json = serde_json::to_string(&response).expect("serialization should succeed");
        assert!(json.contains("\"seq\""));
        assert!(json.contains("\"startSeq\""));
        assert!(json.contains("\"data\""));
        assert!(json.contains("42"));
        assert!(json.contains("0"));
        assert!(json.contains("test"));
    }

    #[tokio::test]
    async fn error_handling_propagates_from_service() {
        let service = error_service();

        let result = service
            .create_terminal(CreateTerminalRequest {
                id: "error-term".to_string(),
                cwd: "/tmp".to_string(),
                env: vec![],
            })
            .await;

        assert!(result.is_err());
        let error = result.unwrap_err();
        assert!(error.contains("create failed"));
        assert!(error.contains("Failed to create terminal"));
    }

    #[tokio::test]
    async fn write_terminal_error_handling() {
        let service = error_service();

        let result = service
            .write_terminal("error-write".to_string(), b"data".to_vec())
            .await;

        assert!(result.is_err());
        let error = result.unwrap_err();
        assert!(error.contains("write failed"));
    }

    #[tokio::test]
    async fn paste_and_submit_terminal_error_handling() {
        let service = error_service();

        let result = service
            .paste_and_submit_terminal("error-paste".to_string(), b"data".to_vec(), false, false)
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("paste failed"));
    }

    #[tokio::test]
    async fn resize_terminal_error_handling() {
        let service = error_service();

        let result = service
            .resize_terminal("error-resize".to_string(), 80, 24)
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("resize failed"));
    }

    #[tokio::test]
    async fn close_terminal_error_handling() {
        let service = error_service();

        let result = service.close_terminal("error-close".to_string()).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("close failed"));
    }

    #[tokio::test]
    async fn terminal_exists_error_handling() {
        let service = error_service();

        let result = service.terminal_exists("error-exists".to_string()).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("exists failed"));
    }

    #[tokio::test]
    async fn terminals_exist_bulk_error_handling() {
        let service = error_service();

        let result = service
            .terminals_exist_bulk(vec!["term-1".to_string(), "term-2".to_string()])
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("exists bulk failed"));
    }

    #[tokio::test]
    async fn get_terminal_buffer_error_handling() {
        let service = error_service();

        let result = service
            .get_terminal_buffer("error-buffer".to_string(), None)
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("buffer failed"));
    }

    #[tokio::test]
    async fn get_terminal_activity_status_error_handling() {
        let service = error_service();

        let result = service
            .get_terminal_activity_status("error-activity".to_string())
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("activity status failed"));
    }

    #[tokio::test]
    async fn get_all_terminal_activity_error_handling() {
        let service = error_service();

        let result = service.get_all_terminal_activity().await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("activity all failed"));
    }

    #[tokio::test]
    async fn empty_ids_list_in_terminals_exist_bulk() {
        let backend = MockTerminalsBackend::new();
        let service = TerminalsServiceImpl::new(backend);

        let result = service.terminals_exist_bulk(vec![]).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn large_batch_of_ids_in_terminals_exist_bulk() {
        let backend = MockTerminalsBackend::new();
        let service = TerminalsServiceImpl::new(backend);

        let ids: Vec<String> = (0..100).map(|i| format!("term-{}", i)).collect();

        let result = service.terminals_exist_bulk(ids.clone()).await;

        assert!(result.is_ok());
        let pairs = result.unwrap();
        assert_eq!(pairs.len(), 100);
    }

    #[tokio::test]
    async fn write_terminal_with_empty_data() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.write_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .write_terminal("term-empty".to_string(), vec![])
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls[0].1.len(), 0);
    }

    #[tokio::test]
    async fn write_terminal_with_binary_data() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.write_calls);
        let service = TerminalsServiceImpl::new(backend);

        let binary_data = vec![0, 1, 2, 255, 254, 253];
        let result = service
            .write_terminal("term-binary".to_string(), binary_data.clone())
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls[0].1, binary_data);
    }

    #[tokio::test]
    async fn create_run_terminal_with_all_none_options() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.create_run_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .create_run_terminal(CreateRunTerminalRequest {
                id: "run-all-none".to_string(),
                cwd: "/home".to_string(),
                env: None,
                cols: None,
                rows: None,
            })
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls[0].env, None);
        assert_eq!(calls[0].cols, None);
        assert_eq!(calls[0].rows, None);
    }

    #[tokio::test]
    async fn resize_terminal_with_extreme_dimensions() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.resize_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .resize_terminal("term-extreme".to_string(), u16::MAX, u16::MAX)
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls[0].1, u16::MAX);
        assert_eq!(calls[0].2, u16::MAX);
    }

    #[tokio::test]
    async fn get_terminal_buffer_with_large_seq_number() {
        let backend = MockTerminalsBackend::new();
        let backend_calls = Arc::clone(&backend.buffer_calls);
        let service = TerminalsServiceImpl::new(backend);

        let result = service
            .get_terminal_buffer("term-large-seq".to_string(), Some(u64::MAX))
            .await;

        assert!(result.is_ok());
        let calls = backend_calls.lock().unwrap();
        assert_eq!(calls[0].1, Some(u64::MAX));
    }
}
