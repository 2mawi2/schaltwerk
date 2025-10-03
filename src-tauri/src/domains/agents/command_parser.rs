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
    let tokens = shell_words::split(agent_part)
        .map_err(|e| format!("Failed to parse agent command '{agent_part}': {e}"))?;

    if tokens.is_empty() {
        return Err(format!(
            "Second part doesn't start with 'claude', 'opencode', 'gemini', or 'codex': {command}"
        ));
    }

    let agent_token = &tokens[0];
    let is_claude = agent_token == "claude" || agent_token.ends_with("/claude");
    let is_opencode = agent_token == "opencode" || agent_token.ends_with("/opencode");
    let is_gemini = agent_token == "gemini" || agent_token.ends_with("/gemini");
    let is_codex = agent_token == "codex" || agent_token.ends_with("/codex");

    if !(is_claude || is_opencode || is_gemini || is_codex) {
        return Err(format!(
            "Second part doesn't start with 'claude', 'opencode', 'gemini', or 'codex': {command}"
        ));
    }

    let agent_name = agent_token.clone();
    let args = tokens[1..].to_vec();

    Ok((cwd, agent_name, args))
}
