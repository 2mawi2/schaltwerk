use super::types::*;
use super::validation::clean_invalid_binary_paths;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub enum SettingsServiceError {
    UnknownAgentType(String),
    RepositoryError(String),
}

impl std::fmt::Display for SettingsServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettingsServiceError::UnknownAgentType(agent) => {
                write!(f, "Unknown agent type: {agent}")
            }
            SettingsServiceError::RepositoryError(msg) => write!(f, "Repository error: {msg}"),
        }
    }
}

impl std::error::Error for SettingsServiceError {}

pub trait SettingsRepository: Send + Sync {
    fn load(&self) -> Result<Settings, String>;
    fn save(&self, settings: &Settings) -> Result<(), String>;
}

pub struct SettingsService {
    repository: Box<dyn SettingsRepository>,
    settings: Settings,
}

impl SettingsService {
    pub fn new(repository: Box<dyn SettingsRepository>) -> Self {
        let mut settings = repository.load().unwrap_or_default();
        clean_invalid_binary_paths(&mut settings);

        Self {
            repository,
            settings,
        }
    }

    fn save(&mut self) -> Result<(), SettingsServiceError> {
        self.repository
            .save(&self.settings)
            .map_err(SettingsServiceError::RepositoryError)
    }

    pub fn get_agent_env_vars(&self, agent_type: &str) -> HashMap<String, String> {
        match agent_type {
            "claude" => self.settings.agent_env_vars.claude.clone(),
            "opencode" => self.settings.agent_env_vars.opencode.clone(),
            "gemini" => self.settings.agent_env_vars.gemini.clone(),
            "codex" => self.settings.agent_env_vars.codex.clone(),
            _ => HashMap::new(),
        }
    }

    pub fn set_agent_env_vars(
        &mut self,
        agent_type: &str,
        env_vars: HashMap<String, String>,
    ) -> Result<(), SettingsServiceError> {
        match agent_type {
            "claude" => self.settings.agent_env_vars.claude = env_vars,
            "opencode" => self.settings.agent_env_vars.opencode = env_vars,
            "gemini" => self.settings.agent_env_vars.gemini = env_vars,
            "codex" => self.settings.agent_env_vars.codex = env_vars,
            _ => {
                return Err(SettingsServiceError::UnknownAgentType(
                    agent_type.to_string(),
                ))
            }
        }

        self.save()
    }

    pub fn get_terminal_ui_preferences(&self) -> TerminalUIPreferences {
        self.settings.terminal_ui.clone()
    }

    pub fn set_terminal_collapsed(
        &mut self,
        is_collapsed: bool,
    ) -> Result<(), SettingsServiceError> {
        self.settings.terminal_ui.is_collapsed = is_collapsed;
        self.save()
    }

    pub fn set_terminal_divider_position(
        &mut self,
        position: f64,
    ) -> Result<(), SettingsServiceError> {
        self.settings.terminal_ui.divider_position = Some(position);
        self.save()
    }

    pub fn get_agent_cli_args(&self, agent_type: &str) -> String {
        match agent_type {
            "claude" => self.settings.agent_cli_args.claude.clone(),
            "opencode" => self.settings.agent_cli_args.opencode.clone(),
            "gemini" => self.settings.agent_cli_args.gemini.clone(),
            "codex" => self.settings.agent_cli_args.codex.clone(),
            _ => String::new(),
        }
    }

