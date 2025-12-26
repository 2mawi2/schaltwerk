use crate::events::{emit_event, SchaltEvent};
use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{Mutex, mpsc, oneshot};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(untagged)]
pub enum JsonRpcId {
    Number(i64),
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcpSessionStatus {
    Starting,
    Ready,
    Error,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpSessionStatusPayload {
    pub session_name: String,
    pub status: AcpSessionStatus,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpSessionUpdatePayload {
    pub session_name: String,
    pub session_id: String,
    pub update: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPermissionRequestPayload {
    pub session_name: String,
    pub session_id: String,
    pub request_id: JsonRpcId,
    pub tool_call: Value,
    pub options: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpTerminalOutputPayload {
    pub session_name: String,
    pub session_id: String,
    pub terminal_id: String,
    pub output: String,
    pub truncated: bool,
    #[serde(default)]
    pub exit_status: Option<Value>,
}

#[derive(Default)]
pub struct AcpManager {
    sessions: Mutex<HashMap<String, Arc<AcpSession>>>,
}

impl AcpManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn ensure_session_started(
        &self,
        app: tauri::AppHandle,
        session_name: &str,
        worktree_path: PathBuf,
        agent_command: (String, Vec<String>),
        env_vars: Vec<(String, String)>,
        initial_mode: Option<String>,
    ) -> Result<()> {
        {
            let sessions = self.sessions.lock().await;
            if sessions.contains_key(session_name) {
                return Ok(());
            }
        }

        emit_event(
            &app,
            SchaltEvent::AcpSessionStatus,
            &AcpSessionStatusPayload {
                session_name: session_name.to_string(),
                status: AcpSessionStatus::Starting,
                session_id: None,
                message: None,
            },
        )?;

        let (agent_binary, agent_args) = agent_command;
        let session = AcpSession::spawn(
            app.clone(),
            session_name.to_string(),
            worktree_path,
            agent_binary,
            agent_args,
            env_vars,
            initial_mode,
        )
        .await?;

        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(session_name.to_string(), session.clone());
        }

        session.start_handshake();

        Ok(())
    }

    pub async fn prompt(&self, session_name: &str, prompt: String) -> Result<()> {
        let session = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_name)
                .cloned()
                .ok_or_else(|| anyhow!("ACP session not running for '{session_name}'"))?
        };

        session.send_prompt(prompt).await
    }

    pub async fn resolve_permission(
        &self,
        session_name: &str,
        request_id: JsonRpcId,
        option_id: String,
    ) -> Result<()> {
        let session = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_name)
                .cloned()
                .ok_or_else(|| anyhow!("ACP session not running for '{session_name}'"))?
        };

        session.resolve_permission(request_id, option_id).await
    }

    pub async fn stop_session(&self, session_name: &str) -> Result<()> {
        let session = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(session_name)
        };

        if let Some(session) = session {
            session.stop().await?;
        }

        Ok(())
    }

    pub async fn stop_all(&self) -> Result<()> {
        let sessions = {
            let mut map = self.sessions.lock().await;
            map.drain().map(|(_, v)| v).collect::<Vec<_>>()
        };

        for session in sessions {
            let _ = session.stop().await;
        }

        Ok(())
    }
}

struct AcpSession {
    app: tauri::AppHandle,
    session_name: String,
    worktree_path: PathBuf,
    outgoing: mpsc::Sender<String>,
    pending: Mutex<HashMap<i64, oneshot::Sender<Result<Value>>>>,
    next_id: AtomicI64,
    session_id: Mutex<Option<String>>,
    initial_mode: Option<String>,
    pending_permissions: Mutex<HashMap<JsonRpcId, oneshot::Sender<String>>>,
    terminals: Mutex<HashMap<String, Arc<AcpTerminal>>>,
    child: Mutex<Option<Child>>,
}

impl AcpSession {
    async fn spawn(
        app: tauri::AppHandle,
        session_name: String,
        worktree_path: PathBuf,
        agent_binary: String,
        agent_args: Vec<String>,
        env_vars: Vec<(String, String)>,
        initial_mode: Option<String>,
    ) -> Result<Arc<Self>> {
        let mut command = Command::new(&agent_binary);
        command.args(&agent_args);
        command.current_dir(&worktree_path);
        command.stdin(std::process::Stdio::piped());
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());

        let mut env_map = HashMap::new();
        for (key, value) in env_vars {
            env_map.insert(key, value);
        }

