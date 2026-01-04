use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

static CACHED_ENV: OnceLock<HashMap<String, String>> = OnceLock::new();

const DEFAULT_TIMEOUT_SECS: u64 = 10;

pub fn get_login_shell_env() -> &'static HashMap<String, String> {
    CACHED_ENV.get_or_init(|| {
        std::thread::spawn(|| {
            tokio::runtime::Runtime::new()
                .ok()
                .and_then(|rt| rt.block_on(async { capture_login_shell_env().await.ok() }))
                .unwrap_or_default()
        })
        .join()
        .unwrap_or_default()
    })
}

pub async fn capture_login_shell_env() -> Result<HashMap<String, String>, String> {
    let (shell, _) = super::get_effective_shell();
    let shell_name = get_shell_name(&shell);

    log::info!("Capturing login shell environment using shell: {shell} ({shell_name})");

    let mark = generate_marker();
    let (shell_args, command) = build_shell_command(&shell_name, &mark);

    log::debug!("Shell command: {shell} {shell_args:?} {command:?}");

    let mut cmd = Command::new(&shell);
    cmd.args(&shell_args)
        .arg(&command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("SCHALTWERK_RESOLVING_ENVIRONMENT", "1");

    let result = timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS), cmd.output()).await;

    let output = match result {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            log::error!("Failed to spawn login shell {shell}: {e}");
            return Err(format!("Failed to spawn login shell: {e}"));
        }
        Err(_) => {
            log::error!(
                "Timeout after {DEFAULT_TIMEOUT_SECS}s waiting for shell environment from {shell}"
            );
            return Err(format!(
                "Timeout after {DEFAULT_TIMEOUT_SECS}s waiting for shell environment"
            ));
        }
    };

    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        log::debug!("Shell stderr: {}", stderr.trim());
    }

    if !output.status.success() {
        log::warn!(
            "Login shell exited with status: {} (stderr: {})",
            output.status,
            stderr.trim()
        );
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let env_map = parse_marked_json_output(&stdout, &mark)
        .or_else(|| {
            log::debug!("JSON parsing failed, falling back to env output parsing");
            Some(parse_env_output(&stdout))
        })
        .unwrap_or_default();

    let cleaned_env = clean_captured_env(env_map);

    log::info!(
        "Captured {} environment variables from login shell",
        cleaned_env.len()
    );

    Ok(cleaned_env)
}

fn get_shell_name(shell_path: &str) -> String {
    let name = Path::new(shell_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("sh")
        .to_ascii_lowercase();
    name.strip_suffix(".exe").unwrap_or(&name).to_string()
}

fn generate_marker() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("SCHALTWERK{timestamp:x}")
}

fn build_shell_command(shell_name: &str, mark: &str) -> (Vec<String>, String) {
    match shell_name {
        "nu" | "nushell" => {
            let command = format!(
                "print -n '{mark}'; $env | to json | print -n; print -n '{mark}'"
            );
            (
                vec!["-l".to_string(), "-c".to_string()],
                command,
            )
        }
        "fish" => {
            let command = format!(
                "echo -n '{mark}'; env | while read -l line; \
                 set -l parts (string split '=' -- $line); \
                 if test (count $parts) -ge 2; \
                 echo $parts[1]'='(string join '=' $parts[2..]); \
                 end; end; echo -n '{mark}'"
            );
            (
                vec!["-l".to_string(), "-c".to_string()],
                command,
            )
        }
        "xonsh" => {
            let command = format!(
                "import os, json; print('{mark}', end=''); \
                 print(json.dumps(dict(os.environ)), end=''); \
                 print('{mark}', end='')"
            );
            (
                vec!["-l".to_string(), "-c".to_string()],
                command,
            )
        }
        "tcsh" | "csh" => {
            let command = format!("echo -n '{mark}'; env; echo -n '{mark}'");
            (vec!["-c".to_string()], command)
        }
        "pwsh" | "powershell" => {
            let command = format!(
                "Write-Host -NoNewline '{mark}'; \
                 Get-ChildItem Env: | ForEach-Object {{ \"$($_.Name)=$($_.Value)\" }}; \
                 Write-Host -NoNewline '{mark}'"
            );
            (
                vec!["-Command".to_string()],
                command,
            )
        }
        "cmd" => {
            let command = format!(
                "@echo off & echo|set /p=\"{mark}\" & set & echo|set /p=\"{mark}\""
            );
            (
                vec!["/C".to_string()],
                command,
            )
        }
        _ => {
            let command = format!("echo -n '{mark}'; env; echo -n '{mark}'");
            (
                vec!["-i".to_string(), "-l".to_string(), "-c".to_string()],
                command,
            )
        }
    }
}

