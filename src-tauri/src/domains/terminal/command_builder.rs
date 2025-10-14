use super::CreateParams;
use portable_pty::CommandBuilder;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub env_remove: Vec<String>,
}

impl CommandSpec {
    pub fn into_builder(self) -> CommandBuilder {
        let mut builder = CommandBuilder::new(self.program);
        for var in self.env_remove {
            builder.env_remove(var);
        }
        for arg in self.args {
            builder.arg(arg);
        }
        for (key, value) in self.env {
            builder.env(key, value);
        }
        builder
    }
}

pub async fn build_command_spec(
    params: &CreateParams,
    cols: u16,
    rows: u16,
) -> Result<CommandSpec, String> {
    let mut env = build_environment(cols, rows);
    let env_remove = vec!["PROMPT_COMMAND".to_string(), "PS1".to_string()];

    let (program, args) = if let Some(app) = params.app.as_ref() {
        let resolved_command = resolve_command(&app.command);
        log::info!(
            "Resolved command '{}' to '{}'",
            app.command,
            resolved_command
        );

        let args_str = app
            .args
            .iter()
            .map(|arg| {
                if arg.contains(' ') {
                    format!("'{arg}'")
                } else {
                    arg.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        log::info!("EXACT COMMAND EXECUTION: {resolved_command} {args_str}");
        log::info!(
            "Command args array (each element is a separate argument): {:?}",
            app.args
        );

        env.extend(app.env.clone());

        (resolved_command, app.args.clone())
    } else {
        let (shell, shell_args) = get_shell_config().await;
        env.push(("SHELL".to_string(), shell.clone()));
        (shell, shell_args)
    };

    Ok(CommandSpec {
        program,
        args,
        env,
        env_remove,
    })
}

fn build_environment(cols: u16, rows: u16) -> Vec<(String, String)> {
    let mut envs = vec![
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("LINES".to_string(), rows.to_string()),
        ("COLUMNS".to_string(), cols.to_string()),
    ];

    let path_value = if let Ok(home) = std::env::var("HOME") {
        envs.push(("HOME".to_string(), home.clone()));

        use std::collections::HashSet;
        let mut seen = HashSet::new();
        let mut path_components = Vec::new();

        let priority_paths = vec![
            format!("{home}/.local/bin"),
            format!("{home}/.cargo/bin"),
            format!("{home}/.pyenv/shims"),
            format!("{home}/bin"),
            format!("{home}/.nvm/current/bin"),
            format!("{home}/.volta/bin"),
            format!("{home}/.fnm"),
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/bin".to_string(),
            "/bin".to_string(),
            "/usr/sbin".to_string(),
            "/sbin".to_string(),
        ];

        for path in priority_paths {
            if seen.insert(path.clone()) {
                path_components.push(path);
            }
        }

        if let Ok(existing_path) = std::env::var("PATH") {
            const MAX_PATH_LENGTH: usize = 4096;
            let mut current_length: usize = path_components.iter().map(|s| s.len() + 1).sum();
            let mut truncated = false;

            for component in existing_path.split(':') {
                if truncated {
                    break;
                }

                for entry in normalize_path_component(component) {
                    if seen.insert(entry.clone()) {
                        let new_length = current_length + entry.len() + 1;
                        if new_length > MAX_PATH_LENGTH {
                            log::warn!(
                                "PATH truncated at {current_length} bytes to prevent 'path too long' error"
                            );
                            truncated = true;
                            break;
                        }
                        current_length = new_length;
                        path_components.push(entry);
                    }
                }
            }
        }

        path_components.join(":")
    } else {
        std::env::var("PATH").unwrap_or_else(|_| {
            "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string()
        })
    };

    envs.push(("PATH".to_string(), path_value));

    let lang_value = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string());
    envs.push(("LANG".to_string(), lang_value));

    if let Ok(lc_all) = std::env::var("LC_ALL") {
        envs.push(("LC_ALL".to_string(), lc_all));
    }

    envs.push(("CLICOLOR".to_string(), "1".to_string()));
    envs.push(("CLICOLOR_FORCE".to_string(), "1".to_string()));

    envs
}

async fn get_shell_config() -> (String, Vec<String>) {
    let (shell, args) = super::get_effective_shell();
    log::info!(
        "Using shell: {shell}{}",
        if args.is_empty() {
            " (no args)"
        } else {
            " (with args)"
        }
    );
    (shell, args)
}

fn resolve_command(command: &str) -> String {
    if command.contains('/') {
        return command.to_string();
    }

    let common_paths = vec!["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];

    if let Ok(home) = std::env::var("HOME") {
        let mut user_paths = vec![
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/bin", home),
        ];
        user_paths.extend(common_paths.iter().map(|s| s.to_string()));

        for path in user_paths {
            let full_path = PathBuf::from(&path).join(command);
            if full_path.exists() {
                log::info!("Found {command} at {}", full_path.display());
                return full_path.to_string_lossy().to_string();
            }
        }
    }

    if let Ok(path_env) = std::env::var("PATH") {
        for component in path_env.split(':').map(str::trim).filter(|c| !c.is_empty()) {
            let full_path = PathBuf::from(component).join(command);
            if full_path.exists() {
                log::info!("Found {command} via PATH entry {}", full_path.display());
                return full_path.to_string_lossy().to_string();
            }
        }
    } else {
        for path in &common_paths {
            let full_path = PathBuf::from(path).join(command);
            if full_path.exists() {
                log::info!("Found {command} at {}", full_path.display());
                return full_path.to_string_lossy().to_string();
            }
        }
    }

    if let Ok(output) = std::process::Command::new("which").arg(command).output() {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    log::info!("Found {command} via which: {path}");
                    return path.to_string();
                }
            }
        }
    }

    log::warn!("Could not resolve path for '{command}', using as-is");
    command.to_string()
}

