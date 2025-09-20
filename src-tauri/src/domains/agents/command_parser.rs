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
    let cwd = cd_part[3..].to_string();

    // Parse agent command and arguments
    let agent_part = parts[1];
    // Extract the agent token (first whitespace-delimited token)
    let mut split = agent_part.splitn(2, ' ');
    let agent_token = split.next().unwrap_or("");
    let rest = split.next().unwrap_or("");

    // Normalize/validate the agent token
    let is_claude = agent_token == "claude" || agent_token.ends_with("/claude");
    let is_opencode = agent_token == "opencode" || agent_token.ends_with("/opencode");
    let is_gemini = agent_token == "gemini" || agent_token.ends_with("/gemini");
    let is_codex = agent_token == "codex" || agent_token.ends_with("/codex");

    let agent_name = if is_claude
        || is_opencode
        || is_gemini
        || is_codex
    {
        agent_token
    } else {
        return Err(format!("Second part doesn't start with 'claude', 'opencode', 'gemini', or 'codex': {command}"));
    };

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
