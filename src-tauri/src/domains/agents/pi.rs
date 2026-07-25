use super::format_binary_invocation;
use serde::Deserialize;
use std::borrow::Cow;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Default)]
pub struct PiConfig {
    pub binary_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PiSessionHeader {
    #[serde(rename = "type")]
    entry_type: String,
    id: String,
    cwd: String,
}

fn pi_agent_dir() -> Option<PathBuf> {
    std::env::var("PI_CODING_AGENT_DIR")
        .ok()
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".pi").join("agent")))
}

pub(crate) fn pi_session_dir_for_worktree(worktree_path: &Path, agent_dir: &Path) -> PathBuf {
    if let Ok(custom) = std::env::var("PI_CODING_AGENT_SESSION_DIR")
        && !custom.trim().is_empty()
    {
        return PathBuf::from(custom);
    }

    let resolved = fs::canonicalize(worktree_path)
        .unwrap_or_else(|_| worktree_path.to_path_buf())
        .to_string_lossy()
        .to_string();
    let encoded = encode_pi_session_path(&resolved);

    agent_dir.join("sessions").join(format!("--{encoded}--"))
}

fn encode_pi_session_path(resolved: &str) -> String {
    let normalized = if let Some(path) = resolved.strip_prefix(r"\\?\UNC\") {
        Cow::Owned(format!(r"\\{path}"))
    } else if let Some(path) = resolved.strip_prefix(r"\\?\") {
        Cow::Borrowed(path)
    } else {
        Cow::Borrowed(resolved)
    };
    let without_root = normalized
        .strip_prefix('/')
        .or_else(|| normalized.strip_prefix('\\'))
        .unwrap_or(&normalized);

    without_root
        .chars()
        .map(|character| {
            if matches!(character, '/' | '\\' | ':') {
                '-'
            } else {
                character
            }
        })
        .collect()
}

fn read_pi_session(path: &Path, worktree_path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut lines = BufReader::new(file).lines();
    let header_line = lines.next()?.ok()?;
    let header: PiSessionHeader = serde_json::from_str(&header_line).ok()?;
    if header.entry_type != "session" {
        return None;
    }

    let resolved_worktree =
        fs::canonicalize(worktree_path).unwrap_or_else(|_| worktree_path.to_path_buf());
    let resolved_header =
        fs::canonicalize(&header.cwd).unwrap_or_else(|_| PathBuf::from(&header.cwd));
    if resolved_header != resolved_worktree {
        return None;
    }

    let has_history = lines.map_while(Result::ok).any(|line| {
        serde_json::from_str::<serde_json::Value>(&line)
            .ok()
            .is_some_and(|entry| {
                entry.get("type").and_then(|value| value.as_str()) == Some("message")
            })
    });

    has_history.then_some(header.id)
}

pub fn find_pi_session(worktree_path: &Path) -> Option<String> {
    let agent_dir = pi_agent_dir()?;
    let session_dir = pi_session_dir_for_worktree(worktree_path, &agent_dir);
    let entries = fs::read_dir(session_dir).ok()?;

    let mut candidates = entries
        .flatten()
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("jsonl"))
        .filter_map(|entry| {
            let path = entry.path();
            let id = read_pi_session(&path, worktree_path)?;
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let file_name = entry.file_name();
            Some((modified, file_name, id))
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    candidates.pop().map(|(_, _, id)| id)
}

pub fn build_pi_command_with_config(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&PiConfig>,
) -> String {
    let binary = config
        .and_then(|value| value.binary_path.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("pi");
    let binary_invocation = format_binary_invocation(binary);
    let cwd = format_binary_invocation(&worktree_path.display().to_string());
    let mut command = format!("cd {cwd} && {binary_invocation}");

    if let Some(id) = session_id.map(str::trim).filter(|value| !value.is_empty()) {
        command.push_str(" --session ");
        command.push_str(&format_binary_invocation(id));
    }

    if skip_permissions {
        command.push_str(" --approve");
    }

    if let Some(prompt) = initial_prompt.filter(|value| !value.trim().is_empty()) {
        let escaped = super::escape_prompt_for_shell(prompt);
        command.push_str(" \"");
        command.push_str(&escaped);
        command.push('"');
    }

    command
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::command_parser::parse_agent_command;
    use crate::utils::env_adapter::EnvAdapter;
    use serial_test::serial;
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn builds_new_session_with_initial_prompt_and_approval() {
        let config = PiConfig {
            binary_path: Some("pi".to_string()),
        };
        let command = build_pi_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );

        assert_eq!(
            command,
            r#"cd /path/to/worktree && pi --approve "implement feature X""#
        );
    }

    #[test]
    fn resumes_exact_session_without_replaying_initial_prompt() {
        let config = PiConfig {
            binary_path: Some("/custom/pi".to_string()),
        };
        let command = build_pi_command_with_config(
            Path::new("/path with spaces/worktree"),
            Some("019f-session-id"),
            None,
            false,
            Some(&config),
        );

        assert_eq!(
            command,
            r#"cd "/path with spaces/worktree" && /custom/pi --session 019f-session-id"#
        );
    }

    #[test]
    fn prompt_round_trips_through_shell_parser() {
        let prompt = "Inspect \"$HOME\" and `status`\nthen keep C:\\\\tmp\\\\ intact";
        let command = build_pi_command_with_config(
            Path::new("/tmp/worktree"),
            None,
            Some(prompt),
            false,
            None,
        );

        let (_, agent, args) = parse_agent_command(&command).expect("Pi command should parse");
        assert_eq!(agent, "pi");
        assert_eq!(args.last().map(String::as_str), Some(prompt));
    }

    #[test]
    fn session_directory_encoding_matches_pi_on_windows() {
        assert_eq!(
            encode_pi_session_path(r"\\?\C:\Users\dev\project"),
            "C--Users-dev-project"
        );
        assert_eq!(
            encode_pi_session_path(r"\\?\UNC\server\share\project"),
            "-server-share-project"
        );
    }

    #[test]
    #[serial]
    fn finds_newest_pi_session_with_history_for_worktree() {
        let temp = tempdir().expect("temp dir");
        let agent_dir = temp.path().join("pi-agent");
        let worktree = temp.path().join("worktree");
        fs::create_dir_all(&worktree).expect("worktree");
        let session_dir = pi_session_dir_for_worktree(&worktree, &agent_dir);
        fs::create_dir_all(&session_dir).expect("session dir");

        fs::write(
            session_dir.join("2026-01-01T00-00-00_old.jsonl"),
            format!(
                "{{\"type\":\"session\",\"version\":3,\"id\":\"old-id\",\"cwd\":{}}}\n",
                serde_json::to_string(&worktree.to_string_lossy()).unwrap()
            ),
        )
        .expect("old session");
        fs::write(
            session_dir.join("2026-01-02T00-00-00_new.jsonl"),
            format!(
                "{{\"type\":\"session\",\"version\":3,\"id\":\"new-id\",\"cwd\":{}}}\n\
                 {{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"hello\"}}}}\n",
                serde_json::to_string(&worktree.to_string_lossy()).unwrap()
            ),
        )
        .expect("new session");

        let previous = std::env::var("PI_CODING_AGENT_DIR").ok();
        EnvAdapter::set_var("PI_CODING_AGENT_DIR", &agent_dir.to_string_lossy());
        let found = find_pi_session(&worktree);
        if let Some(value) = previous {
            EnvAdapter::set_var("PI_CODING_AGENT_DIR", &value);
        } else {
            EnvAdapter::remove_var("PI_CODING_AGENT_DIR");
        }

        assert_eq!(found.as_deref(), Some("new-id"));
    }
}
