use std::collections::HashMap;
use std::path::Path;

pub trait AgentCommand: Send + Sync {
    fn binary_name(&self) -> &str;
    fn default_binary(&self) -> &str;
    fn find_session(&self, path: &Path) -> Option<String>;
    fn build_command(
        &self,
        worktree_path: &Path,
        session_id: Option<&str>,
        initial_prompt: Option<&str>,
        skip_permissions: bool,
        binary_override: Option<&str>,
    ) -> String;
}

pub struct ClaudeAgent;

impl AgentCommand for ClaudeAgent {
    fn binary_name(&self) -> &str {
        "claude"
    }

    fn default_binary(&self) -> &str {
        "claude"
    }

    fn find_session(&self, path: &Path) -> Option<String> {
        super::claude::find_resumable_claude_session_fast(path)
    }

    fn build_command(
        &self,
        worktree_path: &Path,
        session_id: Option<&str>,
        initial_prompt: Option<&str>,
        skip_permissions: bool,
        binary_override: Option<&str>,
    ) -> String {
        let config = super::claude::ClaudeConfig {
            binary_path: Some(binary_override.unwrap_or(self.default_binary()).to_string()),
        };
        super::claude::build_claude_command_with_config(
            worktree_path,
            session_id,
            initial_prompt,
            skip_permissions,
            Some(&config),
        )
    }
}

pub struct CodexAgent;

impl AgentCommand for CodexAgent {
    fn binary_name(&self) -> &str {
        "codex"
    }

    fn default_binary(&self) -> &str {
        "codex"
    }

    fn find_session(&self, path: &Path) -> Option<String> {
        // Prefer precise resume via explicit session JSONL path if available,
        // falling back to sentinel-based resume/continue.
        if let Some(p) = super::codex::find_codex_resume_path(path) {
            if let Some(id) = super::codex::extract_session_id_from_path(&p) {
                return Some(id);
            }
        }
        super::codex::find_codex_session(path)
    }

    fn build_command(
        &self,
        worktree_path: &Path,
        session_id: Option<&str>,
        initial_prompt: Option<&str>,
        skip_permissions: bool,
        binary_override: Option<&str>,
    ) -> String {
        let sandbox_mode = if skip_permissions {
            "danger-full-access"
        } else {
            "workspace-write"
        };

        let config = super::codex::CodexConfig {
            binary_path: Some(binary_override.unwrap_or(self.default_binary()).to_string()),
        };
        super::codex::build_codex_command_with_config(
            worktree_path,
            session_id,
            initial_prompt,
            sandbox_mode,
            Some(&config),
        )
    }
}


pub struct GeminiAgent;

impl AgentCommand for GeminiAgent {
    fn binary_name(&self) -> &str {
        "gemini"
    }

    fn default_binary(&self) -> &str {
        "gemini"
    }

    fn find_session(&self, path: &Path) -> Option<String> {
        super::gemini::find_gemini_session(path)
    }

    fn build_command(
        &self,
        worktree_path: &Path,
        _session_id: Option<&str>,
        initial_prompt: Option<&str>,
        skip_permissions: bool,
        binary_override: Option<&str>,
    ) -> String {
        let config = super::gemini::GeminiConfig {
            binary_path: Some(binary_override.unwrap_or(self.default_binary()).to_string()),
        };
        super::gemini::build_gemini_command_with_config(
            worktree_path,
            None,
            initial_prompt,
            skip_permissions,
            Some(&config),
        )
    }
}

pub struct OpenCodeAgent;

impl AgentCommand for OpenCodeAgent {
    fn binary_name(&self) -> &str {
        "opencode"
    }

    fn default_binary(&self) -> &str {
        "opencode"
    }

    fn find_session(&self, path: &Path) -> Option<String> {
        super::opencode::find_opencode_session(path).map(|info| info.id)
    }

    fn build_command(
        &self,
        worktree_path: &Path,
        session_id: Option<&str>,
        initial_prompt: Option<&str>,
        skip_permissions: bool,
        binary_override: Option<&str>,
    ) -> String {
        let session_info = session_id.map(|id| super::opencode::OpenCodeSessionInfo {
            id: id.to_string(),
            has_history: true,
        });

        let config = super::opencode::OpenCodeConfig {
            binary_path: Some(binary_override.unwrap_or(self.default_binary()).to_string()),
        };
        super::opencode::build_opencode_command_with_config(
            worktree_path,
            session_info.as_ref(),
            initial_prompt,
            skip_permissions,
            Some(&config),
        )
    }
}

