use thiserror::Error;

#[derive(Debug, Error)]
pub enum PtyHostError {
    #[error("terminal not found: {0}")]
    TerminalNotFound(String),
    #[error("terminal already exists: {0}")]
    TerminalExists(String),
    #[error("io error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, PtyHostError>;