        if agent_binary.contains('/') {
            let agent_parent = Path::new(&agent_binary)
                .parent()
                .map(|path| path.to_string_lossy().into_owned())
                .filter(|path| !path.is_empty());

            if let Some(agent_parent) = agent_parent {
                let base_path = env_map
                    .get("PATH")
                    .cloned()
                    .or_else(|| std::env::var("PATH").ok())
                    .unwrap_or_else(|| {
                        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
                            .to_string()
                    });

                if !base_path.split(':').any(|entry| entry == agent_parent) {
                    env_map.insert("PATH".to_string(), format!("{agent_parent}:{base_path}"));
                }
            }
        }

        for (key, value) in env_map {
            command.env(key, value);
        }

        let mut child = command
            .spawn()
            .with_context(|| format!("Failed to spawn ACP agent '{agent_binary}'"))?;

        let stdin = child.stdin.take().context("ACP agent stdin missing")?;
        let stdout = child.stdout.take().context("ACP agent stdout missing")?;
        let stderr = child.stderr.take().context("ACP agent stderr missing")?;

        let (outgoing_tx, outgoing_rx) = mpsc::channel::<String>(256);

        let session = Arc::new(Self {
            app: app.clone(),
            session_name: session_name.clone(),
            worktree_path,
            outgoing: outgoing_tx.clone(),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicI64::new(1),
            session_id: Mutex::new(None),
            initial_mode,
            pending_permissions: Mutex::new(HashMap::new()),
            terminals: Mutex::new(HashMap::new()),
            child: Mutex::new(Some(child)),
        });

        tokio::spawn(Self::writer_task(session.clone(), stdin, outgoing_rx));
        tokio::spawn(Self::reader_task(session.clone(), stdout));
        tokio::spawn(Self::stderr_task(session.clone(), stderr));

