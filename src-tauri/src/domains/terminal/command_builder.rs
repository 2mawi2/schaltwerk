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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::terminal::{put_terminal_shell_override, ApplicationSpec};
    use std::env;
    use tempfile::TempDir;

    #[tokio::test]
    async fn builds_shell_command_with_expected_environment() {
        let original_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let original_home = std::env::var("HOME").ok();
        let original_path = std::env::var("PATH").ok();
        put_terminal_shell_override("/bin/zsh".to_string(), vec!["-l".to_string()]);
        env::set_var("HOME", "/home/tester");
        env::set_var("PATH", "/custom/bin:/usr/bin");

        let params = CreateParams {
            id: "spec-shell".to_string(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        let spec = build_command_spec(&params, 120, 40)
            .await
            .expect("expected shell command spec");

        assert_eq!(spec.program, "/bin/zsh");
        assert_eq!(spec.args, vec!["-l".to_string()]);
        assert!(spec
            .env
            .iter()
            .any(|(k, v)| k == "TERM" && v == "xterm-256color"));
        assert!(spec.env.iter().any(|(k, v)| k == "LINES" && v == "40"));
        assert!(spec.env.iter().any(|(k, v)| k == "COLUMNS" && v == "120"));
        assert!(spec.env_remove.contains(&"PROMPT_COMMAND".to_string()));
        assert!(spec.env_remove.contains(&"PS1".to_string()));

        put_terminal_shell_override(original_shell, Vec::new());
        if let Some(home) = original_home {
            env::set_var("HOME", home);
        } else {
            env::remove_var("HOME");
        }
        if let Some(path) = original_path {
            env::set_var("PATH", path);
        } else {
            env::remove_var("PATH");
        }
    }

    #[tokio::test]
    async fn resolves_application_command_and_merges_env() {
        let original_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let original_home = std::env::var("HOME").ok();
        let original_path = std::env::var("PATH").ok();
        let temp_dir = TempDir::new().expect("temp dir");
        let bin_path = temp_dir.path().join("run-agent");
        std::fs::write(&bin_path, "#!/bin/sh\nexit 0\n").expect("write script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&bin_path)
                .expect("metadata")
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&bin_path, perms).expect("set perms");
        }

        env::set_var("PATH", format!("{}:/usr/bin", temp_dir.path().display()));
        env::set_var("HOME", temp_dir.path());

        let params = CreateParams {
            id: "spec-app".to_string(),
            cwd: "/tmp".to_string(),
            app: Some(ApplicationSpec {
                command: "run-agent".to_string(),
                args: vec!["--flag".to_string()],
                env: vec![("FOO".to_string(), "bar".to_string())],
                ready_timeout_ms: 1000,
            }),
        };

        let spec = build_command_spec(&params, 80, 24)
            .await
            .expect("expected app command spec");

        assert_eq!(spec.program, bin_path.to_string_lossy());
        assert!(spec.args.contains(&"--flag".to_string()));
        assert!(spec.env.iter().any(|(k, v)| k == "FOO" && v == "bar"));

        put_terminal_shell_override(original_shell, Vec::new());
        if let Some(home) = original_home {
            env::set_var("HOME", home);
        } else {
            env::remove_var("HOME");
        }
        if let Some(path) = original_path {
            env::set_var("PATH", path);
        } else {
            env::remove_var("PATH");
        }
    }
}

fn build_environment(cols: u16, rows: u16) -> Vec<(String, String)> {
    let mut envs = vec![
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("LINES".to_string(), rows.to_string()),
        ("COLUMNS".to_string(), cols.to_string()),
    ];

    let path_value = if let Ok(home) = std::env::var("HOME") {
        envs.push(("HOME".to_string(), home.clone()));

        let mut path_components = vec![
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

        if let Ok(existing_path) = std::env::var("PATH") {
            for component in existing_path.split(':') {
                let component = component.trim();
                if !component.is_empty() && !path_components.contains(&component.to_string()) {
                    path_components.push(component.to_string());
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
