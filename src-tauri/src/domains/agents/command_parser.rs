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
    // Command format: "cd /path/to/worktree && {agent_name|<path>/agent_name} [args]"
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
    // Extract the agent token (first whitespace-delimited token)
    let mut split = agent_part.splitn(2, ' ');
    let agent_token = split.next().unwrap_or("");
    let rest = split.next().unwrap_or("");

    // Validate agent token against supported agents from manifest
    let supported_agents = super::manifest::AgentManifest::supported_agents();
    let is_supported = supported_agents
        .iter()
        .any(|agent| agent_token == agent || agent_token.ends_with(&format!("/{agent}")));

    if !is_supported {
        let agent_list = supported_agents.join(", ");
        return Err(format!(
            "Unsupported agent '{agent_token}'. Supported agents: {agent_list}"
        ));
    }

    let agent_name = agent_token;

    // Split the rest into arguments, handling quoted strings
    let mut args = Vec::new();
    let mut current_arg = String::new();
    let mut in_quotes = false;
    let mut chars = rest.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                if !in_quotes && !current_arg.is_empty() {
                    args.push(current_arg.clone());
                    current_arg.clear();
                }
            }
            ' ' if !in_quotes => {
                if !current_arg.is_empty() {
                    args.push(current_arg.clone());
                    current_arg.clear();
                }
            }
            '\\' if in_quotes => {
                // Handle escaped characters in quotes
                if let Some(next_ch) = chars.next() {
                    if next_ch == '"' {
                        current_arg.push('"');
                    } else {
                        current_arg.push('\\');
                        current_arg.push(next_ch);
                    }
                }
            }
            _ => {
                current_arg.push(ch);
            }
        }
    }

    // Add any remaining argument
    if !current_arg.is_empty() {
        args.push(current_arg);
    }

    Ok((cwd, agent_name.to_string(), args))
}