pub struct AgentRegistry {
    agents: HashMap<&'static str, Box<dyn AgentCommand>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        let mut agents: HashMap<&'static str, Box<dyn AgentCommand>> = HashMap::new();

        agents.insert("claude", Box::new(ClaudeAgent));
        agents.insert("codex", Box::new(CodexAgent));
        agents.insert("gemini", Box::new(GeminiAgent));
        agents.insert("opencode", Box::new(OpenCodeAgent));

        Self { agents }
    }

    pub fn get(&self, agent_type: &str) -> Option<&dyn AgentCommand> {
        self.agents.get(agent_type).map(|b| b.as_ref())
    }

    pub fn supported_agents(&self) -> Vec<&str> {
        let mut agents: Vec<_> = self.agents.keys().copied().collect();
        agents.sort();
        agents
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_registry_has_all_agents() {
        let registry = AgentRegistry::new();
        assert!(registry.get("claude").is_some());
        assert!(registry.get("codex").is_some());
        assert!(registry.get("gemini").is_some());
        assert!(registry.get("opencode").is_some());
    }

    #[test]
    fn test_registry_supported_agents() {
        let registry = AgentRegistry::new();
        let supported = registry.supported_agents();
        assert_eq!(supported.len(), 4);
        assert!(supported.contains(&"claude"));
        assert!(supported.contains(&"codex"));
        assert!(supported.contains(&"gemini"));
        assert!(supported.contains(&"opencode"));
    }

    #[test]
    fn test_registry_unsupported_agent() {
        let registry = AgentRegistry::new();
        assert!(registry.get("nonexistent").is_none());
    }

    // Test each agent implementation matches original behavior
    mod claude_tests {
        use super::*;

        #[test]
        fn test_claude_command_matches_original() {
            let agent = ClaudeAgent;
            let path = Path::new("/test/path");

            // Test basic command
            let unified_cmd =
                agent.build_command(path, None, Some("test prompt"), true, Some("claude"));
            let original_cmd = crate::domains::agents::claude::build_claude_command_with_config(
                path,
                None,
                Some("test prompt"),
                true,
                Some(&crate::domains::agents::claude::ClaudeConfig {
                    binary_path: Some("claude".to_string()),
                }),
            );
            assert_eq!(unified_cmd, original_cmd);
        }

        #[test]
        fn test_claude_with_session_id() {
            let agent = ClaudeAgent;
            let path = Path::new("/test/path");

            let unified_cmd = agent.build_command(path, Some("session123"), None, false, None);
            let original_cmd = crate::domains::agents::claude::build_claude_command_with_config(
                path,
                Some("session123"),
                None,
                false,
                Some(&crate::domains::agents::claude::ClaudeConfig { binary_path: None }),
            );
            assert_eq!(unified_cmd, original_cmd);
        }

        #[test]
        fn test_claude_binary_name() {
            let agent = ClaudeAgent;
            assert_eq!(agent.binary_name(), "claude");
            assert_eq!(agent.default_binary(), "claude");
        }
    }

    mod codex_tests {
        use super::*;

        #[test]
        fn test_codex_sandbox_modes() {
            let agent = CodexAgent;
            let path = Path::new("/test/path");

            // Test danger mode
            let unified_cmd = agent.build_command(path, None, Some("test"), true, Some("codex"));
            let original_cmd = crate::domains::agents::codex::build_codex_command_with_config(
                path,
                None,
                Some("test"),
                "danger-full-access",
                Some(&crate::domains::agents::codex::CodexConfig {
                    binary_path: Some("codex".to_string()),
                }),
            );
            assert_eq!(unified_cmd, original_cmd);

            // Test safe mode
            let unified_cmd = agent.build_command(path, None, Some("test"), false, None);
            let original_cmd = crate::domains::agents::codex::build_codex_command_with_config(
                path,
                None,
                Some("test"),
                "workspace-write",
                Some(&crate::domains::agents::codex::CodexConfig { binary_path: None }),
            );
            assert_eq!(unified_cmd, original_cmd);
        }

        #[test]
        fn test_codex_session_handling() {
            let agent = CodexAgent;
            let path = Path::new("/test/path");

            // Codex ignores session_id when provided
            let unified_cmd = agent.build_command(path, Some("ignored"), None, false, None);
            let original_cmd = crate::domains::agents::codex::build_codex_command_with_config(
                path,
                Some("ignored"),
                None,
                "workspace-write",
                Some(&crate::domains::agents::codex::CodexConfig { binary_path: None }),
            );
            assert_eq!(unified_cmd, original_cmd);
        }

        #[test]
        fn test_codex_binary_name() {
            let agent = CodexAgent;
            assert_eq!(agent.binary_name(), "codex");
            assert_eq!(agent.default_binary(), "codex");
        }
    }

    mod gemini_tests {
        use super::*;

        #[test]
        fn test_gemini_command_matches_original() {
            let agent = GeminiAgent;
            let path = Path::new("/test/path");

            let unified_cmd =
                agent.build_command(path, None, Some("test prompt"), true, Some("gemini"));
            let original_cmd = crate::domains::agents::gemini::build_gemini_command_with_config(
                path,
                None,
                Some("test prompt"),
                true,
                Some(&crate::domains::agents::gemini::GeminiConfig {
                    binary_path: Some("gemini".to_string()),
                }),
            );
            assert_eq!(unified_cmd, original_cmd);
        }

        #[test]
        fn test_gemini_ignores_session_id() {
            let agent = GeminiAgent;
            let path = Path::new("/test/path");

            // Gemini ignores session_id
            let unified_cmd = agent.build_command(path, Some("ignored"), None, false, None);
            let original_cmd = crate::domains::agents::gemini::build_gemini_command_with_config(
                path,
                None, // Original always passes None
                None,
                false,
                Some(&crate::domains::agents::gemini::GeminiConfig { binary_path: None }),
            );
            assert_eq!(unified_cmd, original_cmd);
        }

        #[test]
        fn test_gemini_binary_name() {
            let agent = GeminiAgent;
            assert_eq!(agent.binary_name(), "gemini");
            assert_eq!(agent.default_binary(), "gemini");
        }
    }

    mod opencode_tests {
        use super::*;

        #[test]
        fn test_opencode_command_matches_original() {
            let agent = OpenCodeAgent;
            let path = Path::new("/test/path");

            let unified_cmd =
                agent.build_command(path, None, Some("test prompt"), true, Some("opencode"));
            let original_cmd = crate::domains::agents::opencode::build_opencode_command_with_config(
                path,
                None,
                Some("test prompt"),
                true,
                Some(&crate::domains::agents::opencode::OpenCodeConfig {
                    binary_path: Some("opencode".to_string()),
                }),
            );
            assert_eq!(unified_cmd, original_cmd);
        }

        #[test]
        fn test_opencode_with_session_info() {
            let agent = OpenCodeAgent;
            let path = Path::new("/test/path");

            let unified_cmd = agent.build_command(path, Some("test-session"), None, false, None);
            let session_info = crate::domains::agents::opencode::OpenCodeSessionInfo {
                id: "test-session".to_string(),
                has_history: true,
            };
            let original_cmd = crate::domains::agents::opencode::build_opencode_command_with_config(
                path,
                Some(&session_info),
                None,
                false,
                Some(&crate::domains::agents::opencode::OpenCodeConfig { binary_path: None }),
            );
            assert_eq!(unified_cmd, original_cmd);
        }

        #[test]
        fn test_opencode_binary_name() {
            let agent = OpenCodeAgent;
            assert_eq!(agent.binary_name(), "opencode");
            assert_eq!(agent.default_binary(), "opencode");
        }
    }

    // Integration tests for command building
    #[test]
    fn test_all_agents_handle_empty_prompt() {
        let registry = AgentRegistry::new();
        let path = Path::new("/test/path");

        for agent_name in registry.supported_agents() {
            let agent = registry.get(agent_name).unwrap();
            let cmd = agent.build_command(path, None, None, false, None);

            // All commands should contain the cd and binary name
            assert!(cmd.starts_with(&format!("cd {} && ", path.display())));
            assert!(cmd.contains(agent.binary_name()) || cmd.contains(agent.default_binary()));
        }
    }

    #[test]
    fn test_all_agents_handle_binary_override() {
        let registry = AgentRegistry::new();
        let path = Path::new("/test/path");
        let custom_binary = "/custom/path/to/binary";

        for agent_name in registry.supported_agents() {
            let agent = registry.get(agent_name).unwrap();
            let cmd = agent.build_command(path, None, None, false, Some(custom_binary));

            // Command should use the custom binary path
            assert!(cmd.contains(custom_binary));
        }
    }

    #[test]
    fn test_all_agents_handle_quotes_in_prompt() {
        let registry = AgentRegistry::new();
        let path = Path::new("/test/path");
        let prompt_with_quotes = r#"implement "feature" with quotes"#;

        for agent_name in registry.supported_agents() {
            let agent = registry.get(agent_name).unwrap();
            let cmd = agent.build_command(path, None, Some(prompt_with_quotes), false, None);

            // Quotes should be escaped
            assert!(cmd.contains(r#"\"feature\""#));
        }
    }
}
