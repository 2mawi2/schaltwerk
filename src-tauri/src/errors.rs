use serde::Serialize;
use std::fmt;

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", content = "data")]
pub enum SchaltError {
    SessionNotFound {
        session_id: String,
    },
    SessionAlreadyExists {
        session_id: String,
    },
    WorktreeNotFound {
        path: String,
    },
    WorktreeAlreadyExists {
        path: String,
    },
    GitOperationFailed {
        operation: String,
        message: String,
    },
    DatabaseError {
        message: String,
    },
    InvalidInput {
        field: String,
        message: String,
    },
    TerminalNotFound {
        terminal_id: String,
    },
    TerminalOperationFailed {
        terminal_id: String,
        operation: String,
        message: String,
    },
    ProjectNotFound {
        project_path: String,
    },
    IoError {
        operation: String,
        path: String,
        message: String,
    },
    MergeConflict {
        files: Vec<String>,
        message: String,
    },
    InvalidSessionState {
        session_id: String,
        current_state: String,
        expected_state: String,
    },
    AgentNotFound {
        agent_name: String,
    },
    ConfigError {
        key: String,
        message: String,
    },
}

impl SchaltError {
    pub fn from_session_lookup(session_id: &str, error: impl ToString) -> Self {
        let message = error.to_string();
        let normalized = message.to_lowercase();
        if normalized.contains("query returned no rows")
            || normalized.contains("session not found")
            || normalized.contains("failed to get session")
        {
            SchaltError::SessionNotFound {
                session_id: session_id.to_string(),
            }
        } else {
            SchaltError::DatabaseError { message }
        }
    }

    pub fn git(operation: &str, error: impl ToString) -> Self {
        SchaltError::GitOperationFailed {
            operation: operation.to_string(),
            message: error.to_string(),
        }
    }

    pub fn io(operation: &str, path: impl ToString, error: impl ToString) -> Self {
        SchaltError::IoError {
            operation: operation.to_string(),
            path: path.to_string(),
            message: error.to_string(),
        }
    }

    pub fn invalid_input(field: &str, message: impl ToString) -> Self {
        SchaltError::InvalidInput {
            field: field.to_string(),
            message: message.to_string(),
        }
    }
}

impl fmt::Display for SchaltError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::SessionNotFound { session_id } => {
                write!(f, "Session '{session_id}' not found")
            }
            Self::SessionAlreadyExists { session_id } => {
                write!(f, "Session '{session_id}' already exists")
            }
            Self::WorktreeNotFound { path } => {
                write!(f, "Worktree not found at path: {path}")
            }
            Self::WorktreeAlreadyExists { path } => {
                write!(f, "Worktree already exists at path: {path}")
            }
            Self::GitOperationFailed { operation, message } => {
                write!(f, "Git operation '{operation}' failed: {message}")
            }
            Self::DatabaseError { message } => {
                write!(f, "Database error: {message}")
            }
            Self::InvalidInput { field, message } => {
                write!(f, "Invalid input for field '{field}': {message}")
            }
            Self::TerminalNotFound { terminal_id } => {
                write!(f, "Terminal '{terminal_id}' not found")
            }
            Self::TerminalOperationFailed {
                terminal_id,
                operation,
                message,
            } => {
                write!(
                    f,
                    "Terminal operation '{operation}' failed for terminal '{terminal_id}': {message}"
                )
            }
            Self::ProjectNotFound { project_path } => {
                write!(f, "Project not found at path: {project_path}")
            }
            Self::IoError {
                operation,
                path,
                message,
            } => {
                write!(f, "I/O error during '{operation}' on '{path}': {message}")
            }
            Self::MergeConflict { files, message } => {
                write!(f, "Merge conflict in {} file(s): {message}", files.len())
            }
            Self::InvalidSessionState {
                session_id,
                current_state,
                expected_state,
            } => {
                write!(
                    f,
                    "Session '{session_id}' is in state '{current_state}', expected '{expected_state}'"
                )
            }
            Self::AgentNotFound { agent_name } => {
                write!(f, "Agent '{agent_name}' not found")
            }
            Self::ConfigError { key, message } => {
                write!(f, "Configuration error for key '{key}': {message}")
            }
        }
    }
}

impl std::error::Error for SchaltError {}

impl From<SchaltError> for String {
    fn from(error: SchaltError) -> Self {
        error.to_string()
    }
}
