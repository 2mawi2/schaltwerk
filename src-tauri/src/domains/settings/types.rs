use crate::binary_detector::DetectedBinary;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentCliArgs {
    pub claude: String,
    pub opencode: String,
    pub gemini: String,
    pub codex: String,
    pub droid: String,
    pub qwen: String,
    pub amp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentInitialCommands {
    pub claude: String,
    pub opencode: String,
    pub gemini: String,
    pub codex: String,
    pub droid: String,
    pub qwen: String,
    pub amp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentEnvVars {
    pub claude: HashMap<String, String>,
    pub opencode: HashMap<String, String>,
    pub gemini: HashMap<String, String>,
    pub codex: HashMap<String, String>,
    pub droid: HashMap<String, String>,
    pub qwen: HashMap<String, String>,
    pub amp: HashMap<String, String>,
    pub terminal: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TerminalUIPreferences {
    pub is_collapsed: bool,
    pub divider_position: Option<f64>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiffViewPreferences {
    #[serde(default)]
    pub continuous_scroll: bool,
    #[serde(default = "default_true")]
    pub compact_diffs: bool,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
}

impl Default for DiffViewPreferences {
    fn default() -> Self {
        Self {
            continuous_scroll: false,
            compact_diffs: true,
            sidebar_width: default_sidebar_width(),
        }
    }
}

fn default_sidebar_width() -> u32 {
    320
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SessionPreferences {
    pub auto_commit_on_review: bool,
    #[serde(default)]
    pub skip_confirmation_modals: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdaterPreferences {
    #[serde(default = "default_true")]
    pub auto_update_enabled: bool,
}

impl Default for UpdaterPreferences {
    fn default() -> Self {
        Self {
            auto_update_enabled: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    pub shell: Option<String>,
    pub shell_args: Vec<String>,
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default = "default_true")]
    pub webgl_enabled: bool,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            shell: None,
            shell_args: Vec::new(),
            font_family: None,
            webgl_enabled: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct AgentBinaryConfig {
    pub agent_name: String,
    pub custom_path: Option<String>,
    pub auto_detect: bool,
    pub detected_binaries: Vec<DetectedBinary>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentBinaryConfigs {
    pub claude: Option<AgentBinaryConfig>,
    pub opencode: Option<AgentBinaryConfig>,
    pub gemini: Option<AgentBinaryConfig>,
    pub codex: Option<AgentBinaryConfig>,
    pub droid: Option<AgentBinaryConfig>,
    pub qwen: Option<AgentBinaryConfig>,
    pub amp: Option<AgentBinaryConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    pub agent_env_vars: AgentEnvVars,
    pub agent_cli_args: AgentCliArgs,
    #[serde(default)]
    pub agent_initial_commands: AgentInitialCommands,
    pub terminal_ui: TerminalUIPreferences,
    pub terminal: TerminalSettings,
    pub agent_binaries: AgentBinaryConfigs,
    pub diff_view: DiffViewPreferences,
    pub session: SessionPreferences,
    #[serde(default)]
    pub updater: UpdaterPreferences,
    #[serde(default)]
    pub keyboard_shortcuts: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub tutorial_completed: bool,
}
