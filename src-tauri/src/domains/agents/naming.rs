use crate::{
    domains::git,
    infrastructure::database::{
        DEFAULT_BRANCH_PREFIX, Database, db_project_config::ProjectConfigMethods,
        db_specs::SpecMethods,
    },
    shared::format_branch_name,
    shared::session_metadata_gateway::SessionMetadataGateway,
};

use anyhow::{Result, anyhow};
use std::path::Path;
use tokio::process::Command;

pub struct SessionRenameContext<'a> {
    pub db: &'a Database,
    pub session_id: &'a str,
    pub worktree_path: &'a Path,
    pub repo_path: &'a Path,
    pub current_branch: &'a str,
    pub agent_type: &'a str,
    pub initial_prompt: Option<&'a str>,
    pub cli_args: Option<String>,
    pub env_vars: Vec<(String, String)>,
    pub binary_path: Option<String>,
}

pub struct NameGenerationArgs<'a> {
    pub db: &'a Database,
    pub target_id: &'a str,
    pub worktree_path: &'a Path,
    pub agent_type: &'a str,
    pub initial_prompt: Option<&'a str>,
    pub cli_args: Option<&'a str>,
    pub env_vars: &'a [(String, String)],
    pub binary_path: Option<&'a str>,
}

pub fn truncate_prompt(prompt: &str) -> String {
    let first_lines: String = prompt.lines().take(4).collect::<Vec<_>>().join(
        "
",
    );
    if first_lines.len() > 400 {
        first_lines.chars().take(400).collect::<String>()
    } else {
        first_lines
    }
}

pub fn sanitize_name(input: &str) -> String {
    let mut s: String = input
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let mut collapsed = String::with_capacity(s.len());
    let mut prev_hyphen = false;
    for ch in s.drain(..) {
        if ch == '-' {
            if !prev_hyphen {
                collapsed.push('-');
            }
            prev_hyphen = true;
        } else {
            collapsed.push(ch);
            prev_hyphen = false;
        }
    }
    let trimmed = collapsed.trim_matches('-').to_string();
    // Limit to 30 characters max (was 50)
    trimmed.chars().take(30).collect()
}

fn ansi_strip(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{001b}' {
            if chars.peek() == Some(&'[') {
                let _ = chars.next();
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() || c == '~' {
                        break;
                    }
                }
            }
            continue;
        } else {
            out.push(ch);
        }
    }
    out
}

