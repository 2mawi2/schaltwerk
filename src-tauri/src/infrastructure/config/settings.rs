use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use crate::binary_detector::DetectedBinary;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentCliArgs {
    pub claude: String,
    pub cursor: String,
    pub opencode: String,
    pub gemini: String,
    pub codex: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentEnvVars {
    pub claude: HashMap<String, String>,
    pub cursor: HashMap<String, String>,
    pub opencode: HashMap<String, String>,
    pub gemini: HashMap<String, String>,
    pub codex: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TerminalUIPreferences {
    pub is_collapsed: bool,
    pub divider_position: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DiffViewPreferences {
    pub continuous_scroll: bool,  // false = single file view, true = continuous scroll
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SessionPreferences {
    pub auto_commit_on_review: bool,  // automatically commit changes when marking sessions as reviewed
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    pub shell: Option<String>,
    pub shell_args: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentBinaryConfig {
    pub agent_name: String,
    pub custom_path: Option<String>,
    pub auto_detect: bool,
    pub detected_binaries: Vec<DetectedBinary>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentBinaryConfigs {
    pub claude: Option<AgentBinaryConfig>,
    pub cursor_agent: Option<AgentBinaryConfig>,
    pub opencode: Option<AgentBinaryConfig>,
    pub gemini: Option<AgentBinaryConfig>,
    pub codex: Option<AgentBinaryConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    pub agent_env_vars: AgentEnvVars,
    pub agent_cli_args: AgentCliArgs,
    pub terminal_ui: TerminalUIPreferences,
    pub terminal: TerminalSettings,
    pub agent_binaries: AgentBinaryConfigs,
    pub diff_view: DiffViewPreferences,
    pub session: SessionPreferences,
}

pub struct SettingsManager {
    settings_path: PathBuf,
    settings: Settings,
}

impl SettingsManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|e| format!("Failed to get config directory: {e}"))?;
        
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir)
                .map_err(|e| format!("Failed to create config directory: {e}"))?;
        }
        
        let settings_path = config_dir.join("settings.json");
        
        let mut settings = if settings_path.exists() {
            let contents = fs::read_to_string(&settings_path)
                .map_err(|e| format!("Failed to read settings file: {e}"))?;
            serde_json::from_str(&contents)
                .unwrap_or_else(|_| Settings::default())
        } else {
            Settings::default()
        };
        
        // Clean up any invalid JavaScript file paths in binary configs
        Self::clean_invalid_binary_paths(&mut settings);
        
        Ok(Self {
            settings_path,
            settings,
        })
    }
    
    fn clean_invalid_binary_paths(settings: &mut Settings) {
        // Helper to check if a path is invalid (points to .js file) and try to fix it
        let fix_config = |config: &mut Option<AgentBinaryConfig>| {
            if let Some(cfg) = config {
                if let Some(ref path) = cfg.custom_path.clone() {
                    if path.ends_with(".js") || path.ends_with(".mjs") {
                        log::warn!("Found JS file path for {}: {}, attempting to fix", cfg.agent_name, path);
                        
                        // Try to find the correct binary wrapper
                        let possible_locations = vec![
                            format!("/opt/homebrew/bin/{}", cfg.agent_name),
                            format!("/usr/local/bin/{}", cfg.agent_name),
                            format!("/opt/homebrew/Cellar/node/24.4.0/bin/{}", cfg.agent_name),
                            format!("{}/.local/bin/{}", std::env::var("HOME").unwrap_or_default(), cfg.agent_name),
                        ];
                        
                        let mut found_wrapper = None;
                        for location in &possible_locations {
                            if std::path::Path::new(location).exists() {
                                log::info!("Found correct binary wrapper at {location}, replacing JS path");
                                found_wrapper = Some(location.clone());
                                break;
                            }
                        }
                        
                        if let Some(wrapper) = found_wrapper {
                            cfg.custom_path = Some(wrapper);
                        } else {
                            // If we can't find a wrapper, revert to auto-detect
                            log::warn!("Could not find binary wrapper for {}, reverting to auto-detect", cfg.agent_name);
                            cfg.custom_path = None;
                            cfg.auto_detect = true;
                        }
                    }
                }
            }
        };
        
        fix_config(&mut settings.agent_binaries.claude);
        fix_config(&mut settings.agent_binaries.cursor_agent);
        fix_config(&mut settings.agent_binaries.opencode);
        fix_config(&mut settings.agent_binaries.gemini);
        fix_config(&mut settings.agent_binaries.codex);
    }
    
    pub fn save(&mut self) -> Result<(), String> {
        log::debug!("Saving settings to: {:?}", self.settings_path);
        
        let contents = serde_json::to_string_pretty(&self.settings)
            .map_err(|e| {
                let error = format!("Failed to serialize settings: {e}");
                log::error!("JSON serialization error: {error}");
                error
            })?;
        
        log::debug!("Settings serialized to JSON, writing to file ({} bytes)", contents.len());
        
        fs::write(&self.settings_path, &contents)
            .map_err(|e| {
                let error = format!("Failed to write settings file {:?}: {e}", self.settings_path);
                log::error!("File write error: {error}");
                error
            })?;
        
        log::debug!("Settings successfully written to disk");
        Ok(())
    }
    
    pub fn get_agent_env_vars(&self, agent_type: &str) -> HashMap<String, String> {
        match agent_type {
            "claude" => self.settings.agent_env_vars.claude.clone(),
            "cursor" | "cursor-agent" => self.settings.agent_env_vars.cursor.clone(),
            "opencode" => self.settings.agent_env_vars.opencode.clone(),
            "gemini" => self.settings.agent_env_vars.gemini.clone(),
            "codex" => self.settings.agent_env_vars.codex.clone(),
            _ => HashMap::new(),
        }
    }
    
    pub fn set_agent_env_vars(&mut self, agent_type: &str, env_vars: HashMap<String, String>) -> Result<(), String> {
        match agent_type {
            "claude" => self.settings.agent_env_vars.claude = env_vars,
            "cursor" | "cursor-agent" => self.settings.agent_env_vars.cursor = env_vars,
            "opencode" => self.settings.agent_env_vars.opencode = env_vars,
            "gemini" => self.settings.agent_env_vars.gemini = env_vars,
            "codex" => self.settings.agent_env_vars.codex = env_vars,
            _ => return Err(format!("Unknown agent type: {agent_type}")),
        }
        
        self.save()
    }
    
    pub fn get_terminal_ui_preferences(&self) -> TerminalUIPreferences {
        self.settings.terminal_ui.clone()
    }
    
    pub fn set_terminal_collapsed(&mut self, is_collapsed: bool) -> Result<(), String> {
        self.settings.terminal_ui.is_collapsed = is_collapsed;
        self.save()
    }
    
    pub fn set_terminal_divider_position(&mut self, position: f64) -> Result<(), String> {
        self.settings.terminal_ui.divider_position = Some(position);
        self.save()
    }
    
    pub fn get_agent_cli_args(&self, agent_type: &str) -> String {
        match agent_type {
            "claude" => self.settings.agent_cli_args.claude.clone(),
            "cursor" | "cursor-agent" => self.settings.agent_cli_args.cursor.clone(),
            "opencode" => self.settings.agent_cli_args.opencode.clone(),
            "gemini" => self.settings.agent_cli_args.gemini.clone(),
            "codex" => self.settings.agent_cli_args.codex.clone(),
            _ => String::new(),
        }
    }
    
    pub fn set_agent_cli_args(&mut self, agent_type: &str, cli_args: String) -> Result<(), String> {
        log::debug!("Setting CLI args in settings: agent_type='{agent_type}', cli_args='{cli_args}'");
        
        match agent_type {
            "claude" => self.settings.agent_cli_args.claude = cli_args.clone(),
            "cursor" | "cursor-agent" => self.settings.agent_cli_args.cursor = cli_args.clone(),
            "opencode" => self.settings.agent_cli_args.opencode = cli_args.clone(),
            "gemini" => self.settings.agent_cli_args.gemini = cli_args.clone(),
            "codex" => self.settings.agent_cli_args.codex = cli_args.clone(),
            _ => {
                let error = format!("Unknown agent type: {agent_type}");
                log::error!("Invalid agent type in set_agent_cli_args: {error}");
                return Err(error);
            }
        }
        
        log::debug!("CLI args set in memory, now saving to disk");
        
        match self.save() {
            Ok(()) => {
                log::debug!("Successfully saved CLI args for agent '{agent_type}' to disk");
                Ok(())
            }
            Err(e) => {
                log::error!("Failed to save CLI args to disk for agent '{agent_type}': {e}");
                Err(e)
            }
        }
    }
    
    pub fn get_terminal_settings(&self) -> TerminalSettings {
        self.settings.terminal.clone()
    }
    
    pub fn set_terminal_settings(&mut self, terminal: TerminalSettings) -> Result<(), String> {
        self.settings.terminal = terminal;
        self.save()
    }
    
    pub fn get_diff_view_preferences(&self) -> DiffViewPreferences {
        self.settings.diff_view.clone()
    }
    
    pub fn set_diff_view_preferences(&mut self, preferences: DiffViewPreferences) -> Result<(), String> {
        self.settings.diff_view = preferences;
        self.save()
    }
    
    pub fn get_session_preferences(&self) -> SessionPreferences {
        self.settings.session.clone()
    }
    
    pub fn set_session_preferences(&mut self, preferences: SessionPreferences) -> Result<(), String> {
        self.settings.session = preferences;
        self.save()
    }
    
    pub fn get_auto_commit_on_review(&self) -> bool {
        self.settings.session.auto_commit_on_review
    }
    
    pub fn set_auto_commit_on_review(&mut self, auto_commit: bool) -> Result<(), String> {
        self.settings.session.auto_commit_on_review = auto_commit;
        self.save()
    }
    
    pub fn get_agent_binary_config(&self, agent_name: &str) -> Option<AgentBinaryConfig> {
        match agent_name {
            "claude" => self.settings.agent_binaries.claude.clone(),
            "cursor-agent" => self.settings.agent_binaries.cursor_agent.clone(),
            "opencode" => self.settings.agent_binaries.opencode.clone(),
            "gemini" => self.settings.agent_binaries.gemini.clone(),
            "codex" => self.settings.agent_binaries.codex.clone(),
            _ => None,
        }
    }
    
    pub fn set_agent_binary_config(&mut self, config: AgentBinaryConfig) -> Result<(), String> {
        match config.agent_name.as_str() {
            "claude" => self.settings.agent_binaries.claude = Some(config),
            "cursor-agent" => self.settings.agent_binaries.cursor_agent = Some(config),
            "opencode" => self.settings.agent_binaries.opencode = Some(config),
            "gemini" => self.settings.agent_binaries.gemini = Some(config),
            "codex" => self.settings.agent_binaries.codex = Some(config),
            _ => return Err(format!("Unknown agent: {}", config.agent_name)),
        }
        self.save()
    }
    
    pub fn get_all_agent_binary_configs(&self) -> Vec<AgentBinaryConfig> {
        let mut configs = Vec::new();
        if let Some(config) = &self.settings.agent_binaries.claude {
            configs.push(config.clone());
        }
        if let Some(config) = &self.settings.agent_binaries.cursor_agent {
            configs.push(config.clone());
        }
        if let Some(config) = &self.settings.agent_binaries.opencode {
            configs.push(config.clone());
        }
        if let Some(config) = &self.settings.agent_binaries.gemini {
            configs.push(config.clone());
        }
        if let Some(config) = &self.settings.agent_binaries.codex {
            configs.push(config.clone());
        }
        configs
    }

    pub fn get_effective_binary_path(&self, agent_name: &str) -> Result<String, String> {
        if let Some(config) = self.get_agent_binary_config(agent_name) {
            if let Some(custom_path) = &config.custom_path {
                return Ok(custom_path.clone());
            }
            
            if let Some(recommended) = config.detected_binaries.iter().find(|b| b.is_recommended) {
                return Ok(recommended.path.clone());
            }
            
            if let Some(first) = config.detected_binaries.first() {
                return Ok(first.path.clone());
            }
        }
        
        Ok(agent_name.to_string())
    }
}