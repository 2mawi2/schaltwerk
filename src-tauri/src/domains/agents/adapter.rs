use super::launch_spec::AgentLaunchSpec;
use super::manifest::AgentDefinition;
use std::path::Path;

pub struct AgentLaunchContext<'a> {
    pub worktree_path: &'a Path,
    pub session_id: Option<&'a str>,
    pub initial_prompt: Option<&'a str>,
    pub skip_permissions: bool,
    pub binary_override: Option<&'a str>,
    pub manifest: &'a AgentDefinition,
}

pub trait AgentAdapter: Send + Sync {
    fn find_session(&self, path: &Path) -> Option<String> {
        let _ = path;
        None
    }

    fn build_launch_spec(&self, ctx: AgentLaunchContext) -> AgentLaunchSpec;
}

pub struct DefaultAdapter;

impl DefaultAdapter {
    pub fn new(_agent_id: String) -> Self {
        Self
    }
}

impl AgentAdapter for DefaultAdapter {
    fn build_launch_spec(&self, ctx: AgentLaunchContext) -> AgentLaunchSpec {
        let binary = ctx
            .binary_override
            .unwrap_or(ctx.manifest.default_binary_path.as_str());

        let mut command = format!("cd {} && {}", ctx.worktree_path.display(), binary);

        if ctx.skip_permissions {
            command.push_str(" -d");
        }

        if let Some(prompt) = ctx.initial_prompt {
            let escaped = prompt.replace('"', r#"\""#);
            command.push_str(&format!(r#" "{escaped}""#));
        }

        AgentLaunchSpec::new(command, ctx.worktree_path.to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::manifest::AgentManifest;

    #[test]
    fn test_default_adapter_basic() {
        let adapter = DefaultAdapter::new("test".to_string());
        let manifest = AgentManifest::get("claude").unwrap();

        let ctx = AgentLaunchContext {
            worktree_path: Path::new("/test/path"),
            session_id: None,
            initial_prompt: None,
            skip_permissions: false,
            binary_override: None,
            manifest,
        };

        let spec = adapter.build_launch_spec(ctx);
        assert!(spec.shell_command.contains("cd /test/path"));
        assert!(spec.shell_command.contains("claude"));
    }

    #[test]
    fn test_default_adapter_with_prompt() {
        let adapter = DefaultAdapter::new("test".to_string());
        let manifest = AgentManifest::get("claude").unwrap();

        let ctx = AgentLaunchContext {
            worktree_path: Path::new("/test/path"),
            session_id: None,
            initial_prompt: Some("implement feature"),
            skip_permissions: false,
            binary_override: None,
            manifest,
        };

        let spec = adapter.build_launch_spec(ctx);
        assert!(spec.shell_command.contains("implement feature"));
    }

    #[test]
    fn test_default_adapter_skip_permissions() {
        let adapter = DefaultAdapter::new("test".to_string());
        let manifest = AgentManifest::get("claude").unwrap();

        let ctx = AgentLaunchContext {
            worktree_path: Path::new("/test/path"),
            session_id: None,
            initial_prompt: None,
            skip_permissions: true,
            binary_override: None,
            manifest,
        };

        let spec = adapter.build_launch_spec(ctx);
        assert!(spec.shell_command.contains(" -d"));
    }

    #[test]
    fn test_default_adapter_binary_override() {
        let adapter = DefaultAdapter::new("test".to_string());
        let manifest = AgentManifest::get("claude").unwrap();

        let ctx = AgentLaunchContext {
            worktree_path: Path::new("/test/path"),
            session_id: None,
            initial_prompt: None,
            skip_permissions: false,
            binary_override: Some("/custom/binary"),
            manifest,
        };

        let spec = adapter.build_launch_spec(ctx);
        assert!(spec.shell_command.contains("/custom/binary"));
    }
}