pub async fn generate_display_name_and_rename_branch(
    ctx: SessionRenameContext<'_>,
) -> Result<Option<String>> {
    let SessionRenameContext {
        db,
        session_id,
        worktree_path,
        repo_path,
        current_branch,
        agent_type,
        initial_prompt,
        cli_args,
        env_vars,
        binary_path,
    } = ctx;

    let args = NameGenerationArgs {
        db,
        target_id: session_id,
        worktree_path,
        agent_type,
        initial_prompt,
        cli_args: cli_args.as_deref(),
        env_vars: &env_vars,
        binary_path: binary_path.as_deref(),
    };

    let result = generate_display_name_core(args, move |db, name| {
        SessionMetadataGateway::new(db).update_session_display_name(session_id, name)
    })
    .await?;

    if let Some(ref new_name) = result {
        let branch_prefix = db
            .get_project_branch_prefix(repo_path)
            .unwrap_or_else(|err| {
                log::warn!("Falling back to default branch prefix during agent rename: {err}");
                DEFAULT_BRANCH_PREFIX.to_string()
            });
        let new_branch = format_branch_name(&branch_prefix, new_name);

        if current_branch != new_branch {
            log::info!("Renaming branch from '{current_branch}' to '{new_branch}'");

            match git::rename_branch(repo_path, current_branch, &new_branch) {
                Ok(()) => {
                    log::info!("Successfully renamed branch to '{new_branch}'");

                    match git::update_worktree_branch(worktree_path, &new_branch) {
                        Ok(()) => {
                            log::info!(
                                "Successfully updated worktree to use branch '{new_branch}'"
                            );

                            if let Err(e) = SessionMetadataGateway::new(db)
                                .update_session_branch(session_id, &new_branch)
                            {
                                log::error!("Failed to update branch name in database: {e}");
                            }
                        }
                        Err(e) => {
                            log::error!(
                                "Failed to update worktree to new branch '{new_branch}': {e}"
                            );
                            if let Err(revert_err) =
                                git::rename_branch(repo_path, &new_branch, current_branch)
                            {
                                log::error!("Failed to revert branch rename: {revert_err}");
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!(
                        "Could not rename branch from '{current_branch}' to '{new_branch}': {e}"
                    );
                }
            }
        }
    }

    Ok(result)
}

async fn generate_display_name_core<F>(
    args: NameGenerationArgs<'_>,
    mut apply_display_name: F,
) -> Result<Option<String>>
where
    F: FnMut(&Database, &str) -> Result<()>,
{
    let NameGenerationArgs {
        db,
        target_id,
        worktree_path: _,
        agent_type,
        initial_prompt,
        cli_args,
        env_vars,
        binary_path,
    } = args;

    log::info!(
        "generate_display_name called: session_id={}, agent_type={}, prompt={:?}",
        target_id,
        agent_type,
        initial_prompt.map(truncate_prompt)
    );

    if let Some(prompt) = initial_prompt {
        if prompt.trim().is_empty() {
            log::info!("Skipping name generation for session '{target_id}' - empty prompt");
            return Ok(None);
        }
    } else {
        log::info!("Skipping name generation for session '{target_id}' - no prompt provided");
        return Ok(None);
    }

    let base_prompt = initial_prompt.unwrap();
    let truncated = truncate_prompt(base_prompt);
    log::debug!("Truncated prompt for name generation: {truncated}");

    let prompt_plain = format!(
        r#"IMPORTANT: Do not use any tools. Answer this message directly without searching or reading files.

Generate a SHORT kebab-case name for this coding task.

Rules:
- 2-4 words, prefer verb-noun format (e.g., fix-login, add-dark-mode)
- 20 characters or less preferred
- Use only lowercase letters, numbers, hyphens
- Capture WHAT is being done, not HOW
- Return ONLY the name, nothing else
- Do NOT use tools or commands

Good examples:
- "fix-pr-links" (for fixing pull request link behavior)
- "add-dark-mode" (for implementing dark mode theme)
- "refactor-auth" (for refactoring authentication)
- "update-nav-bar" (for changing navigation layout)

Bad examples:
- "implement-the-new-user-authentication-system" (too long)
- "session-1" (too generic)
- "claude-task" (describes the agent, not the task)

Task: {truncated}

Name:"#
    );

    let prompt_json = format!(
        r#"IMPORTANT: Do not use any tools. Answer this message directly without searching or reading files.

Generate a SHORT kebab-case name for this coding task.

Rules:
- 2-4 words, prefer verb-noun format (e.g., fix-login, add-dark-mode)
- 20 characters or less preferred
- Use only lowercase letters, numbers, hyphens
- Capture WHAT is being done, not HOW
- Return ONLY JSON format: {{"name": "kebab-case-name"}}
- Do NOT use tools or commands

Good examples:
- {{"name": "fix-pr-links"}} (for fixing pull request link behavior)
- {{"name": "add-dark-mode"}} (for implementing dark mode theme)
- {{"name": "refactor-auth"}} (for refactoring authentication)
- {{"name": "update-nav-bar"}} (for changing navigation layout)

Bad examples:
- "implement-the-new-user-authentication-system" (too long)
- "session-1" (too generic)
- "claude-task" (describes the agent, not the task)

Task: {truncated}

Respond with JSON: {{"name": "short-kebab-case-name"}}"#
    );

    let temp_base = std::env::temp_dir();
    let unique_temp_dir = temp_base.join(format!("schaltwerk_namegen_{target_id}"));

    if let Err(e) = std::fs::create_dir_all(&unique_temp_dir) {
        log::warn!("Failed to create temp directory for name generation: {e}");
    }

    if agent_type == "opencode" || agent_type == "kilocode" {
        if let Err(e) = std::process::Command::new("git")
            .args(["init"])
            .current_dir(&unique_temp_dir)
            .output()
        {
            log::debug!("Failed to init git in temp dir (non-fatal): {e}");
        }

        let readme_path = unique_temp_dir.join("README.md");
        if let Err(e) = std::fs::write(
            &readme_path,
            "# Temporary workspace for name generation
",
        ) {
            log::debug!("Failed to create README in temp dir (non-fatal): {e}");
        }
    }

    let run_dir = unique_temp_dir.clone();
    log::info!(
        "Using temp directory for name generation: {}",
        run_dir.display()
    );

    if agent_type == "codex" {
        log::info!("Attempting to generate name with codex");
        let mut args: Vec<String> = vec![
            "exec".into(),
            "--sandbox".into(),
            "workspace-write".into(),
            "--skip-git-repo-check".into(),
            "--json".into(),
        ];
        if let Some(cli) = cli_args {
            let mut extra = shell_words::split(cli).unwrap_or_else(|_| vec![cli.to_string()]);
            fix_codex_single_dash_long_flags(&mut extra);
            reorder_codex_model_after_profile(&mut extra);
            extra.retain(|a| a != "--search" && a != "-search");
            args.extend(extra);
        }
        let tmp_file = std::env::temp_dir().join(format!("schaltwerk_codex_name_{target_id}.txt"));
        args.push("--output-last-message".into());
        args.push(tmp_file.to_string_lossy().to_string());
        args.push(prompt_plain.clone());

        log::info!("codex exec args for namegen: {args:?}");
        let output = Command::new("codex")
            .args(&args)
            .current_dir(&run_dir)
            .env("NO_COLOR", "1")
            .env("CLICOLOR", "0")
            .env("TERM", "dumb")
            .env("CI", "1")
            .env("NONINTERACTIVE", "1")
            .stdin(std::process::Stdio::null())
            .envs(env_vars.iter().cloned())
            .output()
            .await;

        let output = match output {
            Ok(output) => output,
            Err(e) => {
                log::warn!("Failed to execute codex for name generation: {e}");
                return Ok(None);
            }
        };

        if output.status.success() {
            let candidate = std::fs::read_to_string(&tmp_file)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
                    log::debug!("codex stdout: {stdout}");
                    stdout
                        .lines()
                        .map(|l| l.trim())
                        .find(|line| {
                            !line.is_empty()
                                && !line.contains(' ')
                                && line.chars().all(|c| {
                                    c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit()
                                })
                                && line.len() <= 30
                        })
                        .map(|s| s.to_string())
                        .or_else(|| {
                            let raw = stdout.trim();
                            if !raw.is_empty() {
                                Some(raw.to_string())
                            } else {
                                None
                            }
                        })
                });

            if let Some(result) = candidate {
                log::info!("codex returned name candidate: {result}");
                let name = sanitize_name(&result);
                log::info!("Sanitized name: {name}");
                if !name.is_empty() {
                    apply_display_name(db, &name)?;
                    log::info!(
                        "Updated database with display_name '{name}' for session_id '{target_id}'"
                    );
                    let _ = std::fs::remove_dir_all(&unique_temp_dir);
                    return Ok(Some(name));
                }
            } else {
                log::warn!("codex produced no usable output for naming");
            }
        } else {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            log::warn!(
                "codex returned non-zero exit status: code={code}, stderr='{}', stdout='{}'",
                stderr.trim(),
                stdout.trim()
            );
        }
        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }

    if agent_type == "opencode" {
        log::info!("Attempting to generate name with opencode");

        let binary = super::opencode::resolve_opencode_binary();
        let mut command = Command::new(&binary);
        command.args(["run", &prompt_json]);
        command.current_dir(&run_dir);
        command.stdin(std::process::Stdio::null());
        for (key, value) in build_namegen_env(env_vars) {
            command.env(key, value);
        }

        let output = command.output().await;

        let output = match output {
            Ok(output) => {
                log::debug!("opencode executed successfully");
                output
            }
            Err(e) => {
                log::warn!("Failed to execute opencode: {e}");
                return Ok(None);
            }
        };

        if output.status.success() {
            let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
            log::debug!("opencode stdout: {stdout}");

            let candidate = parse_opencode_output(&stdout);

            if let Some(result) = candidate {
                log::info!("opencode returned name candidate: {result}");
                let name = sanitize_name(&result);
                log::info!("Sanitized name: {name}");

                if !name.is_empty() {
                    apply_display_name(db, &name)?;
                    log::info!(
                        "Updated database with display_name '{name}' for session_id '{target_id}'"
                    );
                    let _ = std::fs::remove_dir_all(&unique_temp_dir);
                    return Ok(Some(name));
                }
            } else {
                log::warn!("opencode produced no usable output for naming");
            }
        } else {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            log::warn!(
                "opencode returned non-zero exit status: code={code}, stderr='{}', stdout='{}'",
                stderr.trim(),
                stdout.trim()
            );
        }

        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }

    if agent_type == "kilocode" {
        log::info!("Attempting to generate name with kilocode");

        let binary = "kilocode".to_string();
        let mut command = Command::new(&binary);
        command.args(["run", &prompt_json]);
        command.current_dir(&run_dir);
        command.stdin(std::process::Stdio::null());
        for (key, value) in build_namegen_env(env_vars) {
            command.env(key, value);
        }

        let output = command.output().await;

        let output = match output {
            Ok(output) => {
                log::debug!("kilocode executed successfully");
                output
            }
            Err(e) => {
                log::warn!("Failed to execute kilocode: {e}");
                return Ok(None);
            }
        };

        if output.status.success() {
            let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
            log::debug!("kilocode stdout: {stdout}");

            let candidate = parse_opencode_output(&stdout);

            if let Some(result) = candidate {
                log::info!("kilocode returned name candidate: {result}");
                let name = sanitize_name(&result);
                log::info!("Sanitized name: {name}");

                if !name.is_empty() {
                    apply_display_name(db, &name)?;
                    log::info!(
                        "Updated database with display_name '{name}' for session_id '{target_id}'"
                    );
                    let _ = std::fs::remove_dir_all(&unique_temp_dir);
                    return Ok(Some(name));
                }
            } else {
                log::warn!("kilocode produced no usable output for naming");
            }
        } else {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            log::warn!(
                "kilocode returned non-zero exit status: code={code}, stderr='{}', stdout='{}'",
                stderr.trim(),
                stdout.trim()
            );
        }

        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }

    if agent_type == "gemini" {
        log::info!("Attempting to generate name with gemini");

        let binary = super::gemini::resolve_gemini_binary();
        let mut command = Command::new(&binary);
        command.args(["--prompt", prompt_plain.as_str()]);
        command.current_dir(&run_dir);
        command.stdin(std::process::Stdio::null());
        for (key, value) in build_namegen_env(env_vars) {
            command.env(key, value);
        }

        let output = command.output().await;

        let output = match output {
            Ok(output) => {
                log::debug!("gemini executed successfully");
                output
            }
            Err(e) => {
                log::warn!("Failed to execute gemini: {e}");
                return Ok(None);
            }
        };

        if output.status.success() {
            let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
            log::debug!("gemini stdout: {stdout}");

            let candidate = stdout
                .lines()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty())
                .filter(|line| {
                    line.chars()
                        .all(|c| c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit())
                })
                .filter(|line| line.contains('-') || line.len() <= 10)
                .filter(|line| line.len() <= 30)
                .find(|_| true)
                .map(|s| s.to_string());

            if let Some(result) = candidate {
                log::info!("gemini returned name candidate: {result}");
                let name = sanitize_name(&result);
                log::info!("Sanitized name: {name}");

                if !name.is_empty() {
                    apply_display_name(db, &name)?;
                    log::info!(
                        "Updated database with display_name '{name}' for session_id '{target_id}'"
                    );
                    let _ = std::fs::remove_dir_all(&unique_temp_dir);
                    return Ok(Some(name));
                }
            } else {
                log::warn!("gemini produced no usable output for naming");
            }
        } else {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            log::warn!(
                "gemini returned non-zero exit status: code={code}, stderr='{}', stdout='{}'",
                stderr.trim(),
                stdout.trim()
            );
        }

        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }

    if agent_type != "claude" {
        log::info!("Agent type is '{agent_type}', not generating name with claude");
        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }

    log::info!("Attempting to generate name with claude");
    let claude_args = build_claude_namegen_args(&prompt_plain, cli_args);
    let binary = binary_path
        .map(|s| s.to_string())
        .unwrap_or_else(super::claude::resolve_claude_binary);
    log::debug!("Claude namegen using binary: {binary}");
    let mut command = Command::new(binary);
    command.args(&claude_args);
    command.current_dir(&run_dir);
    command.stdin(std::process::Stdio::null());

    for (key, value) in build_namegen_env(env_vars) {
        command.env(key, value);
    }

    let output = command.output().await;

    let output = match output {
        Ok(output) => {
            log::debug!("claude executed successfully");
            output
        }
        Err(e) => {
            log::error!("Failed to execute claude: {e}");
            return Err(anyhow!("Failed to execute claude: {e}"));
        }
    };

    if output.status.success() {
        let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
        log::debug!("claude stdout: {stdout}");

        let parsed_json: Result<serde_json::Value, _> = serde_json::from_str(&stdout);
        let candidate = if let Ok(v) = parsed_json {
            v.as_str()
                .or_else(|| v.get("result").and_then(|x| x.as_str()))
                .map(|s| s.to_string())
        } else {
            None
        }
        .or_else(|| {
            let raw = stdout.trim();
            if !raw.is_empty() {
                Some(raw.to_string())
            } else {
                None
            }
        });

        if let Some(result) = candidate {
            log::info!("claude returned name candidate: {result}");
            let name = sanitize_name(&result);
            log::info!("Sanitized name: {name}");

            if !name.is_empty() {
                apply_display_name(db, &name)?;
                log::info!(
                    "Updated database with display_name '{name}' for session_id '{target_id}'"
                );
                let _ = std::fs::remove_dir_all(&unique_temp_dir);
                return Ok(Some(name));
            } else {
                log::warn!("Sanitized name is empty");
            }
        } else {
            log::warn!("Claude produced no usable output for naming");
        }
    } else {
        let code = output.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        log::warn!(
            "claude returned non-zero exit status: code={code}, stderr='{}', stdout='{}'",
            stderr.trim(),
            stdout.trim()
        );
    }

    log::warn!("No name could be generated for session_id '{target_id}'");
    let _ = std::fs::remove_dir_all(&unique_temp_dir);
    Ok(None)
}

