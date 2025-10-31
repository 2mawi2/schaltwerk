use crate::SETTINGS_MANAGER;
use crate::commands::schaltwerk_core::schaltwerk_core_cli::extract_codex_prompt_if_present;
use crate::commands::schaltwerk_core::schaltwerk_core_cli::{
    fix_codex_single_dash_long_flags, normalize_cli_text, reorder_codex_model_after_profile,
};
use schaltwerk::domains::settings::AgentPreference;
use schaltwerk::schaltwerk_core::db_project_config::ProjectConfigMethods;
use std::path::Path;

pub enum AgentKind {
    Claude,
    Codex,
    OpenCode,
    Gemini,
    Amp,
    Droid,
    Fallback,
}

pub fn infer_agent_kind(agent_name: &str) -> AgentKind {
    if agent_name.ends_with("/claude") || agent_name == "claude" {
        AgentKind::Claude
    } else if agent_name.ends_with("/codex") || agent_name == "codex" {
        AgentKind::Codex
    } else if agent_name.contains("opencode") {
        AgentKind::OpenCode
    } else if agent_name.contains("gemini") {
        AgentKind::Gemini
    } else if agent_name.ends_with("/amp") || agent_name == "amp" {
        AgentKind::Amp
    } else if agent_name.ends_with("/droid") || agent_name == "droid" {
        AgentKind::Droid
    } else {
        AgentKind::Fallback
    }
}

impl AgentKind {
    pub fn manifest_key(&self) -> &str {
        match self {
            AgentKind::Claude => "claude",
            AgentKind::Codex => "codex",
            AgentKind::OpenCode => "opencode",
            AgentKind::Gemini => "gemini",
            AgentKind::Amp => "amp",
            AgentKind::Droid => "droid",
            AgentKind::Fallback => "claude",
        }
    }
}

pub async fn collect_agent_env_and_cli(
    agent_kind: &AgentKind,
    repo_path: &Path,
    db: &schaltwerk::schaltwerk_core::Database,
) -> (Vec<(String, String)>, String, AgentPreference) {
    let agent_str = match agent_kind {
        AgentKind::Claude => "claude",
        AgentKind::Codex => "codex",
        AgentKind::OpenCode => "opencode",
        AgentKind::Gemini => "gemini",
        AgentKind::Amp => "amp",
        AgentKind::Droid => "droid",
        AgentKind::Fallback => "claude",
    };

    let (env_vars, cli_args, preferences) = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let mgr = settings_manager.lock().await;
        let mut env = mgr
            .get_agent_env_vars(agent_str)
            .into_iter()
            .collect::<Vec<_>>();
        if let Ok(project_env) = db.get_project_environment_variables(repo_path) {
            env.extend(project_env.into_iter());
        }
        (
            env,
            mgr.get_agent_cli_args(agent_str),
            mgr.get_agent_preferences(agent_str),
        )
    } else {
        (vec![], String::new(), AgentPreference::default())
    };

    (env_vars, cli_args, preferences)
}

fn harness_manages_codex_sandbox() -> bool {
    std::env::var_os("SCHALTWERK_SESSION").is_some()
}

fn strip_codex_sandbox_overrides(args: &mut Vec<String>) -> Option<Vec<String>> {
    let mut removed = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if let Some(value) = args[i].strip_prefix("--sandbox=") {
            removed.push(format!("--sandbox={value}"));
            args.remove(i);
            continue;
        }

        if args[i] == "--sandbox" {
            args.remove(i);
            let value = if i < args.len() {
                let next = &args[i];
                if next.starts_with('-') {
                    None
                } else {
                    Some(args.remove(i))
                }
            } else {
                None
            };

            match value {
                Some(v) => removed.push(format!("--sandbox {v}")),
                None => removed.push("--sandbox".to_string()),
            }
            continue;
        }

        i += 1;
    }

    if removed.is_empty() {
        None
    } else {
        Some(removed)
    }
}

pub fn build_final_args(
    agent_kind: &AgentKind,
    mut parsed_agent_args: Vec<String>,
    cli_args_text: &str,
    preferences: &AgentPreference,
) -> Vec<String> {
    let mut additional = if cli_args_text.trim().is_empty() {
        Vec::new()
    } else {
        let normalized = normalize_cli_text(cli_args_text);
        shell_words::split(&normalized).unwrap_or_else(|_| vec![cli_args_text.to_string()])
    };

    apply_agent_preferences(agent_kind, &parsed_agent_args, &mut additional, preferences);

    match agent_kind {
        AgentKind::Codex => {
            // Preserve any trailing prompt from parsed args, then enforce flag normalization and order
            let extracted_prompt = extract_codex_prompt_if_present(&mut parsed_agent_args);
            fix_codex_single_dash_long_flags(&mut additional);
            reorder_codex_model_after_profile(&mut additional);
            if harness_manages_codex_sandbox()
                && let Some(removed) = strip_codex_sandbox_overrides(&mut additional)
            {
                let removed_joined = removed.join(", ");
                log::warn!(
                    "Ignoring Codex CLI sandbox override because Schaltwerk manages sandbox mode: {removed_joined}"
                );
            }
            parsed_agent_args.extend(additional);
            if let Some(p) = extracted_prompt {
                parsed_agent_args.push(p);
            }
            parsed_agent_args
        }
        _ => {
            parsed_agent_args.extend(additional);
            parsed_agent_args
        }
    }
}