        Ok(session)
    }

    fn start_handshake(self: &Arc<Self>) {
        let app = self.app.clone();
        let session_name = self.session_name.clone();
        let worktree_path = self.worktree_path.clone();

        let this = self.clone();

        tokio::spawn(async move {
            let init_result = this
                .request_agent(
                    "initialize",
                    json!({
                      "protocolVersion": 1,
                      "clientInfo": { "name": "Schaltwerk", "version": env!("CARGO_PKG_VERSION") },
                      "clientCapabilities": {
                        "fs": { "readTextFile": true, "writeTextFile": true },
                        "terminal": true
                      }
                    }),
                )
                .await;

            let init_value = match init_result {
                Ok(v) => v,
                Err(e) => {
                    let _ = emit_event(
                        &app,
                        SchaltEvent::AcpSessionStatus,
                        &AcpSessionStatusPayload {
                            session_name: session_name.clone(),
                            status: AcpSessionStatus::Error,
                            session_id: None,
                            message: Some(format!("ACP initialize failed: {e}")),
                        },
                    );
                    return;
                }
            };

            let auth_methods = init_value
                .get("authMethods")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if !auth_methods.is_empty() {
                log::warn!(
                    "[acp] Agent advertised authMethods but Schaltwerk MVP does not implement authenticate yet; session={session_name}"
                );
            }

            let new_session_result = this
                .request_agent(
                    "session/new",
                    json!({
                      "cwd": worktree_path.to_string_lossy().to_string(),
                      "mcpServers": [],
                    }),
                )
                .await;

            let new_session_value = match new_session_result {
                Ok(v) => v,
                Err(e) => {
                    let _ = emit_event(
                        &app,
                        SchaltEvent::AcpSessionStatus,
                        &AcpSessionStatusPayload {
                            session_name: session_name.clone(),
                            status: AcpSessionStatus::Error,
                            session_id: None,
                            message: Some(format!("ACP session/new failed: {e}")),
                        },
                    );
                    return;
                }
            };

            let session_id = match new_session_value.get("sessionId").and_then(|v| v.as_str()) {
                Some(id) => id.to_string(),
                None => {
                    let _ = emit_event(
                        &app,
                        SchaltEvent::AcpSessionStatus,
                        &AcpSessionStatusPayload {
                            session_name: session_name.clone(),
                            status: AcpSessionStatus::Error,
                            session_id: None,
                            message: Some("ACP session/new missing sessionId".to_string()),
                        },
                    );
                    return;
                }
            };

            {
                let mut guard = this.session_id.lock().await;
                *guard = Some(session_id.clone());
            }

            let mut ready_message = None;
            if let Some(mode_id) = this
                .initial_mode
                .clone()
                .filter(|mode_id| !mode_id.trim().is_empty())
                && let Err(err) = this
                    .request_agent(
                        "session/set_mode",
                        json!({ "sessionId": session_id.clone(), "modeId": mode_id.clone() }),
                    )
                    .await
            {
                log::warn!(
                    "[acp] Failed to set initial session mode '{mode_id}' for {session_name}: {err}"
                );
                ready_message =
                    Some(format!("ACP session ready (failed to set mode '{mode_id}': {err})"));
            }

            let _ = emit_event(
                &app,
                SchaltEvent::AcpSessionStatus,
                &AcpSessionStatusPayload {
                    session_name: session_name.clone(),
                    status: AcpSessionStatus::Ready,
                    session_id: Some(session_id),
                    message: ready_message,
                },
            );
        });
    }

    async fn writer_task(
        _session: Arc<Self>,
        mut stdin: ChildStdin,
        mut outgoing_rx: mpsc::Receiver<String>,
    ) {
        while let Some(message) = outgoing_rx.recv().await {
            if let Err(err) = stdin.write_all(message.as_bytes()).await {
                log::error!("[acp] Failed to write to agent stdin: {err}");
                break;
            }
            if let Err(err) = stdin.write_all(b"\n").await {
                log::error!("[acp] Failed to write newline to agent stdin: {err}");
                break;
            }
            if let Err(err) = stdin.flush().await {
                log::error!("[acp] Failed to flush agent stdin: {err}");
                break;
            }
        }
    }

    async fn stderr_task(session: Arc<Self>, stderr: tokio::process::ChildStderr) {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            log::debug!("[acp:{} stderr] {line}", session.session_name);
        }
    }

    async fn reader_task(session: Arc<Self>, stdout: tokio::process::ChildStdout) {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim_end_matches('\r');
            let parsed: Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(err) => {
                    log::warn!("[acp] Failed to parse JSON from agent: {err} line={trimmed}");
                    continue;
                }
            };

            if let Err(err) = session.handle_incoming(parsed).await {
                log::warn!("[acp] Failed to handle agent message: {err}");
            }
        }

        let _ = emit_event(
            &session.app,
            SchaltEvent::AcpSessionStatus,
            &AcpSessionStatusPayload {
                session_name: session.session_name.clone(),
                status: AcpSessionStatus::Stopped,
                session_id: session.session_id.lock().await.clone(),
                message: Some("ACP agent process exited".to_string()),
            },
        );
    }

    async fn handle_incoming(&self, message: Value) -> Result<()> {
        if message.get("method").and_then(|m| m.as_str()).is_some() {
            self.handle_method_message(message).await
        } else if message.get("id").is_some()
            && (message.get("result").is_some() || message.get("error").is_some())
        {
            self.handle_response_message(message).await
        } else {
            Ok(())
        }
    }

    async fn handle_response_message(&self, message: Value) -> Result<()> {
        let Some(id) = message.get("id") else {
            return Ok(());
        };

        let id_num = id.as_i64().ok_or_else(|| anyhow!("Unsupported JSON-RPC id type"))?;

        let sender = {
            let mut pending = self.pending.lock().await;
            pending.remove(&id_num)
        };

        if let Some(sender) = sender {
            if let Some(err) = message.get("error") {
                sender
                    .send(Err(anyhow!("Agent error: {err}")))
                    .map_err(|_| anyhow!("Failed to deliver pending response"))?;
                return Ok(());
            }

            let result = message.get("result").cloned().unwrap_or(Value::Null);
            sender
                .send(Ok(result))
                .map_err(|_| anyhow!("Failed to deliver pending response"))?;
        }

        Ok(())
    }

    async fn handle_method_message(&self, message: Value) -> Result<()> {
        let method = message
            .get("method")
            .and_then(|m| m.as_str())
            .ok_or_else(|| anyhow!("Missing method"))?;
        let params = message.get("params").cloned().unwrap_or(Value::Null);

        let id = message.get("id").cloned();

        match (method, id) {
            ("session/update", None) => {
                self.handle_session_update(params).await?;
                Ok(())
            }
            ("fs/read_text_file", Some(id)) => self.reply(id, self.handle_fs_read(params).await)
                .await,
            ("fs/write_text_file", Some(id)) => {
                self.reply(id, self.handle_fs_write(params).await).await
            }
            ("terminal/create", Some(id)) => {
                self.reply(id, self.handle_terminal_create(params).await)
                    .await
            }
            ("terminal/output", Some(id)) => {
                self.reply(id, self.handle_terminal_output(params).await)
                    .await
            }
            ("terminal/wait_for_exit", Some(id)) => {
                self.reply(id, self.handle_terminal_wait_for_exit(params).await)
                    .await
            }
            ("terminal/kill", Some(id)) => {
                self.reply(id, self.handle_terminal_kill(params).await).await
            }
            ("terminal/release", Some(id)) => {
                self.reply(id, self.handle_terminal_release(params).await)
                    .await
            }
            ("session/request_permission", Some(id)) => {
                self.handle_permission_request(id, params).await
            }
            _ => {
                if let Some(id) = message.get("id") {
                    self.send_error(
                        id.clone(),
                        -32601,
                        format!("Method not found: {method}"),
                    )
                    .await?;
                }
                Ok(())
            }
        }
    }

    async fn handle_session_update(&self, params: Value) -> Result<()> {
        let session_id = params
            .get("sessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("session/update missing sessionId"))?
            .to_string();
        let update = params.get("update").cloned().unwrap_or(Value::Null);

        emit_event(
            &self.app,
            SchaltEvent::AcpSessionUpdate,
            &AcpSessionUpdatePayload {
                session_name: self.session_name.clone(),
                session_id,
                update,
            },
        )?;
        Ok(())
    }

    async fn handle_permission_request(&self, id: Value, params: Value) -> Result<()> {
        let request_id = parse_jsonrpc_id(&id)?;

        let session_id = params
            .get("sessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("session/request_permission missing sessionId"))?
            .to_string();

        let tool_call = params.get("toolCall").cloned().unwrap_or(Value::Null);
        let options = params
            .get("options")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect::<Vec<_>>();

        let (tx, rx) = oneshot::channel::<String>();
        {
            let mut pending = self.pending_permissions.lock().await;
            pending.insert(request_id.clone(), tx);
        }

        emit_event(
            &self.app,
            SchaltEvent::AcpPermissionRequested,
            &AcpPermissionRequestPayload {
                session_name: self.session_name.clone(),
                session_id,
                request_id: request_id.clone(),
                tool_call,
                options,
            },
        )?;

        let option_id = rx
            .await
            .map_err(|_| anyhow!("Permission response channel closed"))?;

        let response = json!({
          "outcome": {
            "outcome": "selected",
            "optionId": option_id,
          }
        });
        self.send_result(id, response).await
    }

    async fn resolve_permission(&self, request_id: JsonRpcId, option_id: String) -> Result<()> {
        let tx = {
            let mut pending = self.pending_permissions.lock().await;
            pending.remove(&request_id)
        }
        .ok_or_else(|| anyhow!("No pending permission request"))?;

        tx.send(option_id)
            .map_err(|_| anyhow!("Failed to deliver permission response"))?;
        Ok(())
    }

    async fn send_prompt(&self, prompt: String) -> Result<()> {
        let session_id = self
            .session_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("ACP session not ready"))?;

        let _ = self
            .request_agent(
                "session/prompt",
                json!({
                  "sessionId": session_id,
                  "prompt": [{ "type": "text", "text": prompt }],
                }),
            )
            .await?;

        Ok(())
    }

    async fn stop(&self) -> Result<()> {
        let mut child_opt = self.child.lock().await;
        if let Some(mut child) = child_opt.take() {
            let _ = child.kill().await;
        }
        Ok(())
    }

    async fn request_agent(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel::<Result<Value>>();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(id, tx);
        }

        let message = json!({
          "jsonrpc": "2.0",
          "id": id,
          "method": method,
          "params": params,
        });
        self.send_raw(message).await?;

        rx.await.map_err(|_| anyhow!("Agent response channel closed"))?
    }

    async fn send_raw(&self, message: Value) -> Result<()> {
        let text = serde_json::to_string(&message)?;
        self.outgoing
            .send(text)
            .await
            .map_err(|_| anyhow!("ACP outgoing channel closed"))?;
        Ok(())
    }

    async fn send_result(&self, id: Value, result: Value) -> Result<()> {
        self.send_raw(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
            .await
    }

    async fn send_error(&self, id: Value, code: i64, message: String) -> Result<()> {
        self.send_raw(json!({
          "jsonrpc": "2.0",
          "id": id,
          "error": { "code": code, "message": message },
        }))
        .await
    }

    async fn reply(&self, id: Value, result: Result<Value>) -> Result<()> {
        match result {
            Ok(ok) => self.send_result(id, ok).await,
            Err(err) => self.send_error(id, -32000, err.to_string()).await,
        }
    }

    async fn handle_fs_read(&self, params: Value) -> Result<Value> {
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("fs/read_text_file missing path"))?;
        let abs_path = PathBuf::from(path);
        self.ensure_path_allowed(&abs_path)?;

        let content = tokio::fs::read_to_string(&abs_path)
            .await
            .with_context(|| format!("Failed to read file {}", abs_path.display()))?;

        let line = params.get("line").and_then(|v| v.as_u64());
        let limit = params.get("limit").and_then(|v| v.as_u64());
        let content = slice_lines(&content, line, limit);

        Ok(json!({ "content": content }))
    }

    async fn handle_fs_write(&self, params: Value) -> Result<Value> {
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("fs/write_text_file missing path"))?;
        let content = params
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("fs/write_text_file missing content"))?;

        let abs_path = PathBuf::from(path);
        self.ensure_path_allowed(&abs_path)?;

        if let Some(parent) = abs_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("Failed to create parent directories for {}", abs_path.display()))?;
        }

        tokio::fs::write(&abs_path, content)
            .await
            .with_context(|| format!("Failed to write file {}", abs_path.display()))?;

        Ok(json!({}))
    }

    async fn handle_terminal_create(&self, params: Value) -> Result<Value> {
        let command = params
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("terminal/create missing command"))?
            .to_string();
        let args = params
            .get("args")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect::<Vec<_>>();
        let env = params
            .get("env")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| {
                let name = v.get("name")?.as_str()?.to_string();
                let value = v.get("value")?.as_str()?.to_string();
                Some((name, value))
            })
            .collect::<Vec<_>>();
        let cwd = params
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.worktree_path.clone());

        self.ensure_path_allowed(&cwd)?;

        let output_byte_limit = params
            .get("outputByteLimit")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize);

        let terminal_id = format!("acp-{}", Uuid::new_v4());
        let terminal = AcpTerminal::spawn(
            terminal_id.clone(),
            &command,
            &args,
            &cwd,
            env,
            output_byte_limit,
        )?;

        {
            let mut terminals = self.terminals.lock().await;
            terminals.insert(terminal_id.clone(), terminal);
        }

        Ok(json!({ "terminalId": terminal_id }))
    }

    async fn handle_terminal_output(&self, params: Value) -> Result<Value> {
        let terminal_id = params
            .get("terminalId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("terminal/output missing terminalId"))?
            .to_string();

        let (session_id, snapshot) = {
            let session_id = self
                .session_id
                .lock()
                .await
                .clone()
                .unwrap_or_else(|| "unknown".to_string());

            let terminals = self.terminals.lock().await;
            let terminal = terminals
                .get(&terminal_id)
                .cloned()
                .ok_or_else(|| anyhow!("Unknown terminalId"))?;
            (session_id, terminal.snapshot().await)
        };

        emit_event(
            &self.app,
            SchaltEvent::AcpTerminalOutput,
            &AcpTerminalOutputPayload {
                session_name: self.session_name.clone(),
                session_id,
                terminal_id: terminal_id.clone(),
                output: snapshot.output.clone(),
                truncated: snapshot.truncated,
                exit_status: snapshot.exit_status.clone(),
            },
        )?;

        Ok(json!({
          "output": snapshot.output,
          "truncated": snapshot.truncated,
          "exitStatus": snapshot.exit_status,
        }))
    }

    async fn handle_terminal_wait_for_exit(&self, params: Value) -> Result<Value> {
        let terminal_id = params
            .get("terminalId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("terminal/wait_for_exit missing terminalId"))?
            .to_string();

        let terminal = {
            let terminals = self.terminals.lock().await;
            terminals
                .get(&terminal_id)
                .cloned()
                .ok_or_else(|| anyhow!("Unknown terminalId"))?
        };

        terminal.wait_for_exit().await?;
        let snapshot = terminal.snapshot().await;
        Ok(json!({
          "exitCode": snapshot.exit_code,
          "signal": snapshot.signal,
        }))
    }

    async fn handle_terminal_kill(&self, params: Value) -> Result<Value> {
        let terminal_id = params
            .get("terminalId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("terminal/kill missing terminalId"))?
            .to_string();

        let terminal = {
            let terminals = self.terminals.lock().await;
            terminals
                .get(&terminal_id)
                .cloned()
                .ok_or_else(|| anyhow!("Unknown terminalId"))?
        };

        terminal.kill().await?;
        Ok(json!({}))
    }

    async fn handle_terminal_release(&self, params: Value) -> Result<Value> {
        let terminal_id = params
            .get("terminalId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("terminal/release missing terminalId"))?
            .to_string();

        let terminal = {
            let mut terminals = self.terminals.lock().await;
            terminals.remove(&terminal_id)
        };

        if let Some(terminal) = terminal {
            let _ = terminal.kill().await;
        }

        Ok(json!({}))
    }

    fn ensure_path_allowed(&self, path: &Path) -> Result<()> {
        let canonical = canonicalize_existing_ancestor(path)
            .with_context(|| format!("Failed to canonicalize path {}", path.display()))?;
        let base = std::fs::canonicalize(&self.worktree_path).with_context(|| {
            format!(
                "Failed to canonicalize worktree path {}",
                self.worktree_path.display()
            )
        })?;

        if !canonical.starts_with(&base) {
            return Err(anyhow!(
                "ACP file access denied outside worktree: {}",
                canonical.display()
            ));
        }
        Ok(())
    }
}

struct AcpTerminal {
    terminal_id: String,
    output: Mutex<String>,
    truncated: Mutex<bool>,
    output_byte_limit: Option<usize>,
    child: Mutex<Child>,
    exit_code: Mutex<Option<u32>>,
    signal: Mutex<Option<String>>,
}

struct AcpTerminalSnapshot {
    output: String,
    truncated: bool,
    exit_status: Option<Value>,
    exit_code: Option<u32>,
    signal: Option<String>,
}

impl AcpTerminal {
    fn spawn(
        terminal_id: String,
        command: &str,
        args: &[String],
        cwd: &Path,
        env: Vec<(String, String)>,
        output_byte_limit: Option<usize>,
    ) -> Result<Arc<Self>> {
        let mut cmd = Command::new(command);
        cmd.args(args);
        cmd.current_dir(cwd);
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        for (key, value) in env {
            cmd.env(key, value);
        }

        let mut child = cmd.spawn().with_context(|| {
            format!(
                "Failed to spawn terminal command '{command}' in {}",
                cwd.display()
            )
        })?;

        let stdout = child.stdout.take().context("terminal stdout missing")?;
        let stderr = child.stderr.take().context("terminal stderr missing")?;

        let terminal = Arc::new(Self {
            terminal_id: terminal_id.clone(),
            output: Mutex::new(String::new()),
            truncated: Mutex::new(false),
            output_byte_limit,
            child: Mutex::new(child),
            exit_code: Mutex::new(None),
            signal: Mutex::new(None),
        });
        tokio::spawn(Self::read_stream_task(
            terminal.clone(),
            stdout,
        ));
        tokio::spawn(Self::read_stream_task(
            terminal.clone(),
            stderr,
        ));

        Ok(terminal)
    }

    async fn read_stream_task(terminal: Arc<Self>, stream: impl tokio::io::AsyncRead + Unpin) {
        let mut reader = BufReader::new(stream);
        let mut buf = Vec::with_capacity(4096);

        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf).await {
                Ok(0) => break,
                Ok(_) => {
                    let chunk = String::from_utf8_lossy(&buf).to_string();
                    terminal.append_output(chunk).await;
                }
                Err(err) => {
                    log::debug!("[acp terminal {}] stream read error: {err}", terminal.terminal_id);
                    break;
                }
            }
        }
    }

    async fn append_output(&self, chunk: String) {
        let mut output = self.output.lock().await;
        output.push_str(&chunk);

        let Some(limit) = self.output_byte_limit else {
            return;
        };

        if output.len() > limit {
            *self.truncated.lock().await = true;
            *output = truncate_utf8_from_start(output.as_str(), limit);
        }
    }

    async fn snapshot(&self) -> AcpTerminalSnapshot {
        let _ = self.update_exit_status_if_needed().await;
        let output = self.output.lock().await.clone();
        let truncated = *self.truncated.lock().await;
        let exit_code = *self.exit_code.lock().await;
        let signal = self.signal.lock().await.clone();
        let exit_status = if exit_code.is_some() || signal.is_some() {
            Some(json!({ "exitCode": exit_code, "signal": signal }))
        } else {
            None
        };

        AcpTerminalSnapshot {
            output,
            truncated,
            exit_status,
            exit_code,
            signal,
        }
    }

    async fn update_exit_status_if_needed(&self) -> Result<()> {
        if self.exit_code.lock().await.is_some() || self.signal.lock().await.is_some() {
            return Ok(());
        }

        let mut child = self.child.lock().await;
        if let Some(status) = child.try_wait()? {
            *self.exit_code.lock().await = status.code().map(|v| v as u32);

            #[cfg(unix)]
            {
                use std::os::unix::process::ExitStatusExt;
                *self.signal.lock().await = status.signal().map(|s| s.to_string());
            }
            #[cfg(not(unix))]
            {
                *self.signal.lock().await = None;
            }
        }
        Ok(())
    }

    async fn wait_for_exit(&self) -> Result<()> {
        if self.exit_code.lock().await.is_some() || self.signal.lock().await.is_some() {
            return Ok(());
        }

        let mut child = self.child.lock().await;
        let status = child.wait().await?;

        *self.exit_code.lock().await = status.code().map(|v| v as u32);
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            *self.signal.lock().await = status.signal().map(|s| s.to_string());
        }
        #[cfg(not(unix))]
        {
            *self.signal.lock().await = None;
        }

        Ok(())
    }

    async fn kill(&self) -> Result<()> {
        let mut child = self.child.lock().await;
        child.kill().await.ok();
        Ok(())
    }
}