    pub fn set_agent_cli_args(
        &mut self,
        agent_type: &str,
        cli_args: String,
    ) -> Result<(), SettingsServiceError> {
        log::debug!(
            "Setting CLI args in settings: agent_type='{agent_type}', cli_args='{cli_args}'"
        );

        match agent_type {
            "claude" => self.settings.agent_cli_args.claude = cli_args.clone(),
            "opencode" => self.settings.agent_cli_args.opencode = cli_args.clone(),
            "gemini" => self.settings.agent_cli_args.gemini = cli_args.clone(),
            "codex" => self.settings.agent_cli_args.codex = cli_args.clone(),
            _ => {
                let error = format!("Unknown agent type: {agent_type}");
                log::error!("Invalid agent type in set_agent_cli_args: {error}");
                return Err(SettingsServiceError::UnknownAgentType(
                    agent_type.to_string(),
                ));
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

    pub fn get_agent_initial_command(&self, agent_type: &str) -> String {
        match agent_type {
            "claude" => self.settings.agent_initial_commands.claude.clone(),
            "opencode" => self.settings.agent_initial_commands.opencode.clone(),
            "gemini" => self.settings.agent_initial_commands.gemini.clone(),
            "codex" => self.settings.agent_initial_commands.codex.clone(),
            _ => String::new(),
        }
    }

    pub fn set_agent_initial_command(
        &mut self,
        agent_type: &str,
        initial_command: String,
    ) -> Result<(), SettingsServiceError> {
        log::debug!(
            "Setting initial command in settings: agent_type='{agent_type}', length={} bytes",
            initial_command.len()
        );

        match agent_type {
            "claude" => self.settings.agent_initial_commands.claude = initial_command.clone(),
            "opencode" => self.settings.agent_initial_commands.opencode = initial_command.clone(),
            "gemini" => self.settings.agent_initial_commands.gemini = initial_command.clone(),
            "codex" => self.settings.agent_initial_commands.codex = initial_command.clone(),
            _ => {
                let error = format!("Unknown agent type: {agent_type}");
                log::error!("Invalid agent type in set_agent_initial_command: {error}");
                return Err(SettingsServiceError::UnknownAgentType(
                    agent_type.to_string(),
                ));
            }
        }

        log::debug!("Initial command set in memory, now saving to disk");

        match self.save() {
            Ok(()) => {
                log::debug!("Successfully saved initial command for agent '{agent_type}' to disk");
                Ok(())
            }
            Err(e) => {
                log::error!("Failed to save initial command to disk for agent '{agent_type}': {e}");
                Err(e)
            }
        }
    }

    pub fn get_terminal_settings(&self) -> TerminalSettings {
        self.settings.terminal.clone()
    }

    pub fn set_terminal_settings(
        &mut self,
        terminal: TerminalSettings,
    ) -> Result<(), SettingsServiceError> {
        self.settings.terminal = terminal;
        self.save()
    }

    pub fn get_diff_view_preferences(&self) -> DiffViewPreferences {
        self.settings.diff_view.clone()
    }

    pub fn set_diff_view_preferences(
        &mut self,
        preferences: DiffViewPreferences,
    ) -> Result<(), SettingsServiceError> {
        self.settings.diff_view = preferences;
        self.save()
    }

    pub fn get_session_preferences(&self) -> SessionPreferences {
        self.settings.session.clone()
    }

    pub fn set_session_preferences(
        &mut self,
        preferences: SessionPreferences,
    ) -> Result<(), SettingsServiceError> {
        self.settings.session = preferences;
        self.save()
    }

    pub fn get_keyboard_shortcuts(&self) -> HashMap<String, Vec<String>> {
        self.settings.keyboard_shortcuts.clone()
    }

    pub fn set_keyboard_shortcuts(
        &mut self,
        shortcuts: HashMap<String, Vec<String>>,
    ) -> Result<(), SettingsServiceError> {
        self.settings.keyboard_shortcuts = shortcuts;
        self.save()
    }

    pub fn get_auto_commit_on_review(&self) -> bool {
        self.settings.session.auto_commit_on_review
    }

    pub fn set_auto_commit_on_review(
        &mut self,
        auto_commit: bool,
    ) -> Result<(), SettingsServiceError> {
        self.settings.session.auto_commit_on_review = auto_commit;
        self.save()
    }

    pub fn get_agent_binary_config(&self, agent_name: &str) -> Option<AgentBinaryConfig> {
        match agent_name {
            "claude" => self.settings.agent_binaries.claude.clone(),
            "opencode" => self.settings.agent_binaries.opencode.clone(),
            "gemini" => self.settings.agent_binaries.gemini.clone(),
            "codex" => self.settings.agent_binaries.codex.clone(),
            _ => None,
        }
    }

    pub fn set_agent_binary_config(
        &mut self,
        config: AgentBinaryConfig,
    ) -> Result<(), SettingsServiceError> {
        match config.agent_name.as_str() {
            "claude" => self.settings.agent_binaries.claude = Some(config),
            "opencode" => self.settings.agent_binaries.opencode = Some(config),
            "gemini" => self.settings.agent_binaries.gemini = Some(config),
            "codex" => self.settings.agent_binaries.codex = Some(config),
            _ => return Err(SettingsServiceError::UnknownAgentType(config.agent_name)),
        }
        self.save()
    }

    pub fn get_all_agent_binary_configs(&self) -> Vec<AgentBinaryConfig> {
        let mut configs = Vec::new();
        if let Some(config) = &self.settings.agent_binaries.claude {
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

    pub fn get_effective_binary_path(
        &self,
        agent_name: &str,
    ) -> Result<String, SettingsServiceError> {
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
