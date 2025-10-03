use std::sync::Arc;

use once_cell::sync::OnceCell;
use pty_host::{
    AckRequest, EventSink, KillRequest, PtyHost, ResizeRequest, SpawnRequest, SpawnResponse,
    SubscribeRequest, SubscribeResponse, WriteRequest,
};
use serde::Serialize;
use std::sync::RwLock;
use tauri::{AppHandle, Emitter};

use crate::events::{emit_event, SchaltEvent};

#[derive(Debug, Clone, Serialize)]
pub struct PtyDataPayload {
    pub term_id: String,
    pub seq: u64,
    pub base64: String,
}

#[derive(Debug, Clone, Serialize)]
struct TerminalClosedPayload {
    terminal_id: String,
}

#[derive(Default)]
struct TauriEventSink {
    app_handle: RwLock<Option<AppHandle>>,
}

impl TauriEventSink {
    fn set_app_handle(&self, handle: AppHandle) {
        match self.app_handle.write() {
            Ok(mut guard) => *guard = Some(handle),
            Err(err) => log::warn!("failed to store app handle for PTY sink: {err}"),
        }
    }

    fn emit_terminal_closed(&self, term_id: &str) {
        let handle = match self.app_handle.read() {
            Ok(guard) => guard.clone(),
            Err(err) => {
                log::warn!("failed to read app handle for terminal closed event: {err}");
                None
            }
        };

        if let Some(app) = handle {
            let payload = TerminalClosedPayload {
                terminal_id: term_id.to_string(),
            };
            if let Err(err) = emit_event(&app, SchaltEvent::TerminalClosed, &payload) {
                log::warn!("failed to emit terminal closed event: {err}");
            }
        }
    }
}

impl EventSink for TauriEventSink {
    fn emit_chunk(&self, term_id: &str, seq: u64, base64: String) {
        let handle = match self.app_handle.read() {
            Ok(guard) => guard.clone(),
            Err(err) => {
                log::warn!("failed to read app handle for PTY sink: {err}");
                None
            }
        };

        if let Some(handle) = handle {
            let payload = PtyDataPayload {
                term_id: term_id.to_string(),
                seq,
                base64,
            };
            if let Err(err) = handle.emit(SchaltEvent::PtyData.as_str(), &payload) {
                log::warn!("failed to emit PTY data event: {err}");
            }
        }
    }

    fn emit_exit(&self, term_id: &str) {
        self.emit_terminal_closed(term_id);
    }
}

#[derive(Clone)]
pub struct PtyHostManager {
    host: Arc<PtyHost>,
    sink: Arc<TauriEventSink>,
}

impl PtyHostManager {
    fn new() -> Self {
        let sink = Arc::new(TauriEventSink::default());
        let host = Arc::new(PtyHost::new(sink.clone()));
        Self { host, sink }
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        self.sink.set_app_handle(handle);
    }

    pub async fn spawn(&self, request: SpawnRequest) -> Result<SpawnResponse, String> {
        self.host.spawn(request).await.map_err(|e| e.to_string())
    }

    pub async fn write(&self, request: WriteRequest) -> Result<(), String> {
        self.host.write(request).await.map_err(|e| e.to_string())
    }

    pub async fn resize(&self, request: ResizeRequest) -> Result<(), String> {
        self.host.resize(request).await.map_err(|e| e.to_string())
    }

    pub async fn kill(&self, request: KillRequest) -> Result<(), String> {
        let term_id = request.term_id.clone();
        let result = self.host.kill(request).await.map_err(|e| e.to_string());
        if result.is_ok() {
            self.sink.emit_terminal_closed(&term_id);
        }
        result
    }

    pub async fn ack(&self, request: AckRequest) -> Result<(), String> {
        self.host.ack(request).await.map_err(|e| e.to_string())
    }

    pub async fn subscribe(&self, request: SubscribeRequest) -> Result<SubscribeResponse, String> {
        self.host
            .subscribe(request)
            .await
            .map_err(|e| e.to_string())
    }
}

static PTY_HOST_INSTANCE: OnceCell<Arc<PtyHostManager>> = OnceCell::new();

pub fn get_pty_host() -> Arc<PtyHostManager> {
    PTY_HOST_INSTANCE
        .get_or_init(|| Arc::new(PtyHostManager::new()))
        .clone()
}
