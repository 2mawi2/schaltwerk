use super::escape_prompt_for_shell;
use super::format_binary_invocation;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct KilocodeConfig {
    pub binary_path: Option<String>,
}

pub fn find_kilocode_session(_path: &Path) -> Option<String> {
    // Session resumption not supported
    None
}

pub fn build_kilocode_command_with_config(
    worktree_path: &Path,
    _session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&KilocodeConfig>,
) -> String {
    // Use simple binary name and let system PATH handle resolution
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "kilocode"
            }
        } else {
            "kilocode"
        }
    } else {
        "kilocode"
    };
    let binary_invocation = format_binary_invocation(binary_name);
    let cwd_quoted = format_binary_invocation(&worktree_path.display().to_string());
    let mut cmd = format!("cd {cwd_quoted} && {binary_invocation}");

    if skip_permissions {
        cmd.push_str(" --auto");
    }

    if let Some(prompt) = initial_prompt {
        let escaped = escape_prompt_for_shell(prompt);
        cmd.push(' ');
        cmd.push('"');
        cmd.push_str(&escaped);
        cmd.push('"');
    }

    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let config = KilocodeConfig {
            binary_path: Some("kilocode".to_string()),
        };
        let cmd = build_kilocode_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );
        assert!(cmd.ends_with("kilocode --auto \"implement feature X\""));
    }

    #[test]
    fn test_command_with_spaces_in_cwd() {
        let config = KilocodeConfig {
            binary_path: Some("kilocode".to_string()),
        };
        let cmd = build_kilocode_command_with_config(
            Path::new("/path/with spaces"),
            None,
            None,
            false,
            Some(&config),
        );
        assert!(cmd.starts_with(r#"cd "/path/with spaces" && "#));
    }

    #[test]
    fn test_basic_command() {
        let config = KilocodeConfig {
            binary_path: Some("kilocode".to_string()),
        };
        let cmd = build_kilocode_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("hello"),
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && kilocode \"hello\"");
    }
}