pub async fn generate_display_name(args: NameGenerationArgs<'_>) -> Result<Option<String>> {
    let session_gateway = SessionMetadataGateway::new(args.db);
    let target_id = args.target_id;
    generate_display_name_core(args, move |_, name| {
        session_gateway.update_session_display_name(target_id, name)
    })
    .await
}

pub async fn generate_spec_display_name(args: NameGenerationArgs<'_>) -> Result<Option<String>> {
    let target_id = args.target_id;
    generate_display_name_core(args, move |db, name| {
        db.update_spec_display_name(target_id, name)
    })
    .await
}

fn build_claude_namegen_args(prompt_plain: &str, cli_args: Option<&str>) -> Vec<String> {
    let mut user_args: Vec<String> = Vec::new();

    if let Some(raw) = cli_args {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            user_args = shell_words::split(trimmed).unwrap_or_else(|_| vec![trimmed.to_string()]);
        }
    }

    let mut has_output_format_override = false;

    for token in &user_args {
        let token_str = token.as_str();
        if token_str == "--output-format" || token_str.starts_with("--output-format=") {
            has_output_format_override = true;
        }
    }

    let mut args = user_args;
    args.push("--print".to_string());
    args.push(prompt_plain.to_string());

    if !has_output_format_override {
        args.push("--output-format".to_string());
        args.push("json".to_string());
    }

    args
}

