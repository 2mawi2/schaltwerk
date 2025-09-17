pub mod claude;
pub mod command_parser;
pub mod codex;
pub mod cursor;
pub mod gemini;
pub mod naming;
pub mod opencode;
pub mod qwen;
pub mod unified;

pub use command_parser::parse_agent_command;

#[cfg(test)]
pub mod tests;
