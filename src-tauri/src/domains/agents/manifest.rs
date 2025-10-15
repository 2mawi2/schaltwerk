use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentDefinition {
    pub id: String,
    pub display_name: String,
    pub binary_name: String,
    pub default_binary_path: String,
    pub auto_send_initial_command: bool,
    pub supports_resume: bool,
    #[serde(default)]
    pub ready_marker: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ManifestRoot {
    agents: HashMap<String, AgentDefinition>,
}

static AGENT_MANIFEST: LazyLock<HashMap<String, AgentDefinition>> = LazyLock::new(|| {
    let manifest_content = include_str!("../../../agents_manifest.toml");
    let root: ManifestRoot = toml::from_str(manifest_content)
        .expect("Failed to parse agents_manifest.toml - this is a fatal build error");
    root.agents
});

pub struct AgentManifest;

impl AgentManifest {
    pub fn get(agent_id: &str) -> Option<&'static AgentDefinition> {
        AGENT_MANIFEST.get(agent_id)
    }

    pub fn all() -> &'static HashMap<String, AgentDefinition> {
        &AGENT_MANIFEST
    }

    pub fn supported_agents() -> Vec<String> {
        let mut agents: Vec<_> = AGENT_MANIFEST.keys().cloned().collect();
        agents.sort();
        agents
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manifest_loads() {
        assert!(!AGENT_MANIFEST.is_empty(), "Manifest should not be empty");
    }

    #[test]
    fn test_manifest_has_expected_agents() {
        assert!(AgentManifest::get("claude").is_some());
        assert!(AgentManifest::get("codex").is_some());
        assert!(AgentManifest::get("gemini").is_some());
        assert!(AgentManifest::get("opencode").is_some());
        assert!(AgentManifest::get("droid").is_some());
        assert!(AgentManifest::get("terminal").is_some());
    }

    #[test]
    fn test_claude_definition() {
        let claude = AgentManifest::get("claude").unwrap();
        assert_eq!(claude.id, "claude");
        assert_eq!(claude.display_name, "Claude");
        assert_eq!(claude.binary_name, "claude");
        assert_eq!(claude.default_binary_path, "claude");
        assert!(!claude.auto_send_initial_command);
        assert!(claude.supports_resume);
    }

    #[test]
    fn test_supported_agents_sorted() {
        let agents = AgentManifest::supported_agents();
        assert!(agents.len() >= 6);

        let expected = vec!["claude", "codex", "droid", "gemini", "opencode", "terminal"];
        for agent in expected {
            assert!(agents.contains(&agent.to_string()));
        }
    }

    #[test]
    fn test_droid_definition() {
        let droid = AgentManifest::get("droid").expect("Droid manifest entry missing");
        assert_eq!(droid.id, "droid");
        assert_eq!(droid.display_name, "Droid");
        assert_eq!(droid.binary_name, "droid");
        assert_eq!(
            droid.default_binary_path,
            "/Users/marius.wichtner/.local/bin/droid"
        );
        assert!(droid.auto_send_initial_command);
        assert!(!droid.supports_resume);
        assert_eq!(
            droid.ready_marker.as_deref(),
            Some("You are standing in an open terminal. An AI awaits your commands.")
        );
    }

    #[test]
    fn test_terminal_definition() {
        let terminal = AgentManifest::get("terminal").expect("Terminal manifest entry missing");
        assert_eq!(terminal.id, "terminal");
        assert_eq!(terminal.display_name, "Terminal Only");
        assert_eq!(terminal.binary_name, "sh");
        assert_eq!(terminal.default_binary_path, "/bin/sh");
        assert!(!terminal.auto_send_initial_command);
        assert!(!terminal.supports_resume);
    }

    #[test]
    fn test_nonexistent_agent() {
        assert!(AgentManifest::get("nonexistent").is_none());
    }
}