pub fn parse_opencode_output(stdout: &str) -> Option<String> {
    // Try JSON first, then fallback to raw text
    let parsed_json: Result<serde_json::Value, _> = serde_json::from_str(stdout);
    if let Ok(v) = parsed_json {
        v.as_str()
            .or_else(|| v.get("name").and_then(|x| x.as_str()))
            .map(|s| s.to_string())
    } else {
        None
    }
    .or_else(|| {
        // Fallback to plain text parsing for backward compatibility
        stdout
            .lines()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .filter(|line| !line.contains(' ')) // No spaces
            .filter(|line| {
                line.chars()
                    .all(|c| c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit())
            })
            .filter(|line| line.len() <= 30) // Reasonable length
            .find(|_| true) // Get first match
            .map(|s| s.to_string())
            .or_else(|| {
                // Final fallback: if no strict pattern match, use the raw output
                let raw = stdout.trim();
                if !raw.is_empty() {
                    Some(raw.to_string())
                } else {
                    None
                }
            })
    })
}

fn build_namegen_env(env_vars: &[(String, String)]) -> Vec<(String, String)> {
    let mut combined = vec![
        ("NO_COLOR".to_string(), "1".to_string()),
        ("CLICOLOR".to_string(), "0".to_string()),
        ("TERM".to_string(), "dumb".to_string()),
        ("CI".to_string(), "1".to_string()),
        ("NONINTERACTIVE".to_string(), "1".to_string()),
    ];

    combined.extend(env_vars.iter().cloned());

    combined
}

