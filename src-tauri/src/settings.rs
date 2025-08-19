use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

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
pub struct Settings {
    pub agent_env_vars: AgentEnvVars,
    pub terminal_ui: TerminalUIPreferences,
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
        
        let settings = if settings_path.exists() {
            let contents = fs::read_to_string(&settings_path)
                .map_err(|e| format!("Failed to read settings file: {e}"))?;
            serde_json::from_str(&contents)
                .unwrap_or_else(|_| Settings::default())
        } else {
            Settings::default()
        };
        
        Ok(Self {
            settings_path,
            settings,
        })
    }
    
    pub fn save(&self) -> Result<(), String> {
        let contents = serde_json::to_string_pretty(&self.settings)
            .map_err(|e| format!("Failed to serialize settings: {e}"))?;
        
        fs::write(&self.settings_path, contents)
            .map_err(|e| format!("Failed to write settings file: {e}"))?;
        
        Ok(())
    }
    
    pub fn get_agent_env_vars(&self, agent_type: &str) -> HashMap<String, String> {
        match agent_type {
            "claude" => self.settings.agent_env_vars.claude.clone(),
            "cursor" => self.settings.agent_env_vars.cursor.clone(),
            "opencode" => self.settings.agent_env_vars.opencode.clone(),
            "gemini" => self.settings.agent_env_vars.gemini.clone(),
            "codex" => self.settings.agent_env_vars.codex.clone(),
            _ => HashMap::new(),
        }
    }
    
    pub fn set_agent_env_vars(&mut self, agent_type: &str, env_vars: HashMap<String, String>) -> Result<(), String> {
        match agent_type {
            "claude" => self.settings.agent_env_vars.claude = env_vars,
            "cursor" => self.settings.agent_env_vars.cursor = env_vars,
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
}