fn normalize_path_component(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let cleaned = trimmed
        .trim_matches(|c| matches!(c, '"' | '\''))
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return Vec::new();
    }

    if !cleaned.contains(" /") {
        return vec![cleaned];
    }

    let mut entries = Vec::new();
    let mut remainder = cleaned.as_str();
    loop {
        if let Some(idx) = remainder.find(" /") {
            let (head, tail) = remainder.split_at(idx);
            let head_trimmed = head.trim();
            if !head_trimmed.is_empty() {
                entries.push(head_trimmed.to_string());
            }
            remainder = tail[1..].trim_start();
        } else {
            let final_trimmed = remainder.trim();
            if !final_trimmed.is_empty() {
                entries.push(final_trimmed.to_string());
            }
            break;
        }
    }

    if entries.is_empty() {
        entries.push(cleaned);
    }

    entries
}

#[cfg(test)]
mod tests {
    use super::normalize_path_component;

    #[test]
    fn normalize_path_component_splits_whitespace_delimited_segments() {
        let result = normalize_path_component("/foo/bin /bar/bin /baz/bin");
        assert_eq!(
            result,
            vec![
                "/foo/bin".to_string(),
                "/bar/bin".to_string(),
                "/baz/bin".to_string()
            ]
        );
    }

    #[test]
    fn normalize_path_component_preserves_regular_segments() {
        let result = normalize_path_component("/Applications/Ghostty.app/Contents/MacOS");
        assert_eq!(
            result,
            vec!["/Applications/Ghostty.app/Contents/MacOS".to_string()]
        );
    }

    #[test]
    fn normalize_path_component_strips_quotes() {
        let result = normalize_path_component(
            "\"/Applications/Visual Studio Code.app/Contents/Resources/app/bin\"",
        );
        assert_eq!(
            result,
            vec!["/Applications/Visual Studio Code.app/Contents/Resources/app/bin".to_string()]
        );
    }
}
