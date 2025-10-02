use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentDefinition {
    pub id: String,
    pub display_name: String,
    pub binary_name: String,
    pub default_binary_path: String,
    pub auto_send_initial_command: bool,
    pub supports_resume: bool,
}

#[derive(Debug, Deserialize)]
struct ManifestRoot {
    agents: HashMap<String, AgentDefinition>,
}

static AGENT_MANIFEST: Lazy<HashMap<String, AgentDefinition>> = Lazy::new(|| {
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
        assert!(agents.len() >= 4);

        let expected = vec!["claude", "codex", "gemini", "opencode"];
        for agent in expected {
            assert!(agents.contains(&agent.to_string()));
        }
    }

    #[test]
    fn test_nonexistent_agent() {
        assert!(AgentManifest::get("nonexistent").is_none());
    }
}