fn parse_marked_json_output(output: &str, mark: &str) -> Option<HashMap<String, String>> {
    let start_idx = output.find(mark)?;
    let after_start = &output[start_idx + mark.len()..];
    let end_idx = after_start.find(mark)?;
    let json_str = &after_start[..end_idx];

    if json_str.trim().starts_with('{') {
        match serde_json::from_str::<HashMap<String, serde_json::Value>>(json_str) {
            Ok(map) => {
                let env: HashMap<String, String> = map
                    .into_iter()
                    .filter_map(|(k, v)| match v {
                        serde_json::Value::String(s) => Some((k, s)),
                        serde_json::Value::Number(n) => Some((k, n.to_string())),
                        serde_json::Value::Bool(b) => Some((k, b.to_string())),
                        _ => None,
                    })
                    .collect();
                log::debug!("Parsed {} env vars from JSON", env.len());
                return Some(env);
            }
            Err(e) => {
                log::debug!("Failed to parse JSON: {e}");
            }
        }
    }

    let env = parse_env_output(json_str);
    if !env.is_empty() {
        log::debug!("Parsed {} env vars from marked env output", env.len());
        return Some(env);
    }

    None
}

fn parse_env_output(output: &str) -> HashMap<String, String> {
    let mut env = HashMap::new();
    let mut current_key: Option<String> = None;
    let mut current_value = String::new();

    for line in output.lines() {
        match try_parse_env_line(line) {
            EnvLineResult::Parsed(key, value) => {
                if let Some(prev_key) = current_key.take() {
                    env.insert(prev_key, current_value.trim_end().to_string());
                }
                current_key = Some(key);
                current_value = value;
            }
            EnvLineResult::Continuation if current_key.is_some() => {
                current_value.push('\n');
                current_value.push_str(line);
            }
            EnvLineResult::InvalidKey | EnvLineResult::Continuation => {}
        }
    }

    if let Some(key) = current_key.take() {
        env.insert(key, current_value.trim_end().to_string());
    }

    env
}

enum EnvLineResult {
    Parsed(String, String),
    InvalidKey,
    Continuation,
}

fn try_parse_env_line(line: &str) -> EnvLineResult {
    let Some(eq_pos) = line.find('=') else {
        return EnvLineResult::Continuation;
    };

    let key = &line[..eq_pos];

    if key.is_empty() || !is_valid_env_key(key) {
        return EnvLineResult::InvalidKey;
    }

    let value = &line[eq_pos + 1..];
    EnvLineResult::Parsed(key.to_string(), value.to_string())
}

fn is_valid_env_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !key.chars().next().unwrap_or('0').is_ascii_digit()
}

fn clean_captured_env(mut env: HashMap<String, String>) -> HashMap<String, String> {
    env.remove("SCHALTWERK_RESOLVING_ENVIRONMENT");
    env.remove("SHLVL");
    env.remove("_");
    env.remove("PWD");
    env.remove("OLDPWD");

    env
}