fn apply_agent_preferences(
    agent_kind: &AgentKind,
    existing_args: &[String],
    additional_args: &mut Vec<String>,
    preferences: &AgentPreference,
) {
    if matches!(agent_kind, AgentKind::Codex) {
        match preferences
            .model
            .as_ref()
            .map(|m| m.trim())
            .filter(|m| !m.is_empty())
        {
            Some(model) if !has_flag(existing_args, additional_args, &["--model", "-m"]) => {
                additional_args.push("--model".to_string());
                additional_args.push(model.to_string());
            }
            _ => {}
        }

        match preferences
            .reasoning_effort
            .as_ref()
            .map(|r| r.trim())
            .filter(|r| !r.is_empty())
        {
            Some(reasoning)
                if !has_config_override(
                    existing_args,
                    additional_args,
                    "model_reasoning_effort",
                ) =>
            {
                additional_args.push("-c".to_string());
                additional_args.push(format!(r#"model_reasoning_effort="{reasoning}""#));
            }
            _ => {}
        }
    }
}

fn has_flag(existing_args: &[String], additional_args: &[String], names: &[&str]) -> bool {
    let mut combined: Vec<&String> =
        Vec::with_capacity(existing_args.len() + additional_args.len());
    combined.extend(existing_args.iter());
    combined.extend(additional_args.iter());

    for token in combined {
        for name in names {
            if token == name {
                return true;
            }
            if name.starts_with("--") && token.starts_with(&format!("{name}=")) {
                return true;
            }
            if name.starts_with('-')
                && name.len() == 2
                && token.starts_with(name)
                && token.len() > name.len()
            {
                return true;
            }
        }
    }

    false
}

fn has_config_override(existing_args: &[String], additional_args: &[String], key: &str) -> bool {
    let mut iter = existing_args
        .iter()
        .chain(additional_args.iter())
        .peekable();

    while let Some(token) = iter.next() {
        let token_str = token.as_str();

        if (matches!(token_str, "-c" | "--config")
            && iter.next().is_some_and(|value| value.contains(key)))
            || ((token_str.starts_with("--config=") || token_str.starts_with("-c="))
                && token_str.contains(key))
        {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    struct EnvVarGuard {
        key: &'static str,
        original: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &str) -> Self {
            use schaltwerk::utils::env_adapter::EnvAdapter;
            let original = std::env::var(key).ok();
            EnvAdapter::set_var(key, value);
            Self { key, original }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            use schaltwerk::utils::env_adapter::EnvAdapter;
            if let Some(ref original) = self.original {
                EnvAdapter::set_var(self.key, original);
            } else {
                EnvAdapter::remove_var(self.key);
            }
        }
    }

    #[test]
    fn test_infer_agent_kind() {
        assert!(matches!(infer_agent_kind("claude"), AgentKind::Claude));
        assert!(matches!(
            infer_agent_kind("/usr/bin/claude"),
            AgentKind::Claude
        ));
        assert!(matches!(infer_agent_kind("codex"), AgentKind::Codex));
        assert!(matches!(
            infer_agent_kind("something-opencode"),
            AgentKind::OpenCode
        ));
        assert!(matches!(
            infer_agent_kind("gcloud-gemini"),
            AgentKind::Gemini
        ));
        assert!(matches!(infer_agent_kind("amp"), AgentKind::Amp));
        assert!(matches!(
            infer_agent_kind("/opt/homebrew/bin/amp"),
            AgentKind::Amp
        ));
        assert!(matches!(infer_agent_kind("droid"), AgentKind::Droid));
        assert!(matches!(
            infer_agent_kind("/Users/test/.local/bin/droid"),
            AgentKind::Droid
        ));
        assert!(matches!(infer_agent_kind("unknown"), AgentKind::Fallback));
    }

    #[test]
    fn test_build_final_args_non_codex() {
        let args = build_final_args(
            &AgentKind::Claude,
            vec!["--flag".into()],
            "--extra one",
            &AgentPreference::default(),
        );
        assert_eq!(args, vec!["--flag", "--extra", "one"]);
    }

    #[test]
    fn test_build_final_args_codex_order() {
        let args = build_final_args(
            &AgentKind::Codex,
            vec!["--sandbox".into(), "workspace-write".into()],
            "-profile work --model gpt-4",
            &AgentPreference::default(),
        );
        // single-dash long flag fixed and model after profile
        assert_eq!(
            args,
            vec![
                "--sandbox",
                "workspace-write",
                "--profile",
                "work",
                "--model",
                "gpt-4"
            ]
        );
    }

    #[test]
    fn test_manifest_key_mapping() {
        assert_eq!(AgentKind::Claude.manifest_key(), "claude");
        assert_eq!(AgentKind::Codex.manifest_key(), "codex");
        assert_eq!(AgentKind::OpenCode.manifest_key(), "opencode");
        assert_eq!(AgentKind::Gemini.manifest_key(), "gemini");
        assert_eq!(AgentKind::Amp.manifest_key(), "amp");
        assert_eq!(AgentKind::Droid.manifest_key(), "droid");
        assert_eq!(AgentKind::Fallback.manifest_key(), "claude");
    }

    #[test]
    #[serial]
    fn codex_harness_strips_duplicate_sandbox_flag() {
        let _guard = EnvVarGuard::set("SCHALTWERK_SESSION", "session-123");
        let args = build_final_args(
            &AgentKind::Codex,
            vec!["--sandbox".into(), "workspace-write".into()],
            "--sandbox danger-full-access --model gpt-4",
            &AgentPreference::default(),
        );

        assert_eq!(
            args,
            vec!["--sandbox", "workspace-write", "--model", "gpt-4"]
        );
    }

    #[test]
    #[serial]
    fn codex_harness_strips_duplicate_sandbox_flag_equals_form() {
        let _guard = EnvVarGuard::set("SCHALTWERK_SESSION", "session-abc");
        let args = build_final_args(
            &AgentKind::Codex,
            vec!["--sandbox".into(), "workspace-write".into()],
            "--sandbox=danger-full-access --profile work",
            &AgentPreference::default(),
        );

        assert_eq!(
            args,
            vec!["--sandbox", "workspace-write", "--profile", "work"]
        );
    }

    #[test]
    fn codex_appends_preferences_when_missing() {
        let prefs = AgentPreference {
            model: Some("o4-mini".to_string()),
            reasoning_effort: Some("high".to_string()),
        };

        let args = build_final_args(
            &AgentKind::Codex,
            vec!["--sandbox".into(), "workspace-write".into()],
            "",
            &prefs,
        );

        assert_eq!(
            args,
            vec![
                "--sandbox",
                "workspace-write",
                "--model",
                "o4-mini",
                "-c",
                r#"model_reasoning_effort="high""#,
            ]
        );
    }

    #[test]
    fn codex_preferences_do_not_duplicate_existing_flags() {
        let prefs = AgentPreference {
            model: Some("o4-mini".to_string()),
            reasoning_effort: Some("medium".to_string()),
        };

        let args = build_final_args(
            &AgentKind::Codex,
            vec![
                "--sandbox".into(),
                "workspace-write".into(),
                "--model".into(),
                "custom".into(),
            ],
            "-c model_reasoning_effort=\"low\"",
            &prefs,
        );

        assert_eq!(
            args,
            vec![
                "--sandbox",
                "workspace-write",
                "--model",
                "custom",
                "-c",
                "model_reasoning_effort=low"
            ]
        );
    }

    #[test]
    fn has_flag_detects_existing_flags_and_aliases() {
        let existing = vec!["--model".to_string(), "gpt-5".to_string()];
        assert!(has_flag(&existing, &[], &["--model", "-m"]));

        let existing_inline = vec!["--model=gpt-5".to_string()];
        assert!(has_flag(&existing_inline, &[], &["--model"]));

        let short_packed = vec!["-msomething".to_string()];
        assert!(has_flag(&short_packed, &[], &["-m"]));

        let additional = vec!["--config".to_string(), "search=true".to_string()];
        assert!(!has_flag(&existing, &additional, &["--profile"]));

        let additional_profile = vec!["--profile".to_string(), "team".to_string()];
        assert!(has_flag(&[], &additional_profile, &["--profile"]));
    }

    #[test]
    fn has_config_override_detects_various_config_forms() {
        let existing = vec!["-c".to_string(), "model_reasoning_effort=high".to_string()];
        assert!(has_config_override(
            &existing,
            &[],
            "model_reasoning_effort"
        ));

        let packed = vec!["--config=model_reasoning_effort=medium".to_string()];
        assert!(has_config_override(&[], &packed, "model_reasoning_effort"));

        let unrelated = vec!["-c".to_string(), "search=true".to_string()];
        assert!(!has_config_override(
            &[],
            &unrelated,
            "model_reasoning_effort"
        ));
    }

    #[test]
    #[serial]
    fn codex_standalone_keeps_duplicate_sandbox_flag() {
        use schaltwerk::utils::env_adapter::EnvAdapter;
        EnvAdapter::remove_var("SCHALTWERK_SESSION");
        let args = build_final_args(
            &AgentKind::Codex,
            vec!["--sandbox".into(), "workspace-write".into()],
            "--sandbox danger-full-access",
            &AgentPreference::default(),
        );

        assert_eq!(
            args,
            vec![
                "--sandbox",
                "workspace-write",
                "--sandbox",
                "danger-full-access"
            ]
        );
    }
}
