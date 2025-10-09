use async_trait::async_trait;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::{Mutex, OnceCell};

#[async_trait]
pub trait McpBackend: Send + Sync {
    async fn start_server(&self, port: Option<u16>) -> Result<(), String>;
}

#[async_trait]
pub trait McpService: Send + Sync {
    async fn start_server(&self, port: Option<u16>) -> Result<(), String>;
}

pub struct McpServiceImpl<B: McpBackend> {
    backend: B,
}

impl<B: McpBackend> McpServiceImpl<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    pub async fn start_server(&self, port: Option<u16>) -> Result<(), String> {
        self.backend
            .start_server(port)
            .await
            .map_err(|err| format!("Failed to start MCP server: {err}"))
    }
}

#[async_trait]
impl<B> McpService for McpServiceImpl<B>
where
    B: McpBackend + Sync,
{
    async fn start_server(&self, port: Option<u16>) -> Result<(), String> {
        McpServiceImpl::start_server(self, port).await
    }
}

static MCP_SERVER_PROCESS: OnceCell<Arc<Mutex<Option<Child>>>> = OnceCell::const_new();

pub fn get_mcp_server_process() -> &'static OnceCell<Arc<Mutex<Option<Child>>>> {
    &MCP_SERVER_PROCESS
}

pub struct ProcessMcpBackend;

impl ProcessMcpBackend {
    fn node_entry_point() -> Result<PathBuf, String> {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()
            .ok_or_else(|| "Failed to get project root".to_string())?
            .to_path_buf();

        let path = project_root
            .join("mcp-server")
            .join("build")
            .join("schaltwerk-mcp-server.js");
        if !path.exists() {
            Err(format!("MCP server not found at: {}", path.display()))
        } else {
            Ok(path)
        }
    }
}

#[async_trait]
impl McpBackend for ProcessMcpBackend {
    async fn start_server(&self, _port: Option<u16>) -> Result<(), String> {
        let process_mutex = MCP_SERVER_PROCESS
            .get_or_init(|| async { Arc::new(Mutex::new(None)) })
            .await;

        let mut guard = process_mutex.lock().await;
        if let Some(ref mut process) = *guard {
            match process.try_wait() {
                Ok(Some(status)) => {
                    log::info!("Previous MCP server exited with status: {status:?}");
                }
                Ok(None) => {
                    log::info!("MCP server already running");
                    return Ok(());
                }
                Err(e) => log::warn!("Error checking MCP server status: {e}"),
            }
        }

        let entry = Self::node_entry_point()?;
        log::info!("Starting MCP server process at {}", entry.display());

        let child = Command::new("node")
            .arg(&entry)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                let msg = format!("Failed to start MCP server: {e}");
                log::error!("{msg}");
                msg
            })?;

        log::info!(
            "MCP server process started successfully with PID: {:?}",
            child.id()
        );
        *guard = Some(child);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::{Arc, Mutex};

    struct RecordingBackend {
        ports: Arc<Mutex<Vec<Option<u16>>>>,
    }

    #[async_trait]
    impl McpBackend for RecordingBackend {
        async fn start_server(&self, port: Option<u16>) -> Result<(), String> {
            self.ports.lock().unwrap().push(port);
            Ok(())
        }
    }

    struct ErrorBackend;

    #[async_trait]
    impl McpBackend for ErrorBackend {
        async fn start_server(&self, _port: Option<u16>) -> Result<(), String> {
            Err("spawn error".to_string())
        }
    }

    #[tokio::test]
    async fn delegates_to_backend() {
        let ports = Arc::new(Mutex::new(Vec::new()));
        let backend = RecordingBackend {
            ports: Arc::clone(&ports),
        };
        let service = McpServiceImpl::new(backend);

        let result = service.start_server(Some(9000)).await;
        assert!(
            result.is_ok(),
            "expected start_server to succeed: {result:?}"
        );

        let recorded = ports.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0], Some(9000));
    }

    #[tokio::test]
    async fn wraps_errors_with_context() {
        let service = McpServiceImpl::new(ErrorBackend);
        let result = service.start_server(None).await;
        assert!(result.is_err(), "expected error when backend fails");
        let message = result.unwrap_err();
        assert!(
            message.contains("spawn error"),
            "error should include backend cause: {message}"
        );
        assert!(
            message.contains("start MCP server"),
            "error should describe operation: {message}"
        );
    }
}