pub fn get_login_shell_path() -> Option<String> {
    get_login_shell_env().get("PATH").cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_env_output_extracts_key_value_pairs() {
        let output = "HOME=/Users/test\nPATH=/usr/bin:/bin\nLANG=en_US.UTF-8";
        let env = parse_env_output(output);

        assert_eq!(env.get("HOME"), Some(&"/Users/test".to_string()));
        assert_eq!(env.get("PATH"), Some(&"/usr/bin:/bin".to_string()));
        assert_eq!(env.get("LANG"), Some(&"en_US.UTF-8".to_string()));
    }

    #[test]
    fn parse_env_output_handles_values_with_equals() {
        let output = "CONFIG=key=value";
        let env = parse_env_output(output);

        assert_eq!(env.get("CONFIG"), Some(&"key=value".to_string()));
    }

    #[test]
    fn parse_env_output_handles_multiline_values() {
        let output = "SIMPLE=value\nMULTILINE=line1\nline2\nline3\nANOTHER=test";
        let env = parse_env_output(output);

        assert_eq!(env.get("SIMPLE"), Some(&"value".to_string()));
        assert_eq!(
            env.get("MULTILINE"),
            Some(&"line1\nline2\nline3".to_string())
        );
        assert_eq!(env.get("ANOTHER"), Some(&"test".to_string()));
    }

    #[test]
    fn parse_env_output_skips_invalid_keys() {
        let output = "VALID_KEY=value\n123INVALID=bad\n=nokey\nANOTHER_VALID=ok";
        let env = parse_env_output(output);

        assert_eq!(env.get("VALID_KEY"), Some(&"value".to_string()));
        assert_eq!(env.get("ANOTHER_VALID"), Some(&"ok".to_string()));
        assert!(!env.contains_key("123INVALID"));
        assert!(!env.contains_key(""));
    }

    #[test]
    fn is_valid_env_key_accepts_valid_keys() {
        assert!(is_valid_env_key("HOME"));
        assert!(is_valid_env_key("PATH"));
        assert!(is_valid_env_key("MY_VAR_123"));
        assert!(is_valid_env_key("_PRIVATE"));
    }

    #[test]
    fn is_valid_env_key_rejects_invalid_keys() {
        assert!(!is_valid_env_key(""));
        assert!(!is_valid_env_key("123START"));
        assert!(!is_valid_env_key("has space"));
        assert!(!is_valid_env_key("has-dash"));
        assert!(!is_valid_env_key("has.dot"));
    }

    #[test]
    fn parse_marked_json_output_extracts_json() {
        let mark = "MARKER123";
        let output = format!(
            "some shell noise\n{mark}{{\"HOME\":\"/Users/test\",\"PATH\":\"/usr/bin\"}}{mark}\nmore noise"
        );
        let env = parse_marked_json_output(&output, mark).unwrap();

        assert_eq!(env.get("HOME"), Some(&"/Users/test".to_string()));
        assert_eq!(env.get("PATH"), Some(&"/usr/bin".to_string()));
    }

    #[test]
    fn parse_marked_json_output_falls_back_to_env_parsing() {
        let mark = "MARKER123";
        let output = format!("{mark}HOME=/Users/test\nPATH=/usr/bin{mark}");
        let env = parse_marked_json_output(&output, mark).unwrap();

        assert_eq!(env.get("HOME"), Some(&"/Users/test".to_string()));
        assert_eq!(env.get("PATH"), Some(&"/usr/bin".to_string()));
    }

    #[test]
    fn build_shell_command_bash_zsh() {
        let (args, cmd) = build_shell_command("bash", "MARK");
        assert_eq!(args, vec!["-i", "-l", "-c"]);
        assert!(cmd.contains("MARK"));
        assert!(cmd.contains("env"));
    }

    #[test]
    fn build_shell_command_fish() {
        let (args, _cmd) = build_shell_command("fish", "MARK");
        assert_eq!(args, vec!["-l", "-c"]);
    }

    #[test]
    fn build_shell_command_nu() {
        let (args, cmd) = build_shell_command("nu", "MARK");
        assert_eq!(args, vec!["-l", "-c"]);
        assert!(cmd.contains("$env"));
    }

    #[test]
    fn build_shell_command_tcsh() {
        let (args, _) = build_shell_command("tcsh", "MARK");
        assert_eq!(args, vec!["-c"]);
    }

    #[test]
    fn clean_captured_env_removes_internal_vars() {
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), "/usr/bin".to_string());
        env.insert(
            "SCHALTWERK_RESOLVING_ENVIRONMENT".to_string(),
            "1".to_string(),
        );
        env.insert("SHLVL".to_string(), "2".to_string());
        env.insert("_".to_string(), "/bin/env".to_string());
        env.insert("HOME".to_string(), "/Users/test".to_string());

        let cleaned = clean_captured_env(env);

        assert!(cleaned.contains_key("PATH"));
        assert!(cleaned.contains_key("HOME"));
        assert!(!cleaned.contains_key("SCHALTWERK_RESOLVING_ENVIRONMENT"));
        assert!(!cleaned.contains_key("SHLVL"));
        assert!(!cleaned.contains_key("_"));
    }

    #[test]
    fn get_shell_name_extracts_basename() {
        assert_eq!(get_shell_name("/bin/bash"), "bash");
        assert_eq!(get_shell_name("/usr/local/bin/fish"), "fish");
        assert_eq!(get_shell_name("/opt/homebrew/bin/nu"), "nu");
        assert_eq!(get_shell_name("zsh"), "zsh");
    }

    #[test]
    fn get_shell_name_strips_exe_suffix() {
        assert_eq!(get_shell_name("cmd.exe"), "cmd");
        assert_eq!(get_shell_name("pwsh.exe"), "pwsh");
        assert_eq!(get_shell_name("powershell.exe"), "powershell");
    }

    #[tokio::test]
    async fn capture_login_shell_env_returns_path() {
        let env = capture_login_shell_env().await;

        assert!(env.is_ok(), "Should capture environment: {:?}", env);
        let env = env.unwrap();
        assert!(env.contains_key("PATH"), "Should have PATH");
        assert!(env.contains_key("HOME"), "Should have HOME");
    }
}
