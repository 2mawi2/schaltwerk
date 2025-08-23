use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateParams {
    pub id: String,
    pub cwd: String,
    pub app: Option<ApplicationSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationSpec {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub ready_timeout_ms: u64,
}

#[async_trait::async_trait]
pub trait TerminalBackend: Send + Sync {
    async fn create(&self, params: CreateParams) -> Result<(), String>;
    async fn create_with_size(&self, params: CreateParams, cols: u16, rows: u16) -> Result<(), String>;
    async fn write(&self, id: &str, data: &[u8]) -> Result<(), String>;
    async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String>;
    async fn close(&self, id: &str) -> Result<(), String>;
    async fn exists(&self, id: &str) -> Result<bool, String>;
    async fn snapshot(&self, id: &str, from_seq: Option<u64>) -> Result<(u64, Vec<u8>), String>;
}

pub mod local;
pub mod manager;

pub use local::LocalPtyAdapter;
pub use manager::TerminalManager;

pub fn get_shell_binary() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        "/bin/bash".to_string()
    })
}