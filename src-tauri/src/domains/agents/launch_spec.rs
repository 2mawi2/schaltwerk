use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct AgentLaunchSpec {
    pub shell_command: String,
    pub initial_command: Option<String>,
    pub env_vars: HashMap<String, String>,
    pub working_dir: PathBuf,
}

impl AgentLaunchSpec {
    pub fn new(shell_command: String, working_dir: PathBuf) -> Self {
        Self {
            shell_command,
            initial_command: None,
            env_vars: HashMap::new(),
            working_dir,
        }
    }

    pub fn with_initial_command(mut self, initial_command: Option<String>) -> Self {
        self.initial_command = initial_command;
        self
    }

    pub fn with_env_vars(mut self, env_vars: HashMap<String, String>) -> Self {
        self.env_vars = env_vars;
        self
    }

    pub fn format_for_shell(&self) -> String {
        self.shell_command.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_basic_launch_spec() {
        let spec = AgentLaunchSpec::new(
            "cd /test && claude".to_string(),
            Path::new("/test").to_path_buf(),
        );

        assert_eq!(spec.shell_command, "cd /test && claude");
        assert!(spec.initial_command.is_none());
        assert!(spec.env_vars.is_empty());
    }

    #[test]
    fn test_launch_spec_with_initial_command() {
        let spec = AgentLaunchSpec::new(
            "cd /test && claude".to_string(),
            Path::new("/test").to_path_buf(),
        )
        .with_initial_command(Some("implement feature".to_string()));

        assert_eq!(spec.initial_command, Some("implement feature".to_string()));
    }

    #[test]
    fn test_launch_spec_with_env_vars() {
        let mut env = HashMap::new();
        env.insert("API_KEY".to_string(), "secret".to_string());

        let spec = AgentLaunchSpec::new(
            "cd /test && claude".to_string(),
            Path::new("/test").to_path_buf(),
        )
        .with_env_vars(env.clone());

        assert_eq!(spec.env_vars, env);
    }

    #[test]
    fn test_format_for_shell() {
        let spec = AgentLaunchSpec::new(
            "cd /test && claude --flag".to_string(),
            Path::new("/test").to_path_buf(),
        );

        assert_eq!(spec.format_for_shell(), "cd /test && claude --flag");
    }
}
