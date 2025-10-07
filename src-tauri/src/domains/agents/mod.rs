pub mod adapter;
pub mod claude;
pub mod codex;
pub mod command_parser;
pub mod droid;
pub mod gemini;
pub mod launch_spec;
pub mod manifest;
pub mod naming;
pub mod opencode;
pub mod unified;

pub use adapter::{AgentAdapter, AgentLaunchContext};
pub use command_parser::parse_agent_command;
pub use launch_spec::AgentLaunchSpec;

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
            '\\' => escaped.push_str("\\\\"),
            _ => escaped.push(ch),
        }
    }
    escaped.push('"');
    escaped
}
