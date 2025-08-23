use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::str::FromStr;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFile {
    pub path: String,
    pub change_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    // Optional human-friendly display name (does not affect git branch/worktree)
    pub display_name: Option<String>,
    pub repository_path: PathBuf,
    pub repository_name: String,
    pub branch: String,
    pub parent_branch: String,
    pub worktree_path: PathBuf,
    pub status: SessionStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_activity: Option<DateTime<Utc>>,
    pub initial_prompt: Option<String>,
    pub ready_to_merge: bool,
    // If present, captures the agent type that originally opened this session (e.g., "claude" or "cursor")
    pub original_agent_type: Option<String>,
    // If present, captures whether skip-permissions/force was enabled when the session was originally opened
    pub original_skip_permissions: Option<bool>,
    // Internal flag to decide whether we should auto-generate a display name post-start
    pub pending_name_generation: bool,
    // True if the session name was auto-generated (e.g., docker-style names)
    pub was_auto_generated: bool,
    // Content for draft tasks (markdown format)
    pub draft_content: Option<String>,
    // Current session state (Draft, Running, Reviewed)
    pub session_state: SessionState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Active,
    Cancelled,
    Draft,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Draft,
    Running,
    Reviewed,
}

impl SessionStatus {
    pub fn as_str(&self) -> &str {
        match self {
            SessionStatus::Active => "active",
            SessionStatus::Cancelled => "cancelled",
            SessionStatus::Draft => "draft",
        }
    }
}

impl FromStr for SessionStatus {
    type Err = String;
    
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(SessionStatus::Active),
            "cancelled" => Ok(SessionStatus::Cancelled),
            "draft" => Ok(SessionStatus::Draft),
            _ => Err(format!("Invalid session status: {s}")),
        }
    }
}

impl SessionState {
    pub fn as_str(&self) -> &str {
        match self {
            SessionState::Draft => "draft",
            SessionState::Running => "running", 
            SessionState::Reviewed => "reviewed",
        }
    }
}

impl FromStr for SessionState {
    type Err = String;
    
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "draft" => Ok(SessionState::Draft),
            "running" => Ok(SessionState::Running),
            "reviewed" => Ok(SessionState::Reviewed),
            _ => Err(format!("Invalid session state: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStats {
    pub session_id: String,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub has_uncommitted: bool,
    pub calculated_at: DateTime<Utc>,
    // Timestamp (unix seconds) of the most recent meaningful diff change:
    // max(latest commit ahead of base, latest mtime among uncommitted changed files)
    pub last_diff_change_ts: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionParams {
    pub name: String,
    pub prompt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CancelSessionParams {
    pub name: String,
}


#[derive(Debug, Serialize, Deserialize)]
pub struct GetSessionStatusParams {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionStatusResponse {
    pub name: String,
    pub status: String,
    pub files_changed: u32,
    pub lines_added: u32,
    pub has_uncommitted: bool,
    pub last_activity: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatusType {
    Active,
    Dirty,
    Missing,
    Archived,
    Draft,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionType {
    Worktree,
    Container,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffStats {
    #[serde(default)]
    pub files_changed: usize,
    #[serde(default)]
    pub additions: usize,
    pub deletions: usize,
    #[serde(default)]
    pub insertions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub branch: String,
    pub worktree_path: String,
    pub base_branch: String,
    pub merge_mode: String,
    pub status: SessionStatusType,
    pub created_at: Option<DateTime<Utc>>,
    pub last_modified: Option<DateTime<Utc>>,
    pub has_uncommitted_changes: Option<bool>,
    pub is_current: bool,
    pub session_type: SessionType,
    pub container_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_task: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_stats: Option<DiffStats>,
    #[serde(default)]
    pub ready_to_merge: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft_content: Option<String>,
    pub session_state: SessionState,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnrichedSession {
    pub info: SessionInfo,
    pub status: Option<SessionMonitorStatus>,
    pub terminals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMonitorStatus {
    pub session_name: String,
    pub current_task: String,
    pub test_status: TestStatus,
    pub diff_stats: Option<DiffStats>,
    pub last_update: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TestStatus {
    Passed,
    Failed,
    Unknown,
}

