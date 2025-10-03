use super::adapter::{AgentAdapter, AgentLaunchContext, DefaultAdapter};
use super::launch_spec::AgentLaunchSpec;
use super::manifest::AgentManifest;
use std::collections::HashMap;
use std::path::Path;

pub struct ClaudeAdapter;

impl AgentAdapter for ClaudeAdapter {
    fn find_session(&self, path: &Path) -> Option<String> {
        super::claude::find_resumable_claude_session_fast(path)
    }

    fn build_launch_spec(&self, ctx: AgentLaunchContext) -> AgentLaunchSpec {
        let config = super::claude::ClaudeConfig {
            binary_path: Some(
                ctx.binary_override
                    .unwrap_or(&ctx.manifest.default_binary_path)
                    .to_string(),
            ),
        };
        let command = super::claude::build_claude_command_with_config(
            ctx.worktree_path,
            ctx.session_id,
            ctx.initial_prompt,
            ctx.skip_permissions,
            Some(&config),
        );
        AgentLaunchSpec::new(command, ctx.worktree_path.to_path_buf())
    }
}

pub struct CodexAdapter;

impl AgentAdapter for CodexAdapter {
    fn find_session(&self, path: &Path) -> Option<String> {
        if let Some(p) = super::codex::find_codex_resume_path(path) {
            if let Some(id) = super::codex::extract_session_id_from_path(&p) {
                return Some(id);
            }
        }
        super::codex::find_codex_session(path)
    }

    fn build_launch_spec(&self, ctx: AgentLaunchContext) -> AgentLaunchSpec {
        let sandbox_mode = if ctx.skip_permissions {
            "danger-full-access"
        } else {
            "workspace-write"
        };

        let config = super::codex::CodexConfig {
            binary_path: Some(
                ctx.binary_override
                    .unwrap_or(&ctx.manifest.default_binary_path)
                    .to_string(),
            ),
        };
        let command = super::codex::build_codex_command_with_config(
            ctx.worktree_path,
            ctx.session_id,
            ctx.initial_prompt,
            sandbox_mode,
            Some(&config),
        );
        AgentLaunchSpec::new(command, ctx.worktree_path.to_path_buf())
    }
}

pub struct GeminiAdapter;

impl AgentAdapter for GeminiAdapter {
    fn find_session(&self, path: &Path) -> Option<String> {
        super::gemini::find_gemini_session(path)
    }

    fn build_launch_spec(&self, ctx: AgentLaunchContext) -> AgentLaunchSpec {
        let config = super::gemini::GeminiConfig {
            binary_path: Some(
                ctx.binary_override
                    .unwrap_or(&ctx.manifest.default_binary_path)
                    .to_string(),
            ),
        };
        let command = super::gemini::build_gemini_command_with_config(
            ctx.worktree_path,
            None,
            ctx.initial_prompt,
            ctx.skip_permissions,
            Some(&config),
        );
        AgentLaunchSpec::new(command, ctx.worktree_path.to_path_buf())
    }
}

pub struct OpenCodeAdapter;

impl AgentAdapter for OpenCodeAdapter {
    fn find_session(&self, path: &Path) -> Option<String> {
        super::opencode::find_opencode_session(path).map(|info| info.id)
    }

    fn build_launch_spec(&self, ctx: AgentLaunchContext) -> AgentLaunchSpec {
        let session_info = ctx
            .session_id
            .map(|id| super::opencode::OpenCodeSessionInfo {
                id: id.to_string(),
                has_history: true,
            });

        let config = super::opencode::OpenCodeConfig {
            binary_path: Some(
                ctx.binary_override
                    .unwrap_or(&ctx.manifest.default_binary_path)
                    .to_string(),
            ),
        };
        let command = super::opencode::build_opencode_command_with_config(
            ctx.worktree_path,
            session_info.as_ref(),
            ctx.initial_prompt,
            ctx.skip_permissions,
            Some(&config),
        );
        AgentLaunchSpec::new(command, ctx.worktree_path.to_path_buf())
    }
}

pub struct AgentRegistry {
    adapters: HashMap<String, Box<dyn AgentAdapter>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        let mut adapters: HashMap<String, Box<dyn AgentAdapter>> = HashMap::new();

        adapters.insert("claude".to_string(), Box::new(ClaudeAdapter));
        adapters.insert("codex".to_string(), Box::new(CodexAdapter));
        adapters.insert("gemini".to_string(), Box::new(GeminiAdapter));
        adapters.insert("opencode".to_string(), Box::new(OpenCodeAdapter));