fn truncate_utf8_from_start(input: &str, max_bytes: usize) -> String {
    if input.len() <= max_bytes {
        return input.to_string();
    }

    let start = input.len().saturating_sub(max_bytes);
    let bytes = input.as_bytes();

    let mut idx = start;
    while idx < bytes.len() && !input.is_char_boundary(idx) {
        idx += 1;
    }

    input[idx..].to_string()
}

fn slice_lines(text: &str, line: Option<u64>, limit: Option<u64>) -> String {
    let start_line = line.unwrap_or(1).max(1) as usize;
    let max_lines = limit.map(|v| v as usize);

    let mut out = String::new();
    let mut current = 1usize;
    let mut written = 0usize;

    for l in text.lines() {
        if current < start_line {
            current += 1;
            continue;
        }

        if max_lines.is_some_and(|max| written >= max) {
            break;
        }

        out.push_str(l);
        out.push('\n');
        written += 1;
        current += 1;
    }

    if out.is_empty() && start_line == 1 && max_lines.is_none() {
        text.to_string()
    } else {
        out
    }
}

fn parse_jsonrpc_id(value: &Value) -> Result<JsonRpcId> {
    if let Some(n) = value.as_i64() {
        return Ok(JsonRpcId::Number(n));
    }
    if let Some(s) = value.as_str() {
        return Ok(JsonRpcId::String(s.to_string()));
    }
    Err(anyhow!("Unsupported JSON-RPC id type"))
}

