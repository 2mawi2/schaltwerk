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
            "droid" => self.settings.agent_env_vars.droid.clone(),
            "qwen" => self.settings.agent_env_vars.qwen.clone(),
            "amp" => self.settings.agent_env_vars.amp.clone(),
            "terminal" => self.settings.agent_env_vars.terminal.clone(),
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
            "droid" => self.settings.agent_env_vars.droid = env_vars,
            "qwen" => self.settings.agent_env_vars.qwen = env_vars,
            "amp" => self.settings.agent_env_vars.amp = env_vars,
            "terminal" => self.settings.agent_env_vars.terminal = env_vars,
            _ => {
                return Err(SettingsServiceError::UnknownAgentType(
                    agent_type.to_string(),
                ));
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

    pub fn get_font_sizes(&self) -> (i32, i32) {
        let sizes = self.settings.font_sizes;
        (sizes.terminal, sizes.ui)
    }

    pub fn set_font_sizes(&mut self, terminal: i32, ui: i32) -> Result<(), SettingsServiceError> {
        self.settings.font_sizes.terminal = terminal;
        self.settings.font_sizes.ui = ui;
        self.save()
    }

    pub fn get_agent_cli_args(&self, agent_type: &str) -> String {
        if agent_type == "terminal" {
            return String::new();
        }

        match agent_type {
            "claude" => self.settings.agent_cli_args.claude.clone(),
            "opencode" => self.settings.agent_cli_args.opencode.clone(),
            "gemini" => self.settings.agent_cli_args.gemini.clone(),
            "codex" => self.settings.agent_cli_args.codex.clone(),
            "droid" => self.settings.agent_cli_args.droid.clone(),
            "qwen" => self.settings.agent_cli_args.qwen.clone(),
            "amp" => self.settings.agent_cli_args.amp.clone(),
            _ => String::new(),
        }
    }

    pub fn set_agent_cli_args(
        &mut self,
        agent_type: &str,
        cli_args: String,
    ) -> Result<(), SettingsServiceError> {
        if agent_type == "terminal" {
            log::debug!("Ignoring CLI args update for terminal-only mode");
            return Ok(());
        }

        log::debug!(
            "Setting CLI args in settings: agent_type='{agent_type}', cli_args='{cli_args}'"
        );

        match agent_type {
            "claude" => self.settings.agent_cli_args.claude = cli_args.clone(),
            "opencode" => self.settings.agent_cli_args.opencode = cli_args.clone(),
            "gemini" => self.settings.agent_cli_args.gemini = cli_args.clone(),
            "codex" => self.settings.agent_cli_args.codex = cli_args.clone(),
            "droid" => self.settings.agent_cli_args.droid = cli_args.clone(),
            "qwen" => self.settings.agent_cli_args.qwen = cli_args.clone(),
            "amp" => self.settings.agent_cli_args.amp = cli_args.clone(),
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
            "droid" => self.settings.agent_initial_commands.droid.clone(),
            "qwen" => self.settings.agent_initial_commands.qwen.clone(),
            "amp" => self.settings.agent_initial_commands.amp.clone(),
            "terminal" => String::new(),
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
            "droid" => self.settings.agent_initial_commands.droid = initial_command.clone(),
            "qwen" => self.settings.agent_initial_commands.qwen = initial_command.clone(),
            "amp" => self.settings.agent_initial_commands.amp = initial_command.clone(),
            "terminal" => {}
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

    pub fn get_tutorial_completed(&self) -> bool {
        self.settings.tutorial_completed
    }

    pub fn set_tutorial_completed(&mut self, completed: bool) -> Result<(), SettingsServiceError> {
        self.settings.tutorial_completed = completed;
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

    pub fn get_auto_update_enabled(&self) -> bool {
        self.settings.updater.auto_update_enabled
    }

    pub fn set_auto_update_enabled(&mut self, enabled: bool) -> Result<(), SettingsServiceError> {
        self.settings.updater.auto_update_enabled = enabled;
        self.save()
    }

    pub fn get_dev_error_toasts_enabled(&self) -> bool {
        self.settings.dev_error_toasts_enabled
    }

    pub fn set_dev_error_toasts_enabled(
        &mut self,
        enabled: bool,
    ) -> Result<(), SettingsServiceError> {
        self.settings.dev_error_toasts_enabled = enabled;
        self.save()
    }

    pub fn get_last_project_parent_directory(&self) -> Option<String> {
        self.settings.last_project_parent_directory.clone()
    }

    pub fn set_last_project_parent_directory(
        &mut self,
        directory: Option<String>,
    ) -> Result<(), SettingsServiceError> {
        self.settings.last_project_parent_directory = directory
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        self.save()
    }

    pub fn get_agent_binary_config(&self, agent_name: &str) -> Option<AgentBinaryConfig> {
        match agent_name {
            "claude" => self.settings.agent_binaries.claude.clone(),
            "opencode" => self.settings.agent_binaries.opencode.clone(),
            "gemini" => self.settings.agent_binaries.gemini.clone(),
            "codex" => self.settings.agent_binaries.codex.clone(),
            "droid" => self.settings.agent_binaries.droid.clone(),
            "qwen" => self.settings.agent_binaries.qwen.clone(),
            "amp" => self.settings.agent_binaries.amp.clone(),
            "terminal" => None,
            _ => None,
        }
    }

    pub fn set_agent_binary_config(
        &mut self,
        config: AgentBinaryConfig,
    ) -> Result<(), SettingsServiceError> {
        if config.agent_name == "terminal" {
            log::debug!("Ignoring binary configuration update for terminal-only mode");
            return Ok(());
        }

        match config.agent_name.as_str() {
            "claude" => self.settings.agent_binaries.claude = Some(config),
            "opencode" => self.settings.agent_binaries.opencode = Some(config),
            "gemini" => self.settings.agent_binaries.gemini = Some(config),
            "codex" => self.settings.agent_binaries.codex = Some(config),
            "droid" => self.settings.agent_binaries.droid = Some(config),
            "qwen" => self.settings.agent_binaries.qwen = Some(config),
            "amp" => self.settings.agent_binaries.amp = Some(config),
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
        if let Some(config) = &self.settings.agent_binaries.droid {
            configs.push(config.clone());
        }
        if let Some(config) = &self.settings.agent_binaries.qwen {
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

    pub fn get_amp_mcp_servers(&self) -> HashMap<String, McpServerConfig> {
        self.settings.amp_mcp_servers.clone()
    }

    pub fn set_amp_mcp_servers(
        &mut self,
        mcp_servers: HashMap<String, McpServerConfig>,
    ) -> Result<(), SettingsServiceError> {
        self.settings.amp_mcp_servers = mcp_servers;
        self.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::settings::types::Settings;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct InMemoryRepository {
        state: Arc<Mutex<Settings>>,
    }

    impl InMemoryRepository {
        fn snapshot(&self) -> Settings {
            self.state.lock().unwrap().clone()
        }
    }

    impl SettingsRepository for InMemoryRepository {
        fn load(&self) -> Result<Settings, String> {
            Ok(self.snapshot())
        }

        fn save(&self, settings: &Settings) -> Result<(), String> {
            *self.state.lock().unwrap() = settings.clone();
            Ok(())
        }
    }

    #[test]
    fn auto_update_defaults_to_enabled() {
        let repo = InMemoryRepository::default();
        let service = SettingsService::new(Box::new(repo));

        assert!(service.get_auto_update_enabled());
    }

    #[test]
    fn set_auto_update_enabled_persists_value() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        assert!(service.set_auto_update_enabled(false).is_ok());
        assert!(!service.get_auto_update_enabled());
        assert!(!repo_handle.snapshot().updater.auto_update_enabled);

        assert!(service.set_auto_update_enabled(true).is_ok());
        assert!(repo_handle.snapshot().updater.auto_update_enabled);
    }

    #[test]
    fn set_agent_cli_args_supports_droid() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        service
            .set_agent_cli_args("droid", "--log-level debug".to_string())
            .expect("should accept droid CLI args");

        assert_eq!(
            repo_handle.snapshot().agent_cli_args.droid,
            "--log-level debug"
        );
    }

    #[test]
    fn set_agent_cli_args_supports_qwen() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        service
            .set_agent_cli_args("qwen", "--project alpha".to_string())
            .expect("should accept qwen CLI args");

        assert_eq!(
            repo_handle.snapshot().agent_cli_args.qwen,
            "--project alpha"
        );
    }

    #[test]
    fn set_agent_cli_args_supports_amp() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        service
            .set_agent_cli_args("amp", "--mode free".to_string())
            .expect("should accept amp CLI args");

        assert_eq!(repo_handle.snapshot().agent_cli_args.amp, "--mode free");
    }

    #[test]
    fn set_agent_initial_command_supports_droid() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        service
            .set_agent_initial_command("droid", "build project".to_string())
            .expect("should accept droid initial command");

        assert_eq!(
            repo_handle.snapshot().agent_initial_commands.droid,
            "build project"
        );
    }

    #[test]
    fn font_sizes_default_values() {
        let repo = InMemoryRepository::default();
        let service = SettingsService::new(Box::new(repo));

        assert_eq!(service.get_font_sizes(), (13, 12));
    }

    #[test]
    fn set_font_sizes_persists_values() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        service
            .set_font_sizes(16, 15)
            .expect("should persist font sizes");

        assert_eq!(service.get_font_sizes(), (16, 15));
        assert_eq!(repo_handle.snapshot().font_sizes.terminal, 16);
        assert_eq!(repo_handle.snapshot().font_sizes.ui, 15);
    }

    #[test]
    fn set_agent_initial_command_supports_qwen() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        service
            .set_agent_initial_command("qwen", "plan feature".to_string())
            .expect("should accept qwen initial command");

        assert_eq!(
            repo_handle.snapshot().agent_initial_commands.qwen,
            "plan feature"
        );
    }

    #[test]
    fn set_agent_env_vars_supports_droid() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        let mut vars = HashMap::new();
        vars.insert("DROID_KEY".to_string(), "secret".to_string());

        service
            .set_agent_env_vars("droid", vars.clone())
            .expect("should accept droid env vars");

        assert_eq!(repo_handle.snapshot().agent_env_vars.droid, vars);
    }

    #[test]
    fn set_agent_env_vars_supports_qwen() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        let mut vars = HashMap::new();
        vars.insert("QWEN_TOKEN".to_string(), "secret".to_string());

        service
            .set_agent_env_vars("qwen", vars.clone())
            .expect("should accept qwen env vars");

        assert_eq!(repo_handle.snapshot().agent_env_vars.qwen, vars);
    }

    #[test]
    fn set_agent_env_vars_supports_terminal() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        let mut vars = HashMap::new();
        vars.insert("CUSTOM_VAR".to_string(), "test_value".to_string());
        vars.insert("PATH".to_string(), "/custom/path".to_string());

        service
            .set_agent_env_vars("terminal", vars.clone())
            .expect("should accept terminal env vars");

        assert_eq!(repo_handle.snapshot().agent_env_vars.terminal, vars);
        assert_eq!(service.get_agent_env_vars("terminal"), vars);
    }

    #[test]
    fn set_agent_binary_config_supports_droid() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        let config = AgentBinaryConfig {
            agent_name: "droid".to_string(),
            custom_path: Some("/custom/droid".to_string()),
            auto_detect: false,
            detected_binaries: vec![],
        };

        service
            .set_agent_binary_config(config.clone())
            .expect("should accept droid binary config");

        assert_eq!(repo_handle.snapshot().agent_binaries.droid, Some(config));
    }

    #[test]
    fn set_agent_binary_config_supports_qwen() {
        let repo = InMemoryRepository::default();
        let repo_handle = repo.clone();
        let mut service = SettingsService::new(Box::new(repo));

        let config = AgentBinaryConfig {
            agent_name: "qwen".to_string(),
            custom_path: Some("/custom/qwen".to_string()),
            auto_detect: false,
            detected_binaries: vec![],
        };

        service
            .set_agent_binary_config(config.clone())
            .expect("should accept qwen binary config");

        assert_eq!(repo_handle.snapshot().agent_binaries.qwen, Some(config));
    }
}
