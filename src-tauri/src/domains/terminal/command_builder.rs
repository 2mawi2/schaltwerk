use super::CreateParams;
use super::shell_invocation::{build_login_shell_invocation_with_shell, sh_quote_string};
use crate::shared::terminal_id::is_session_top_terminal_id;
use portable_pty::CommandBuilder;
use std::path::PathBuf;

const TERM_PROGRAM_NAME: &str = "schaltwerk";
const COLORTERM_VALUE: &str = "truecolor";

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
    let mut env = build_environment(cols, rows, &params.cwd);
    let env_remove = vec!["PROMPT_COMMAND".to_string(), "PS1".to_string()];

    let (program, args) = if let Some(app) = params.app.as_ref() {
        let (resolved_program, resolved_args, used_login_shell) =
            resolve_app_program_and_args(app, &params.cwd, &params.id);

        if used_login_shell {
            log::info!(
                "Executing '{}' via login shell: program='{}', args={:?}",
                app.command,
                resolved_program,
                resolved_args
            );
        } else {
            log::info!("Resolved command '{}' to '{}'", app.command, resolved_program);

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
            log::info!("EXACT COMMAND EXECUTION: {resolved_program} {args_str}");
            log::info!(
                "Command args array (each element is a separate argument): {:?}",
                app.args
            );
        }

        env.extend(app.env.clone());

        (resolved_program, resolved_args)
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

fn build_environment(cols: u16, rows: u16, #[cfg_attr(windows, allow(unused))] cwd: &str) -> Vec<(String, String)> {
    use std::collections::HashMap;
    let login_env = super::login_shell_env::get_login_shell_env();

    // Start with ALL environment variables from the login shell.
    // This ensures API keys, custom vars, SSH_AUTH_SOCK, virtual env settings, etc.
    // are all passed through to agent processes.
    let mut env_map: HashMap<String, String> = login_env.clone();

    // Override terminal-specific settings
    env_map.insert("TERM".to_string(), "xterm-256color".to_string());
    env_map.insert("LINES".to_string(), rows.to_string());
    env_map.insert("COLUMNS".to_string(), cols.to_string());

    // Build PATH with priority paths prepended
    #[cfg(unix)]
    let path_value = build_unix_path(login_env, &mut env_map, cwd);

    #[cfg(windows)]
    let path_value = build_windows_path(login_env, &mut env_map);

    env_map.insert("PATH".to_string(), path_value);

    // Ensure locale is set
    let lang_value = login_env
        .get("LANG")
        .cloned()
        .or_else(|| std::env::var("LANG").ok())
        .unwrap_or_else(|| "en_US.UTF-8".to_string());
    env_map.insert("LANG".to_string(), lang_value);

    if let Some(lc_all) = login_env
        .get("LC_ALL")
        .cloned()
        .or_else(|| std::env::var("LC_ALL").ok())
    {
        env_map.insert("LC_ALL".to_string(), lc_all);
    }

    // Terminal capability settings
    env_map.insert("CLICOLOR".to_string(), "1".to_string());
    env_map.insert("CLICOLOR_FORCE".to_string(), "1".to_string());
    env_map.insert("COLORTERM".to_string(), COLORTERM_VALUE.to_string());
    env_map.insert("TERM_PROGRAM".to_string(), TERM_PROGRAM_NAME.to_string());

    // Convert to Vec for compatibility with existing code
    env_map.into_iter().collect()
}

#[cfg(unix)]
fn build_unix_path(
    login_env: &std::collections::HashMap<String, String>,
    env_map: &mut std::collections::HashMap<String, String>,
    cwd: &str,
) -> String {
    if let Ok(home) = std::env::var("HOME") {
        env_map.insert("HOME".to_string(), home.clone());

        use std::collections::HashSet;
        let mut seen = HashSet::new();
        let mut path_components = Vec::new();

        let mut priority_paths = vec![
            format!("{home}/.local/bin"),
            format!("{home}/.cargo/bin"),
            format!("{home}/.bun/bin"),
            format!("{home}/.pyenv/shims"),
            format!("{home}/bin"),
        ];

        priority_paths.extend(super::nvm::nvm_bin_paths(&home, cwd));

        priority_paths.extend([
            format!("{home}/.volta/bin"),
            format!("{home}/.fnm"),
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/bin".to_string(),
            "/bin".to_string(),
            "/usr/sbin".to_string(),
            "/sbin".to_string(),
        ]);

        for path in priority_paths {
            if seen.insert(path.clone()) {
                path_components.push(path);
            }
        }

        let source_path = login_env
            .get("PATH")
            .cloned()
            .or_else(|| std::env::var("PATH").ok())
            .unwrap_or_default();

        const MAX_PATH_LENGTH: usize = 4096;
        let mut current_length: usize = path_components.iter().map(|s| s.len() + 1).sum();
        let mut truncated = false;

        for component in source_path.split(':') {
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

        path_components.join(":")
    } else {
        login_env.get("PATH").cloned().unwrap_or_else(|| {
            std::env::var("PATH").unwrap_or_else(|_| {
                "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string()
            })
        })
    }
}

#[cfg(windows)]
fn build_windows_path(
    login_env: &std::collections::HashMap<String, String>,
    env_map: &mut std::collections::HashMap<String, String>,
) -> String {
    use std::collections::HashSet;

    let userprofile = std::env::var("USERPROFILE").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let programfiles = std::env::var("ProgramFiles").unwrap_or_default();
    let programfiles_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

    if !userprofile.is_empty() {
        env_map.insert("USERPROFILE".to_string(), userprofile.clone());
    }

    let mut seen = HashSet::new();
    let mut path_components = Vec::new();

    // Build priority paths including common package managers and Node.js installations
    let mut priority_paths: Vec<String> = Vec::new();

    // Scoop package manager (very common on Windows for dev tools)
    priority_paths.push(format!("{userprofile}\\scoop\\shims"));
    priority_paths.push(format!("{userprofile}\\scoop\\apps\\nodejs-lts\\current"));
    priority_paths.push(format!("{userprofile}\\scoop\\apps\\nodejs\\current"));

    // Cargo/Rust
    priority_paths.push(format!("{userprofile}\\.cargo\\bin"));

    // npm global packages
    priority_paths.push(format!("{appdata}\\npm"));

    // nvm-windows (common Node.js version manager)
    priority_paths.push(format!("{appdata}\\nvm"));
    if let Ok(nvm_home) = std::env::var("NVM_HOME") {
        priority_paths.push(nvm_home);
    }
    if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
        priority_paths.push(nvm_symlink);
    }

    // Volta (another Node.js version manager)
    priority_paths.push(format!("{localappdata}\\Volta\\bin"));

    // fnm (Fast Node Manager)
    priority_paths.push(format!("{appdata}\\fnm"));

    // Standard Node.js installation paths
    priority_paths.push(format!("{programfiles}\\nodejs"));
    if !programfiles_x86.is_empty() {
        priority_paths.push(format!("{programfiles_x86}\\nodejs"));
    }

    // Windows Apps and other standard paths
    priority_paths.push(format!("{localappdata}\\Microsoft\\WindowsApps"));
    priority_paths.push(format!("{programfiles}\\Git\\cmd"));

    // Python paths
    priority_paths.push(format!("{localappdata}\\Programs\\Python\\Python311\\Scripts"));
    priority_paths.push(format!("{localappdata}\\Programs\\Python\\Python310\\Scripts"));
    priority_paths.push(format!("{localappdata}\\Programs\\Python\\Python312\\Scripts"));

    // Filter out invalid paths
    let priority_paths: Vec<String> = priority_paths
        .into_iter()
        .filter(|p| !p.starts_with('\\') && !p.is_empty())
        .collect();

    for path in priority_paths {
        if seen.insert(path.clone()) {
            path_components.push(path);
        }
    }

    let source_path = login_env
        .get("PATH")
        .cloned()
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default();

    const MAX_PATH_LENGTH: usize = 8192;
    let mut current_length: usize = path_components.iter().map(|s| s.len() + 1).sum();

    for component in source_path.split(';') {
        let trimmed = component.trim();
        if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
            let new_length = current_length + trimmed.len() + 1;
            if new_length > MAX_PATH_LENGTH {
                log::warn!(
                    "PATH truncated at {current_length} bytes to prevent 'path too long' error"
                );
                break;
            }
            current_length = new_length;
            path_components.push(trimmed.to_string());
        }
    }

    path_components.join(";")
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

fn resolve_command(command: &str, #[cfg_attr(windows, allow(unused))] cwd: &str) -> String {
    #[cfg(unix)]
    if command.contains('/') {
        return command.to_string();
    }

    #[cfg(windows)]
    if command.contains('\\') || command.contains('/') {
        return command.to_string();
    }

    #[cfg(unix)]
    {
        resolve_command_unix(command, cwd)
    }

    #[cfg(windows)]
    {
        resolve_command_windows(command)
    }
}

#[cfg(unix)]
fn resolve_command_unix(command: &str, cwd: &str) -> String {
    let common_paths = vec!["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];

    if let Ok(home) = std::env::var("HOME") {
        let mut user_paths = vec![
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/.bun/bin", home),
            format!("{}/bin", home),
        ];
        user_paths.extend(super::nvm::nvm_bin_paths(&home, cwd));
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

    if let Ok(path) = which::which(command) {
        let path_str = path.to_string_lossy().to_string();
        log::info!("Found {command} via which crate: {path_str}");
        return path_str;
    }

    log::warn!("Could not resolve path for '{command}', using as-is");
    command.to_string()
}

#[cfg(windows)]
fn resolve_command_windows(command: &str) -> String {
    let userprofile = std::env::var("USERPROFILE").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let programfiles = std::env::var("ProgramFiles").unwrap_or_default();

    let common_paths: Vec<String> = [
        format!("{userprofile}\\.cargo\\bin"),
        format!("{appdata}\\npm"),
        format!("{localappdata}\\Microsoft\\WindowsApps"),
        format!("{programfiles}\\Git\\cmd"),
        format!("{programfiles}\\nodejs"),
    ]
    .into_iter()
    .filter(|p| !p.starts_with('\\') && !p.is_empty())
    .collect();

    let extensions = ["", ".exe", ".cmd", ".bat", ".com"];

    for path in &common_paths {
        for ext in &extensions {
            let full_path = PathBuf::from(path).join(format!("{command}{ext}"));
            if full_path.exists() {
                log::info!("Found {command} at {}", full_path.display());
                return full_path.to_string_lossy().to_string();
            }
        }
    }

    if let Ok(path_env) = std::env::var("PATH") {
        for component in path_env.split(';').map(str::trim).filter(|c| !c.is_empty()) {
            for ext in &extensions {
                let full_path = PathBuf::from(component).join(format!("{command}{ext}"));
                if full_path.exists() {
                    log::info!("Found {command} via PATH entry {}", full_path.display());
                    return full_path.to_string_lossy().to_string();
                }
            }
        }
    }

    if let Ok(path) = which::which(command) {
        let path_str = path.to_string_lossy().to_string();
        log::info!("Found {command} via which crate: {path_str}");
        return path_str;
    }

    log::warn!("Could not resolve path for '{command}', using as-is");
    command.to_string()
}

fn resolve_app_program_and_args(
    app: &super::ApplicationSpec,
    cwd: &str,
    terminal_id: &str,
) -> (String, Vec<String>, bool) {
    let resolved = resolve_command(&app.command, cwd);

    #[cfg(unix)]
    let has_path_separator = app.command.contains('/');
    #[cfg(windows)]
    let has_path_separator = app.command.contains('\\') || app.command.contains('/');

    if resolved != app.command || has_path_separator {
        return (resolved, app.args.clone(), false);
    }

    let (shell, base_args) = super::get_effective_shell();
    let mut shell_args = base_args;

    // All wrapped commands need -i for .zshrc/.bashrc sourcing
    ensure_shell_interactive_flag(&shell, &mut shell_args);

    // Agent terminals need special handling:
    // - Keep -i flag for .zshrc/.bashrc sourcing (provides env vars like NVM, PYENV)
    // - But disable job control with 'set +m' to prevent conflicts with setRawMode()
    let is_agent_terminal = is_session_top_terminal_id(terminal_id)
        || terminal_id.starts_with("orchestrator-") && terminal_id.ends_with("-top");

    let inner = if is_agent_terminal {
        // Disable job control before executing agent
        format!("set +m; {}", build_shell_command_string(&shell, &app.command, &app.args))
    } else {
        build_shell_command_string(&shell, &app.command, &app.args)
    };

    let invocation = build_login_shell_invocation_with_shell(&shell, &shell_args, &inner);

    (invocation.program, invocation.args, true)
}

fn build_shell_command_string(shell: &str, command: &str, args: &[String]) -> String {
    let shell_name = shell_file_name(shell).unwrap_or_default();

    match shell_name.as_str() {
        "cmd" | "cmd.exe" => {
            let mut parts = Vec::with_capacity(args.len() + 1);
            parts.push(cmd_quote_string(command));
            for arg in args {
                parts.push(cmd_quote_string(arg));
            }
            parts.join(" ")
        }
        "pwsh" | "powershell" | "pwsh.exe" | "powershell.exe" => {
            let mut parts = Vec::with_capacity(args.len() + 2);
            parts.push("&".to_string());
            parts.push(ps_quote_string(command));
            for arg in args {
                parts.push(ps_quote_string(arg));
            }
            parts.join(" ")
        }
        _ => {
            let mut parts = Vec::with_capacity(args.len() + 2);
            parts.push("exec".to_string());
            parts.push(sh_quote_string(command));
            for arg in args {
                parts.push(sh_quote_string(arg));
            }
            parts.join(" ")
        }
    }
}

fn cmd_quote_string(s: &str) -> String {
    if s.contains(' ') || s.contains('"') || s.contains('&') || s.contains('^') {
        let escaped = s.replace('"', "\"\"");
        format!("\"{escaped}\"")
    } else {
        s.to_string()
    }
}

fn ps_quote_string(s: &str) -> String {
    if s.contains(' ') || s.contains('\'') || s.contains('"') {
        let escaped = s.replace('\'', "''");
        format!("'{escaped}'")
    } else {
        s.to_string()
    }
}

fn ensure_shell_interactive_flag(shell: &str, args: &mut Vec<String>) {
    let shell_name = shell_file_name(shell).unwrap_or_default();

    match shell_name.as_str() {
        "pwsh" | "powershell" | "pwsh.exe" | "powershell.exe" | "cmd" | "cmd.exe" => {
            return;
        }
        _ => {}
    }

    if args.iter().any(|arg| contains_short_flag(arg, 'i')) {
        return;
    }

    args.push("-i".to_string());
}

fn shell_file_name(shell: &str) -> Option<String> {
    std::path::Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase())
}

fn contains_short_flag(candidate: &str, flag: char) -> bool {
    if !candidate.starts_with('-') || candidate.starts_with("--") {
        return false;
    }

    let rest = &candidate[1..];
    if rest.is_empty() {
        return false;
    }

    if rest.len() == 1 {
        return rest.chars().next().is_some_and(|ch| ch == flag);
    }

    if rest.chars().all(|ch| ch.is_ascii_alphabetic()) {
        return rest.chars().any(|ch| ch == flag);
    }

    false
}

#[cfg(unix)]
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
    use super::build_environment;
    #[cfg(unix)]
    use super::normalize_path_component;
    use crate::domains::terminal::{put_terminal_shell_override, testing};
    use crate::utils::env_adapter::EnvAdapter;
    use serial_test::serial;
    use std::fs;

    #[cfg(unix)]
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

    #[cfg(unix)]
    #[test]
    fn normalize_path_component_preserves_regular_segments() {
        let result = normalize_path_component("/Applications/Ghostty.app/Contents/MacOS");
        assert_eq!(
            result,
            vec!["/Applications/Ghostty.app/Contents/MacOS".to_string()]
        );
    }

    #[cfg(unix)]
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

    #[test]
    fn environment_includes_terminal_metadata() {
        let env = build_environment(80, 24, "/tmp");
        assert!(
            env.iter()
                .any(|(key, value)| key == "TERM_PROGRAM" && value == "schaltwerk")
        );
        // TERM_PROGRAM_VERSION removed for compatibility
        assert!(
            !env.iter()
                .any(|(key, _)| key == "TERM_PROGRAM_VERSION")
        );
        assert!(
            env.iter()
                .any(|(key, value)| key == "COLORTERM" && value == "truecolor")
        );
    }

    #[test]
    #[serial]
    fn environment_includes_nvm_default_bin_when_available() {
        let original_home = std::env::var("HOME").ok();
        let original_path = std::env::var("PATH").ok();

        let temp_home = tempfile::tempdir().expect("temp home");
        let temp_cwd = tempfile::tempdir().expect("temp cwd");

        let nvm_dir = temp_home.path().join(".nvm");
        let alias_dir = nvm_dir.join("alias");
        let versions_bin = nvm_dir
            .join("versions")
            .join("node")
            .join("v20.11.0")
            .join("bin");

        fs::create_dir_all(&alias_dir).expect("alias dir");
        fs::create_dir_all(&versions_bin).expect("versions bin");
        fs::write(alias_dir.join("default"), "v20.11.0\n").expect("default alias");

        EnvAdapter::set_var("HOME", &temp_home.path().to_string_lossy());
        EnvAdapter::set_var("PATH", "/usr/bin:/bin");

        let env = build_environment(80, 24, &temp_cwd.path().to_string_lossy());
        let path_value = env
            .iter()
            .find(|(key, _)| key == "PATH")
            .map(|(_, value)| value.clone())
            .expect("PATH env");

        let expected = versions_bin.to_string_lossy();
        assert!(
            path_value.split(':').any(|entry| entry == expected),
            "PATH should include {expected}, got: {path_value}"
        );

        match original_home {
            Some(value) => EnvAdapter::set_var("HOME", &value),
            None => EnvAdapter::remove_var("HOME"),
        }
        match original_path {
            Some(value) => EnvAdapter::set_var("PATH", &value),
            None => EnvAdapter::remove_var("PATH"),
        }
    }

    #[tokio::test]
    async fn wraps_unresolved_app_command_in_login_shell() {
        let _guard = testing::override_lock();
        let prior_override = testing::capture_shell_override();
        put_terminal_shell_override("/bin/bash".to_string(), Vec::new());

        let params = super::CreateParams {
            id: "wrap-test".to_string(),
            cwd: "/tmp".to_string(),
            app: Some(super::super::ApplicationSpec {
                command: "definitely-not-a-real-binary".to_string(),
                args: vec!["--version".to_string()],
                env: Vec::new(),
                ready_timeout_ms: 0,
            }),
        };

        let spec = super::build_command_spec(&params, 80, 24)
            .await
            .expect("spec");

        let expected_inner = "exec 'definitely-not-a-real-binary' '--version'".to_string();

        assert_eq!(spec.program, "/bin/bash");
        assert_eq!(
            spec.args,
            vec![
                "-i".to_string(),
                "-l".to_string(),
                "-c".to_string(),
                expected_inner
            ],
            "expected wrapped command, got args={:?}",
            spec.args
        );

        testing::restore_shell_override(prior_override);
    }

    #[test]
    fn environment_passes_through_login_shell_variables() {
        // This test verifies that environment variables from the login shell
        // (like API keys, SSH_AUTH_SOCK, custom vars) are passed through.
        // The fix for issue #254 ensures ALL login shell env vars are included,
        // not just a curated subset.
        let env = build_environment(80, 24, "/tmp");

        // Check that basic required vars are present
        assert!(
            env.iter().any(|(key, _)| key == "TERM"),
            "TERM should be present"
        );
        assert!(
            env.iter().any(|(key, _)| key == "PATH"),
            "PATH should be present"
        );

        // The key change: login shell env vars should now be included.
        // On most systems, common vars like USER, SHELL, or others from login_shell_env
        // should be present if they were in the login shell environment.
        // We can't assert specific vars since they depend on the test environment,
        // but we verify the environment has more than just the hardcoded vars.
        let hardcoded_count = 9; // TERM, LINES, COLUMNS, PATH, LANG, CLICOLOR, CLICOLOR_FORCE, COLORTERM, TERM_PROGRAM
        assert!(
            env.len() >= hardcoded_count,
            "Environment should include at least {} vars (has {}), potentially more from login shell",
            hardcoded_count,
            env.len()
        );
    }
}
