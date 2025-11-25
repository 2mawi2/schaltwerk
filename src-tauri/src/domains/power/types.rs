use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::process::Child;
use std::time::{Instant, SystemTime};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GlobalState {
    Disabled,
    Active,
    AutoPaused,
}

#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub command_line: String,
    pub spawned_at: SystemTime,
}

#[derive(Debug)]
pub struct InhibitorState {
    pub user_enabled: bool,
    pub active_sessions: HashSet<String>,
    pub running_sessions: HashSet<String>,
    pub running_by_project: std::collections::HashMap<String, HashSet<String>>,
    pub process_info: Option<ProcessInfo>,
    pub child: Option<Child>,
    pub last_watchdog_check: Instant,
    pub idle_deadline: Option<Instant>,
    pub last_emitted_state: Option<GlobalState>,
}

impl Default for InhibitorState {
    fn default() -> Self {
        Self {
            user_enabled: false,
            active_sessions: HashSet::new(),
            running_sessions: HashSet::new(),
            running_by_project: std::collections::HashMap::new(),
            process_info: None,
            child: None,
            last_watchdog_check: Instant::now(),
            idle_deadline: None,
            last_emitted_state: None,
        }
    }
}
