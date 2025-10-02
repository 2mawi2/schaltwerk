use crate::domains::settings::{Settings, SettingsRepository, SettingsService};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub struct FileSettingsRepository {
    settings_path: PathBuf,
}

impl FileSettingsRepository {
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

        Ok(Self { settings_path })
    }
}

impl SettingsRepository for FileSettingsRepository {
    fn load(&self) -> Result<Settings, String> {
        if self.settings_path.exists() {
            let contents = fs::read_to_string(&self.settings_path)
                .map_err(|e| format!("Failed to read settings file: {e}"))?;
            serde_json::from_str(&contents).or_else(|_| Ok(Settings::default()))
        } else {
            Ok(Settings::default())
        }
    }

    fn save(&self, settings: &Settings) -> Result<(), String> {
        log::debug!("Saving settings to: {:?}", self.settings_path);

        let contents = serde_json::to_string_pretty(settings).map_err(|e| {
            let error = format!("Failed to serialize settings: {e}");
            log::error!("JSON serialization error: {error}");
            error
        })?;

        log::debug!(
            "Settings serialized to JSON, writing to file ({} bytes)",
            contents.len()
        );

        fs::write(&self.settings_path, &contents).map_err(|e| {
            let error = format!(
                "Failed to write settings file {:?}: {e}",
                self.settings_path
            );
            log::error!("File write error: {error}");
            error
        })?;

        log::debug!("Settings successfully written to disk");
        Ok(())
    }
}

pub struct SettingsManager {
    service: SettingsService,
}

impl SettingsManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let repository = Box::new(FileSettingsRepository::new(app_handle)?);
        let service = SettingsService::new(repository);

        Ok(Self { service })
    }

    pub fn get_agent_env_vars(
        &self,
        agent_type: &str,
    ) -> std::collections::HashMap<String, String> {
        self.service.get_agent_env_vars(agent_type)
    }

    pub fn set_agent_env_vars(
        &mut self,
        agent_type: &str,
        env_vars: std::collections::HashMap<String, String>,
    ) -> Result<(), String> {
        self.service
            .set_agent_env_vars(agent_type, env_vars)
            .map_err(|e| e.to_string())
    }

    pub fn get_terminal_ui_preferences(&self) -> crate::domains::settings::TerminalUIPreferences {
        self.service.get_terminal_ui_preferences()
    }

    pub fn set_terminal_collapsed(&mut self, is_collapsed: bool) -> Result<(), String> {
        self.service
            .set_terminal_collapsed(is_collapsed)
            .map_err(|e| e.to_string())
    }

    pub fn set_terminal_divider_position(&mut self, position: f64) -> Result<(), String> {
        self.service
            .set_terminal_divider_position(position)
            .map_err(|e| e.to_string())
    }

    pub fn get_agent_cli_args(&self, agent_type: &str) -> String {
        self.service.get_agent_cli_args(agent_type)
    }

    pub fn set_agent_cli_args(&mut self, agent_type: &str, cli_args: String) -> Result<(), String> {
        self.service
            .set_agent_cli_args(agent_type, cli_args)
            .map_err(|e| e.to_string())
    }

    pub fn get_agent_initial_command(&self, agent_type: &str) -> String {
        self.service.get_agent_initial_command(agent_type)
    }

    pub fn set_agent_initial_command(&mut self, agent_type: &str, initial_command: String) -> Result<(), String> {
        self.service
            .set_agent_initial_command(agent_type, initial_command)
            .map_err(|e| e.to_string())
    }

    pub fn get_terminal_settings(&self) -> crate::domains::settings::TerminalSettings {
        self.service.get_terminal_settings()
    }

    pub fn set_terminal_settings(
        &mut self,
        terminal: crate::domains::settings::TerminalSettings,
    ) -> Result<(), String> {
        self.service
            .set_terminal_settings(terminal)
            .map_err(|e| e.to_string())
    }

    pub fn get_diff_view_preferences(&self) -> crate::domains::settings::DiffViewPreferences {
        self.service.get_diff_view_preferences()
    }

    pub fn set_diff_view_preferences(
        &mut self,
        preferences: crate::domains::settings::DiffViewPreferences,
    ) -> Result<(), String> {
        self.service
            .set_diff_view_preferences(preferences)
            .map_err(|e| e.to_string())
    }

    pub fn get_session_preferences(&self) -> crate::domains::settings::SessionPreferences {
        self.service.get_session_preferences()
    }

    pub fn set_session_preferences(
        &mut self,
        preferences: crate::domains::settings::SessionPreferences,
    ) -> Result<(), String> {
        self.service
            .set_session_preferences(preferences)
            .map_err(|e| e.to_string())
    }

    pub fn get_keyboard_shortcuts(&self) -> std::collections::HashMap<String, Vec<String>> {
        self.service.get_keyboard_shortcuts()
    }

    pub fn set_keyboard_shortcuts(
        &mut self,
        shortcuts: std::collections::HashMap<String, Vec<String>>,
    ) -> Result<(), String> {
        self.service
            .set_keyboard_shortcuts(shortcuts)
            .map_err(|e| e.to_string())
    }

    pub fn get_auto_commit_on_review(&self) -> bool {
        self.service.get_auto_commit_on_review()
    }

    pub fn set_auto_commit_on_review(&mut self, auto_commit: bool) -> Result<(), String> {
        self.service
            .set_auto_commit_on_review(auto_commit)
            .map_err(|e| e.to_string())
    }

    pub fn get_agent_binary_config(
        &self,
        agent_name: &str,
    ) -> Option<crate::domains::settings::AgentBinaryConfig> {
        self.service.get_agent_binary_config(agent_name)
    }

    pub fn set_agent_binary_config(
        &mut self,
        config: crate::domains::settings::AgentBinaryConfig,
    ) -> Result<(), String> {
        self.service
            .set_agent_binary_config(config)
            .map_err(|e| e.to_string())
    }

    pub fn get_all_agent_binary_configs(&self) -> Vec<crate::domains::settings::AgentBinaryConfig> {
        self.service.get_all_agent_binary_configs()
    }

    pub fn get_effective_binary_path(&self, agent_name: &str) -> Result<String, String> {
        self.service
            .get_effective_binary_path(agent_name)
            .map_err(|e| e.to_string())
    }
}