// Codex helpers (keep in sync with schaltwerk_core)
// NOTE: These functions are duplicated here because the naming module needs to apply
// the same Codex-specific flag normalization when invoking Codex for name generation.
// Any changes to these functions should be synchronized with the versions in schaltwerk_core.rs
fn fix_codex_single_dash_long_flags(args: &mut [String]) {
    for a in args.iter_mut() {
        if a.starts_with("--") {
            continue;
        }
        if let Some(stripped) = a.strip_prefix('-') {
            if stripped.len() == 1 {
                continue;
            }
            let (name, value_opt) = match stripped.split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (stripped, None),
            };
            if name == "model" || name == "profile" {
                if let Some(v) = value_opt {
                    *a = format!("--{name}={v}");
                } else {
                    *a = format!("--{name}");
                }
            }
        }
    }
}

fn reorder_codex_model_after_profile(args: &mut Vec<String>) {
    let mut without_model = Vec::with_capacity(args.len());
    let mut model_flags = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "--model" || a == "-m" {
            model_flags.push(a.clone());
            if i + 1 < args.len() {
                model_flags.push(args[i + 1].clone());
                i += 2;
            } else {
                i += 1;
            }
        } else if a.starts_with("--model=") || a.starts_with("-m=") {
            model_flags.push(a.clone());
            i += 1;
        } else {
            without_model.push(a.clone());
            i += 1;
        }
    }
    without_model.extend(model_flags);
    *args = without_model;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::time::timeout;

    #[test]
    fn test_parse_opencode_json() {
        let input = r#"{"name": "test-name"}"#;
        let result = parse_opencode_output(input);
        assert_eq!(result, Some("test-name".to_string()));
    }

    #[test]
    fn test_parse_opencode_plain() {
        let input = "auth-system\nother";
        let result = parse_opencode_output(input);
        assert_eq!(result, Some("auth-system".to_string()));
    }

    #[test]
    fn test_parse_opencode_no_match() {
        let input = "No kebab";
        let result = parse_opencode_output(input);
        assert_eq!(result, Some("No kebab".to_string()));
    }

    #[test]
    fn test_sanitize_name() {
        assert_eq!(sanitize_name("Hello World!"), "hello-world");
        assert_eq!(sanitize_name("implement-user-auth"), "implement-user-auth");
        assert_eq!(sanitize_name("build-todo-app"), "build-todo-app");
        assert_eq!(sanitize_name("API Docs & Tests"), "api-docs-tests");
        assert_eq!(sanitize_name("--multiple--hyphens--"), "multiple-hyphens");

        // Test length limit
        let long_name = "this-is-a-very-long-name-that-exceeds-thirty-characters";
        assert!(sanitize_name(long_name).len() <= 30);
    }

    #[test]
    fn test_sanitize_name_edge_cases() {
        // Test various edge cases
        assert_eq!(sanitize_name(""), "");
        assert_eq!(sanitize_name("---"), "");
        assert_eq!(sanitize_name("123-numbers"), "123-numbers");
        assert_eq!(sanitize_name("UPPERCASE"), "uppercase");
        assert_eq!(sanitize_name("Special!@#$%^&*()Chars"), "special-chars");
        assert_eq!(sanitize_name("snake_case_to_kebab"), "snake-case-to-kebab");
        assert_eq!(sanitize_name("   spaces   around   "), "spaces-around");
        assert_eq!(sanitize_name("ümlaut-çhars"), "mlaut-hars"); // Non-ASCII removed
    }

    #[test]
    fn test_truncate_prompt() {
        let short_prompt = "Short agent";
        assert_eq!(truncate_prompt(short_prompt), "Short agent");

        let long_prompt = "This is a very long prompt that contains multiple lines
Second line here
Third line
Fourth line
Fifth line should be truncated";
        let result = truncate_prompt(long_prompt);
        assert!(result.lines().count() <= 4);
        assert!(result.len() <= 400);
    }

    #[test]
    fn test_truncate_prompt_edge_cases() {
        // Empty prompt
        assert_eq!(truncate_prompt(""), "");

        // Single very long line
        let long_line = "a".repeat(500);
        let result = truncate_prompt(&long_line);
        assert_eq!(result.len(), 400);

        // Exactly 4 lines
        let four_lines = "Line 1
Line 2
Line 3
Line 4";
        assert_eq!(truncate_prompt(four_lines), four_lines);

        // More than 4 lines
        let many_lines = "Line 1
Line 2
Line 3
Line 4
Line 5
Line 6";
        let result = truncate_prompt(many_lines);
        assert_eq!(
            result,
            "Line 1
Line 2
Line 3
Line 4"
        );
    }

    #[test]
    fn test_ansi_strip() {
        // Test ANSI escape sequences removal
        assert_eq!(ansi_strip("\x1b[31mRed Text\x1b[0m"), "Red Text");
        assert_eq!(ansi_strip("\x1b[1;32mBold Green\x1b[0m"), "Bold Green");
        assert_eq!(
            ansi_strip("Normal \x1b[33mYellow\x1b[0m Text"),
            "Normal Yellow Text"
        );
        assert_eq!(ansi_strip("\x1b[2J\x1b[H"), ""); // Clear screen codes
        assert_eq!(ansi_strip("No ANSI codes"), "No ANSI codes");
        assert_eq!(ansi_strip(""), "");

        // Complex sequences
        assert_eq!(
            ansi_strip("\x1b[38;5;196mExtended Color\x1b[0m"),
            "Extended Color"
        );
        assert_eq!(
            ansi_strip("\x1b[48;2;255;0;0mRGB Background\x1b[0m"),
            "RGB Background"
        );
    }

    #[test]
    fn test_fix_codex_single_dash_long_flags() {
        let mut v = vec![
            "-model=gpt-4o".to_string(),
            "-p".to_string(),
            "-profile=dev".to_string(),
        ];
        fix_codex_single_dash_long_flags(&mut v);
        assert!(v.contains(&"--model=gpt-4o".to_string()));
        assert!(v.contains(&"-p".to_string()));
        assert!(v.contains(&"--profile=dev".to_string()));
    }

    #[test]
    fn test_fix_codex_single_dash_long_flags_comprehensive() {
        // Test various flag formats
        let mut args = vec![
            "-model".to_string(),
            "gpt-4".to_string(),
            "-m".to_string(), // Should remain as short flag
            "sonnet".to_string(),
            "--model=claude".to_string(), // Already correct
            "-profile".to_string(),
            "work".to_string(),
            "-p".to_string(), // Should remain as short flag
            "dev".to_string(),
            "-v".to_string(),       // Other short flag
            "-verbose".to_string(), // Not a known long flag, should remain
        ];

        fix_codex_single_dash_long_flags(&mut args);

        assert_eq!(args[0], "--model");
        assert_eq!(args[1], "gpt-4");
        assert_eq!(args[2], "-m");
        assert_eq!(args[3], "sonnet");
        assert_eq!(args[4], "--model=claude");
        assert_eq!(args[5], "--profile");
        assert_eq!(args[6], "work");
        assert_eq!(args[7], "-p");
        assert_eq!(args[8], "dev");
        assert_eq!(args[9], "-v");
        assert_eq!(args[10], "-verbose"); // Unknown long flag unchanged
    }

    #[test]
    fn test_reorder_codex_model_after_profile() {
        let mut v = vec![
            "--model".to_string(),
            "gpt".to_string(),
            "--profile".to_string(),
            "work".to_string(),
        ];
        reorder_codex_model_after_profile(&mut v);
        // profile should come before model in final vector
        let pos_profile = v.iter().position(|x| x == "--profile").unwrap();
        let pos_model = v.iter().position(|x| x == "--model").unwrap();
        assert!(pos_profile < pos_model);
    }

    #[test]
    fn test_reorder_codex_model_after_profile_complex() {
        // Test with multiple model flags and mixed formats
        let mut args = vec![
            "--model".to_string(),
            "gpt-4".to_string(),
            "--other".to_string(),
            "-m".to_string(),
            "claude".to_string(),
            "--profile".to_string(),
            "work".to_string(),
            "--model=sonnet".to_string(),
            "--verbose".to_string(),
        ];

        reorder_codex_model_after_profile(&mut args);

        // Find positions
        let profile_pos = args.iter().position(|x| x == "--profile").unwrap();
        let first_model = args.iter().position(|x| x == "--model").unwrap();
        let short_model = args.iter().position(|x| x == "-m").unwrap();
        let equals_model = args.iter().position(|x| x.starts_with("--model=")).unwrap();

        // All model flags should come after profile
        assert!(profile_pos < first_model);
        assert!(profile_pos < short_model);
        assert!(profile_pos < equals_model);

        // Other flags should maintain relative order
        assert!(args.iter().position(|x| x == "--other").unwrap() < profile_pos);
        assert!(args.iter().position(|x| x == "--verbose").unwrap() < first_model);
    }

    #[test]
    fn test_reorder_codex_model_no_profile() {
        // Test when there's no profile flag
        let mut args = vec![
            "--model".to_string(),
            "gpt-4".to_string(),
            "--verbose".to_string(),
            "-m".to_string(),
            "claude".to_string(),
        ];

        let _original = args.clone();
        reorder_codex_model_after_profile(&mut args);

        // Model flags should be moved to the end
        assert_eq!(args[0], "--verbose");
        assert_eq!(args[1], "--model");
        assert_eq!(args[2], "gpt-4");
        assert_eq!(args[3], "-m");
        assert_eq!(args[4], "claude");
    }

    #[test]
    fn test_codex_args_with_custom_cli_model_profile() {
        // Simulate our assembly: sandbox + normalized CLI args + prompt
        let cli_args = "-m gpt-5 -p maibornwolff";
        let mut args: Vec<String> = vec!["--sandbox".into(), "workspace-write".into()];
        let mut extra = shell_words::split(cli_args).unwrap();
        fix_codex_single_dash_long_flags(&mut extra);
        reorder_codex_model_after_profile(&mut extra);
        args.extend(extra);
        args.push("name this agent".into());

        // Expect sandbox first, then profile before model, then prompt
        assert_eq!(args[0], "--sandbox");
        assert_eq!(args[1], "workspace-write");
        let p = args
            .iter()
            .position(|a| a == "-p" || a == "--profile")
            .unwrap();
        let m = args
            .iter()
            .position(|a| a == "-m" || a.starts_with("--model"))
            .unwrap();
        assert!(p < m);
        assert_eq!(args.last().unwrap(), "name this agent");
        // Values follow the short flags
        assert_eq!(args[p + 1], "maibornwolff");
        assert_eq!(args[m + 1], "gpt-5");
    }

    #[test]
    fn test_codex_exec_filters_search_flag() {
        // Simulate CLI args that include an interactive-only flag
        let cli_args = "--search --model gpt-4";
        let mut args: Vec<String> = vec![
            "exec".into(),
            "--sandbox".into(),
            "workspace-write".into(),
            "--json".into(),
        ];
        let mut extra = shell_words::split(cli_args).unwrap();
        fix_codex_single_dash_long_flags(&mut extra);
        reorder_codex_model_after_profile(&mut extra);
        extra.retain(|a| a != "--search" && a != "-search");
        args.extend(extra);
        // Ensure --search was filtered out for exec
        assert!(args.iter().all(|a| a != "--search" && a != "-search"));
        // Model should still be present
        assert!(
            args.contains(&"--model".to_string()) || args.iter().any(|a| a.starts_with("--model="))
        );
    }

    #[tokio::test]
    async fn test_generate_display_name_skips_empty_prompt() {
        use crate::infrastructure::database::Database;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(Some(temp_dir.path().join("test.db"))).unwrap();
        let worktree_path = temp_dir.path().join("worktree");

        fn build_args<'a>(
            db: &'a Database,
            worktree: &'a std::path::Path,
            prompt: Option<&'a str>,
        ) -> NameGenerationArgs<'a> {
            NameGenerationArgs {
                db,
                target_id: "test-session",
                worktree_path: worktree,
                agent_type: "claude",
                initial_prompt: prompt,
                cli_args: None,
                env_vars: &[],
                binary_path: None,
            }
        }

        let result = generate_display_name(build_args(&db, &worktree_path, None)).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_none());

        // Test with empty prompt
        let result = generate_display_name(build_args(&db, &worktree_path, Some(""))).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_none());

        // Test with whitespace-only prompt
        let result =
            generate_display_name(build_args(&db, &worktree_path, Some("   \n\t  "))).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_generate_display_name_timeout_simulation() {
        use crate::infrastructure::database::Database;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(Some(temp_dir.path().join("test.db"))).unwrap();
        let worktree_path = temp_dir.path().join("worktree");

        // Simulate timeout by using a non-existent agent
        let result = timeout(
            Duration::from_millis(100),
            generate_display_name(NameGenerationArgs {
                db: &db,
                target_id: "test-timeout",
                worktree_path: &worktree_path,
                agent_type: "non_existent_agent",
                initial_prompt: Some("Test prompt for timeout"),
                cli_args: None,
                env_vars: &[],
                binary_path: None,
            }),
        )
        .await;

        // Should either timeout or return None (agent not found)
        match result {
            Ok(Ok(None)) => {} // Agent not found
            Ok(Ok(Some(_))) => panic!("Should not generate name for non-existent agent"),
            Ok(Err(_)) => {} // Agent execution error
            Err(_) => {}     // Timeout
        }
    }

    #[tokio::test]
    async fn test_generate_display_name_handles_invalid_agent_output() {
        use crate::infrastructure::database::Database;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(Some(temp_dir.path().join("test.db"))).unwrap();
        let worktree_path = temp_dir.path().join("worktree");

        // Test with unsupported agent type
        let args = NameGenerationArgs {
            db: &db,
            target_id: "test-unsupported",
            worktree_path: &worktree_path,
            agent_type: "unsupported_agent_type",
            initial_prompt: Some("Test prompt"),
            cli_args: None,
            env_vars: &[],
            binary_path: None,
        };
        let result = generate_display_name(args).await;

        // Should return None for unsupported agent types
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_session_rename_context_creation() {
        use crate::infrastructure::database::Database;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(Some(temp_dir.path().join("test.db"))).unwrap();
        let worktree_path = temp_dir.path().join("worktree");
        let repo_path = temp_dir.path().join("repo");

        let ctx = SessionRenameContext {
            db: &db,
            session_id: "test-session",
            worktree_path: &worktree_path,
            repo_path: &repo_path,
            current_branch: "schaltwerk/old-name",
            agent_type: "claude",
            initial_prompt: Some("Test prompt"),
            cli_args: Some("--model sonnet".to_string()),
            env_vars: vec![("KEY".to_string(), "VALUE".to_string())],
            binary_path: Some("/usr/local/bin/claude".to_string()),
        };

        // Verify context fields are accessible
        assert_eq!(ctx.session_id, "test-session");
        assert_eq!(ctx.agent_type, "claude");
        assert_eq!(ctx.initial_prompt, Some("Test prompt"));
        assert_eq!(ctx.cli_args.as_deref(), Some("--model sonnet"));
        assert_eq!(ctx.env_vars.len(), 1);
        assert_eq!(ctx.binary_path.as_deref(), Some("/usr/local/bin/claude"));
    }

    #[test]
    fn test_claude_namegen_args_respect_cli_overrides() {
        let args = build_claude_namegen_args("prompt text", Some("--profile work --model opus"));

        assert!(args.len() >= 2);
        assert_eq!(args[0], "--profile");
        assert_eq!(args[1], "work");
        assert!(args.contains(&"opus".to_string()));

        let has_default_model = args
            .windows(2)
            .any(|pair| pair == ["--model".to_string(), "sonnet".to_string()]);
        assert!(!has_default_model);
    }

    #[test]
    fn test_namegen_env_allows_user_overrides() {
        let envs = build_namegen_env(&[("NO_COLOR".to_string(), "0".to_string())]);

        let no_color_entries: Vec<_> = envs
            .iter()
            .filter(|(k, _)| k == "NO_COLOR")
            .map(|(_, v)| v)
            .collect();

        assert_eq!(no_color_entries.last(), Some(&&"0".to_string()));
        assert!(envs.iter().any(|(k, _)| k == "CLICOLOR"));
    }

    #[test]
    fn test_claude_namegen_args_without_overrides() {
        let args = build_claude_namegen_args("prompt", None);

        assert!(args.contains(&"--print".to_string()));
        assert!(args.contains(&"prompt".to_string()));
        assert!(args.contains(&"--output-format".to_string()));
        assert!(args.contains(&"json".to_string()));

        let has_model_flag = args.iter().any(|token| {
            token == "--model"
                || token.starts_with("--model=")
                || token == "-m"
                || token.starts_with("-m=")
        });
        assert!(!has_model_flag);
    }
}
