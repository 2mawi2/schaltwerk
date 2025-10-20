use super::manifest::AgentManifest;
use std::path::Path;

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
    let tokens = shell_words::split(agent_part)
        .map_err(|e| format!("Failed to parse agent command '{agent_part}': {e}"))?;

    if tokens.is_empty() {
        return Err(format!(
            "Second part doesn't start with 'claude', 'opencode', 'gemini', or 'codex': {command}"
        ));
    }

    let mut iter = tokens.into_iter();
    let mut agent_token = iter.next().unwrap();

    let first_segment = extract_first_segment(agent_part);
    if first_segment.contains('\\') && !agent_token.contains('\\') {
        agent_token = first_segment;
    }
    let supported_agents = AgentManifest::supported_agents();
    let normalized_token = agent_token.replace('\\', "/");
    let fname = Path::new(&normalized_token)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let stem = Path::new(fname)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(fname);

    let is_supported = supported_agents
        .iter()
        .any(|agent| stem == *agent || agent_token == *agent);

    if !is_supported {
        let agent_list = supported_agents.join(", ");
        return Err(format!(
            "Unsupported agent '{agent_token}'. Supported agents: {agent_list}"
        ));
    }

    let args: Vec<String> = iter.collect();

    Ok((cwd, agent_token, args))
}

fn extract_first_segment(agent_part: &str) -> String {
    let trimmed = agent_part.trim_start();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut chars = trimmed.char_indices().peekable();
    if matches!(chars.peek(), Some((_, '"' | '\''))) {
        let quote = chars.next().map(|(_, ch)| ch).unwrap();
        let mut segment = String::new();
        let mut escape = false;
        for (_, ch) in chars.by_ref() {
            if escape {
                segment.push(ch);
                escape = false;
                continue;
            }
            match ch {
                '\\' => escape = true,
                c if c == quote => break,
                _ => segment.push(ch),
            }
        }
        return segment;
    }

    let end = trimmed.find(char::is_whitespace).unwrap_or(trimmed.len());
    trimmed[..end].to_string()
}
