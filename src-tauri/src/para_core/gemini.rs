use std::path::{Path, PathBuf};
use std::fs;

#[derive(Debug, Clone, Default)]
pub struct GeminiConfig {
    pub binary_path: Option<String>,
}

fn resolve_gemini_binary_with_config(config: Option<&GeminiConfig>) -> String {
    let command = "gemini";
    
    // Check config first (useful for tests)
    if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                log::info!("Using gemini from config: {trimmed}");
                return trimmed.to_string();
            }
        }
    }
    
    // Continue with normal resolution
    resolve_gemini_binary_impl(command)
}

fn resolve_gemini_binary_impl(command: &str) -> String {
    if let Ok(home) = std::env::var("HOME") {
        let user_paths = vec![
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/bin", home),
            format!("{}/.gemini/bin", home),
        ];
        
        for path in user_paths {
            let full_path = PathBuf::from(&path).join(command);
            if full_path.exists() {
                log::info!("Found gemini at {}", full_path.display());
                return full_path.to_string_lossy().to_string();
            }
        }
    }
    
    let common_paths = vec![
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
    ];
    
    for path in common_paths {
        let full_path = PathBuf::from(path).join(command);
        if full_path.exists() {
            log::info!("Found gemini at {}", full_path.display());
            return full_path.to_string_lossy().to_string();
        }
    }
    
    if let Ok(output) = std::process::Command::new("which")
        .arg(command)
        .output()
    {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    log::info!("Found gemini via which: {path}");
                    return path.to_string();
                }
            }
        }
    }
    
    log::warn!("Could not resolve path for 'gemini', using as-is. This may fail in installed apps.");
    command.to_string()
}

pub fn find_gemini_session(path: &Path) -> Option<String> {
    let session_file = path.join(".gemini-session");
    
    if session_file.exists() {
        fs::read_to_string(&session_file)
            .ok()
            .and_then(|content| {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    Some(trimmed.to_string())
                } else {
                    None
                }
            })
    } else {
        None
    }
}

pub fn build_gemini_command_with_config(
    worktree_path: &Path,
    _session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&GeminiConfig>,
) -> String {
    let gemini_bin = resolve_gemini_binary_with_config(config);
    let mut cmd = format!("cd {} && {}", worktree_path.display(), gemini_bin);
    
    if skip_permissions {
        cmd.push_str(" --yolo");
    }
    
    // Gemini doesn't support session resumption like Claude
    // Use --prompt-interactive for interactive mode with an initial prompt
    if let Some(prompt) = initial_prompt {
        let escaped = prompt.replace('"', r#"\""#);
        cmd.push_str(&format!(r#" --prompt-interactive "{escaped}""#));
    }
    
    cmd
}

pub fn build_gemini_command(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
) -> String {
    build_gemini_command_with_config(worktree_path, session_id, initial_prompt, skip_permissions, None)
}

// Backward compatibility
pub fn resolve_gemini_binary() -> String {
    resolve_gemini_binary_with_config(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && gemini --yolo --prompt-interactive "implement feature X""#);
    }

    #[test]
    fn test_resume_with_session_id() {
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            Some("12345678-1234-1234-1234-123456789012"),
            None,
            false,
            Some(&config),
        );
        // Gemini doesn't support resume, so we just start interactive mode
        assert_eq!(cmd, "cd /path/to/worktree && gemini");
    }

    #[test]
    fn test_new_session_no_prompt_no_permissions() {
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && gemini");
    }

    #[test]
    fn test_prompt_with_quotes() {
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
            Some(&config),
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && gemini --prompt-interactive "implement \"feature\" with quotes""#);
    }
}