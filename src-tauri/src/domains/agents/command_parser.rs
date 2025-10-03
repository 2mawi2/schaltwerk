use super::manifest::AgentManifest;

pub(crate) fn normalize_cwd(raw: &str) -> String {
    let trimmed = raw.trim();

    if trimmed.len() >= 2 {
        let first = trimmed.as_bytes()[0] as char;
        let last = trimmed.as_bytes()[trimmed.len() - 1] as char;

        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            let inner = &trimmed[1..trimmed.len() - 1];
            return if first == '"' {
                inner.replace("\\\"", "\"")
            } else {
                inner.replace("\\'", "'")
            };
        }
    }

    trimmed.to_string()
}

pub fn parse_agent_command(command: &str) -> Result<(String, String, Vec<String>), String> {
    // Command format: "cd /path/to/worktree && {claude|<path>/opencode|opencode|gemini|codex} [args]"
    // Use splitn to only split on the FIRST " && " to preserve any " && " in agent arguments
    let parts: Vec<&str> = command.splitn(2, " && ").collect();
    if parts.len() != 2 {
        return Err(format!("Invalid command format: {command}"));
    }

    // Extract working directory from cd command
    let cd_part = parts[0];
    if !cd_part.starts_with("cd ") {
        return Err(format!("Command doesn't start with 'cd': {command}"));
    }
    let cwd = normalize_cwd(cd_part[3..].trim());

    // Parse agent command and arguments
    let agent_part = parts[1];
    let mut tokens = shell_words::split(agent_part)
        .map_err(|e| format!("Failed to parse agent command '{agent_part}': {e}"))?;

    if tokens.is_empty() {
        return Err(format!(
            "Second part doesn't start with 'claude', 'opencode', 'gemini', or 'codex': {command}"
        ));
    }

    let mut iter = tokens.into_iter();
    let agent_token = iter.next().unwrap();
    let supported_agents = AgentManifest::supported_agents();
    let is_supported = supported_agents
        .iter()
        .any(|agent| agent_token == *agent || agent_token.ends_with(&format!("/{agent}")));

    if !is_supported {
        let agent_list = supported_agents.join(", ");
        return Err(format!(
            "Unsupported agent '{agent_token}'. Supported agents: {agent_list}"
        ));
    }

    let args: Vec<String> = iter.collect();

    Ok((cwd, agent_token, args))
}
