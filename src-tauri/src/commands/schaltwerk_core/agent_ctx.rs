use std::path::Path;
use crate::SETTINGS_MANAGER;
use crate::commands::schaltwerk_core::schaltwerk_core_cli::extract_codex_prompt_if_present;
use schaltwerk::schaltwerk_core::db_project_config::ProjectConfigMethods;
use crate::commands::schaltwerk_core::schaltwerk_core_cli::{
    normalize_cli_text,
    fix_codex_single_dash_long_flags,
    reorder_codex_model_after_profile,
};

pub enum AgentKind { Claude, Cursor, Codex, OpenCode, Gemini, Fallback }

pub fn infer_agent_kind(agent_name: &str) -> AgentKind {
    if agent_name.ends_with("/claude") || agent_name == "claude" { AgentKind::Claude }
    else if agent_name.ends_with("/cursor-agent") || agent_name == "cursor-agent" { AgentKind::Cursor }
    else if agent_name.ends_with("/codex") || agent_name == "codex" { AgentKind::Codex }
    else if agent_name.contains("opencode") { AgentKind::OpenCode }
    else if agent_name.contains("gemini") { AgentKind::Gemini }
    else { AgentKind::Fallback }
}

pub async fn collect_agent_env_and_cli(
    agent_kind: &AgentKind,
    repo_path: &Path,
    db: &schaltwerk::schaltwerk_core::Database,
) -> (Vec<(String,String)>, String) {
    let agent_str = match agent_kind {
        AgentKind::Claude => "claude",
        AgentKind::Cursor => "cursor",
        AgentKind::Codex => "codex",
        AgentKind::OpenCode => "opencode",
        AgentKind::Gemini => "gemini",
        AgentKind::Fallback => "claude",
    };

    let (env_vars, cli_args) = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let mgr = settings_manager.lock().await;
        let mut env = mgr.get_agent_env_vars(agent_str)
                         .into_iter().collect::<Vec<_>>();
        if let Ok(project_env) = db.get_project_environment_variables(repo_path) {
            env.extend(project_env.into_iter());
        }
        (env, mgr.get_agent_cli_args(agent_str))
    } else { (vec![], String::new()) };

    (env_vars, cli_args)
}

pub fn build_final_args(
    agent_kind: &AgentKind,
    mut parsed_agent_args: Vec<String>,
    cli_args_text: &str,
) -> Vec<String> {
    if cli_args_text.is_empty() { return parsed_agent_args; }

    let normalized = normalize_cli_text(cli_args_text);
    let mut additional = shell_words::split(&normalized).unwrap_or_else(|_| vec![cli_args_text.to_string()]);

    match agent_kind {
        AgentKind::Codex => {
            // Preserve any trailing prompt from parsed args, then enforce flag normalization and order
            let extracted_prompt = extract_codex_prompt_if_present(&mut parsed_agent_args);
            fix_codex_single_dash_long_flags(&mut additional);
            reorder_codex_model_after_profile(&mut additional);
            parsed_agent_args.extend(additional);
            if let Some(p) = extracted_prompt { parsed_agent_args.push(p); }
            parsed_agent_args
        }
        _ => {
            parsed_agent_args.extend(additional);
            parsed_agent_args
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_agent_kind() {
        assert!(matches!(infer_agent_kind("claude"), AgentKind::Claude));
        assert!(matches!(infer_agent_kind("/usr/bin/claude"), AgentKind::Claude));
        assert!(matches!(infer_agent_kind("cursor-agent"), AgentKind::Cursor));
        assert!(matches!(infer_agent_kind("codex"), AgentKind::Codex));
        assert!(matches!(infer_agent_kind("something-opencode"), AgentKind::OpenCode));
        assert!(matches!(infer_agent_kind("gcloud-gemini"), AgentKind::Gemini));
        assert!(matches!(infer_agent_kind("unknown"), AgentKind::Fallback));
    }

    #[test]
    fn test_build_final_args_non_codex() {
        let args = build_final_args(&AgentKind::Claude, vec!["--flag".into()], "--extra one");
        assert_eq!(args, vec!["--flag", "--extra", "one"]);
    }

    #[test]
    fn test_build_final_args_codex_order() {
        let args = build_final_args(&AgentKind::Codex, vec!["--sandbox".into(), "workspace-write".into()], "-profile work --model gpt-4");
        // single-dash long flag fixed and model after profile
        assert_eq!(args, vec!["--sandbox", "workspace-write", "--profile", "work", "--model", "gpt-4"]);
    }
}