fn canonicalize_existing_ancestor(path: &Path) -> Result<PathBuf> {
    let mut current = path;
    loop {
        match std::fs::canonicalize(current) {
            Ok(resolved) => return Ok(resolved),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                if let Some(parent) = current.parent() {
                    current = parent;
                    continue;
                }
                return Err(err.into());
            }
            Err(err) => return Err(err.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_utf8_preserves_boundaries() {
        let input = "αβγδε"; // 2 bytes per char
        // Force truncation at a mid-char boundary by choosing an odd byte limit.
        let truncated = truncate_utf8_from_start(input, 5);
        assert!(truncated.is_char_boundary(0));
        assert!(truncated.chars().count() >= 2);
    }

    #[test]
    fn slice_lines_respects_line_and_limit() {
        let text = "a\nb\nc\nd\n";
        assert_eq!(slice_lines(text, Some(2), Some(2)), "b\nc\n");
        assert_eq!(slice_lines(text, Some(4), Some(10)), "d\n");
    }

    #[test]
    fn parse_jsonrpc_id_supports_number_and_string() {
        assert_eq!(
            parse_jsonrpc_id(&json!(1)).unwrap(),
            JsonRpcId::Number(1)
        );
        assert_eq!(
            parse_jsonrpc_id(&json!("abc")).unwrap(),
            JsonRpcId::String("abc".to_string())
        );
    }
}
