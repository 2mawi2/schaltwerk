pub mod adapter;
pub mod amp;
pub mod claude;
pub mod codex;
pub mod command_parser;
pub mod copilot;
pub mod droid;
pub mod gemini;
pub mod kilocode;
pub mod launch_spec;
pub mod manifest;
pub mod naming;
pub mod opencode;
pub mod qwen;
pub mod unified;

use std::path::PathBuf;

#[cfg(windows)]
use crate::shared::resolve_windows_executable;

pub use adapter::{AgentAdapter, AgentLaunchContext};
pub use command_parser::parse_agent_command;
pub use launch_spec::AgentLaunchSpec;

pub(crate) fn get_home_dir() -> Option<String> {
    #[cfg(unix)]
    {
        std::env::var("HOME").ok()
    }
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok()
    }
    #[cfg(not(any(unix, windows)))]
    {
        dirs::home_dir().map(|p| p.to_string_lossy().to_string())
    }
}

pub(crate) fn resolve_agent_binary(command: &str) -> String {
    resolve_agent_binary_with_extra_paths(command, &[])
}

pub(crate) fn resolve_agent_binary_with_extra_paths(command: &str, extra_paths: &[String]) -> String {
    if let Some(home) = get_home_dir() {
        #[cfg(unix)]
        let mut user_paths = vec![
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/bin", home),
        ];

        #[cfg(windows)]
        let mut user_paths = vec![
            format!("{}\\.cargo\\bin", home),
            format!("{}\\AppData\\Roaming\\npm", home),
            format!("{}\\scoop\\shims", home),
        ];

        #[cfg(not(any(unix, windows)))]
        let mut user_paths: Vec<String> = vec![];

        user_paths.extend(extra_paths.iter().cloned());

        for path in user_paths {
            #[cfg(windows)]
            {
                for ext in &[".cmd", ".exe", ".bat", ""] {
                    let full_path = PathBuf::from(&path).join(format!("{command}{ext}"));
                    if full_path.exists() {
                        log::info!("Found {} at {}", command, full_path.display());
                        return full_path.to_string_lossy().to_string();
                    }
                }
            }
            #[cfg(not(windows))]
            {
                let full_path = PathBuf::from(&path).join(command);
                if full_path.exists() {
                    log::info!("Found {} at {}", command, full_path.display());
                    return full_path.to_string_lossy().to_string();
                }
            }
        }
    }

    #[cfg(unix)]
    {
        for path in &["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"] {
            let full_path = PathBuf::from(path).join(command);
            if full_path.exists() {
                log::info!("Found {} at {}", command, full_path.display());
                return full_path.to_string_lossy().to_string();
            }
        }
    }

    if let Ok(path) = which::which(command) {
        let path_str = path.to_string_lossy().to_string();
        log::info!("Found {command} via which crate: {path_str}");

        #[cfg(windows)]
        {
            let resolved = resolve_windows_executable(&path_str);
            log::info!("Windows executable resolution: {path_str} -> {resolved}");
            return resolved;
        }

        #[cfg(not(windows))]
        return path_str;
    }

    log::warn!("Could not resolve path for '{command}', using as-is");
    command.to_string()
}

pub(crate) fn escape_prompt_for_shell(prompt: &str) -> String {
    let mut escaped = String::with_capacity(prompt.len());
    for ch in prompt.chars() {
        match ch {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '$' => escaped.push_str("\\$"),
            '`' => escaped.push_str("\\`"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

#[cfg(test)]
pub mod tests;

pub(crate) fn format_binary_invocation(binary: &str) -> String {
    let trimmed = binary.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let already_quoted = (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''));
    if already_quoted {
        return trimmed.to_string();
    }

    // On Windows, backslashes are path separators and should not trigger quoting
    // On Unix, backslashes are escape characters and need special handling
    #[cfg(windows)]
    let needs_quoting = trimmed.chars().any(|c| c.is_whitespace() || c == '"');
    #[cfg(not(windows))]
    let needs_quoting = trimmed
        .chars()
        .any(|c| c.is_whitespace() || matches!(c, '"' | '\\'));

    if !needs_quoting {
        return trimmed.to_string();
    }

    let mut escaped = String::with_capacity(trimmed.len() + 2);
    escaped.push('"');
    for ch in trimmed.chars() {
        match ch {
            '"' => escaped.push_str("\\\""),
            // On Windows, don't escape backslashes - they're path separators
            #[cfg(not(windows))]
            '\\' => escaped.push_str("\\\\"),
            _ => escaped.push(ch),
        }
    }
    escaped.push('"');
    escaped
}
