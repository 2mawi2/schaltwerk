pub mod adapter;
pub mod claude;
pub mod codex;
pub mod command_parser;
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