        for agent_id in AgentManifest::supported_agents() {
            if !adapters.contains_key(&agent_id) {
                adapters.insert(agent_id.clone(), Box::new(DefaultAdapter::new(agent_id)));
            }
        }

        Self { adapters }
    }

    pub fn get(&self, agent_type: &str) -> Option<&dyn AgentAdapter> {
        self.adapters.get(agent_type).map(|b| b.as_ref())
    }

    pub fn supported_agents(&self) -> Vec<String> {
        let mut agents: Vec<_> = self.adapters.keys().cloned().collect();
        agents.sort();
        agents
    }

    pub fn build_launch_spec(
        &self,
        agent_type: &str,
        worktree_path: &Path,
        session_id: Option<&str>,
        initial_prompt: Option<&str>,
        skip_permissions: bool,
        binary_override: Option<&str>,
    ) -> Option<AgentLaunchSpec> {
        let adapter = self.get(agent_type)?;
        let manifest = AgentManifest::get(agent_type)?;

        let ctx = AgentLaunchContext {
            worktree_path,
            session_id,
            initial_prompt,
            skip_permissions,
            binary_override,
            manifest,
        };

        Some(adapter.build_launch_spec(ctx))
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
        assert!(supported.len() >= 4);
        assert!(supported.contains(&"claude".to_string()));
        assert!(supported.contains(&"codex".to_string()));
        assert!(supported.contains(&"gemini".to_string()));
        assert!(supported.contains(&"opencode".to_string()));
    }

    #[test]
    fn test_build_launch_spec() {
        let registry = AgentRegistry::new();
        let spec = registry.build_launch_spec(
            "claude",
            Path::new("/test/path"),
            None,
            Some("test prompt"),
            false,
            None,
        );

        assert!(spec.is_some());
        let spec = spec.unwrap();
        assert!(spec.shell_command.contains("claude"));
        assert!(spec.shell_command.contains("test prompt"));
    }

    mod claude_tests {
        use super::*;

        #[test]
        fn test_claude_adapter_basic() {
            let adapter = ClaudeAdapter;
            let manifest = AgentManifest::get("claude").unwrap();

            let ctx = AgentLaunchContext {
                worktree_path: Path::new("/test/path"),
                session_id: None,
                initial_prompt: Some("test prompt"),
                skip_permissions: true,
                binary_override: Some("claude"),
                manifest,
            };

            let spec = adapter.build_launch_spec(ctx);
            assert!(spec.shell_command.contains("claude"));
        }
    }

    mod codex_tests {
        use super::*;

        #[test]
        fn test_codex_adapter_sandbox_modes() {
            let adapter = CodexAdapter;
            let manifest = AgentManifest::get("codex").unwrap();

            let ctx = AgentLaunchContext {
                worktree_path: Path::new("/test/path"),
                session_id: None,
                initial_prompt: Some("test"),
                skip_permissions: true,
                binary_override: Some("codex"),
                manifest,
            };

            let spec = adapter.build_launch_spec(ctx);
            assert!(spec.shell_command.contains("danger-full-access"));
        }
    }

    mod gemini_tests {
        use super::*;

        #[test]
        fn test_gemini_adapter_basic() {
            let adapter = GeminiAdapter;
            let manifest = AgentManifest::get("gemini").unwrap();

            let ctx = AgentLaunchContext {
                worktree_path: Path::new("/test/path"),
                session_id: None,
                initial_prompt: Some("test prompt"),
                skip_permissions: true,
                binary_override: Some("gemini"),
                manifest,
            };

            let spec = adapter.build_launch_spec(ctx);
            assert!(spec.shell_command.contains("gemini"));
        }
    }

    mod opencode_tests {
        use super::*;

        #[test]
        fn test_opencode_adapter_basic() {
            let adapter = OpenCodeAdapter;
            let manifest = AgentManifest::get("opencode").unwrap();

            let ctx = AgentLaunchContext {
                worktree_path: Path::new("/test/path"),
                session_id: None,
                initial_prompt: Some("test prompt"),
                skip_permissions: true,
                binary_override: Some("opencode"),
                manifest,
            };

            let spec = adapter.build_launch_spec(ctx);
            assert!(spec.shell_command.contains("opencode"));
        }
    }
}
