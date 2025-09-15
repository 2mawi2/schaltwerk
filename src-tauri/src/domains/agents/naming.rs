use anyhow::{anyhow, Result};
use crate::{
    schaltwerk_core::database::Database,
    domains::sessions::db_sessions::SessionMethods,
    domains::git,
};
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
    pub cli_args: Option<&'a str>,
    pub env_vars: &'a [(String, String)],
}

pub fn truncate_prompt(prompt: &str) -> String {
    let first_lines: String = prompt.lines().take(4).collect::<Vec<_>>().join("\n");
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

pub async fn generate_display_name_and_rename_branch(ctx: SessionRenameContext<'_>) -> Result<Option<String>> {
    let result = generate_display_name(
        ctx.db,
        ctx.session_id,
        ctx.worktree_path,
        ctx.agent_type,
        ctx.initial_prompt,
        ctx.cli_args,
        ctx.env_vars,
    ).await?;
    
    if let Some(ref new_name) = result {
        // Generate new branch name based on the display name
        let new_branch = format!("schaltwerk/{new_name}");
        
        // Only rename if the branch name would actually change
        if ctx.current_branch != new_branch {
            log::info!("Renaming branch from '{}' to '{new_branch}'", ctx.current_branch);
            
            // Rename the branch
            match git::rename_branch(ctx.repo_path, ctx.current_branch, &new_branch) {
                Ok(()) => {
                    log::info!("Successfully renamed branch to '{new_branch}'");
                    
                    // Update the worktree to use the new branch
                    match git::update_worktree_branch(ctx.worktree_path, &new_branch) {
                        Ok(()) => {
                            log::info!("Successfully updated worktree to use branch '{new_branch}'");
                            
                            // Update the branch name in the database
                            if let Err(e) = ctx.db.update_session_branch(ctx.session_id, &new_branch) {
                                log::error!("Failed to update branch name in database: {e}");
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to update worktree to new branch '{new_branch}': {e}");
                            // Try to revert the branch rename
                            if let Err(revert_err) = git::rename_branch(ctx.repo_path, &new_branch, ctx.current_branch) {
                                log::error!("Failed to revert branch rename: {revert_err}");
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Could not rename branch from '{}' to '{new_branch}': {e}", ctx.current_branch);
                }
            }
        }
    }
    
    Ok(result)
}

pub async fn generate_display_name(
    db: &Database,
    session_id: &str,
    _worktree_path: &Path,
    agent_type: &str,
    initial_prompt: Option<&str>,
    cli_args: Option<&str>,
    env_vars: &[(String, String)],
) -> Result<Option<String>> {
    log::info!("generate_display_name called: session_id={}, agent_type={}, prompt={:?}", 
        session_id, agent_type, initial_prompt.map(truncate_prompt));
    
    // Check if there's any meaningful content for name generation
    if let Some(prompt) = initial_prompt {
        if prompt.trim().is_empty() {
            log::info!("Skipping name generation for session '{session_id}' - empty prompt");
            return Ok(None);
        }
    } else {
        log::info!("Skipping name generation for session '{session_id}' - no prompt provided");
        return Ok(None);
    }
    
    let base_prompt = initial_prompt.unwrap(); // Safe to unwrap after the check above
    let truncated = truncate_prompt(base_prompt);
    log::debug!("Truncated prompt for name generation: {truncated}");

    // Prompt for plain text result for JSON wrappers
    // Explicitly tell the AI to not use tools for faster response
    let prompt_plain = format!(
        r#"IMPORTANT: Do not use any tools. Answer this message directly without searching or reading files.

Generate a SHORT kebab-case name for this agent.

Rules:
- Maximum 3-4 words
- 20 characters or less preferred
- Use only lowercase letters, numbers, hyphens
- Be concise - capture the essence, not details
- Return ONLY the name, no quotes or exspecation
- Do NOT use tools or commands

Examples of good names:
- "auth-system" (not "implement-user-authentication-system")
- "horse-app" (not "lets-talk-about-horses-and-build")
- "fix-login" (not "fix-the-login-button-on-homepage")
- "api-docs" (not "create-api-documentation-for-endpoints")

Agent: {truncated}

Respond with just the short kebab-case name:"#
    );
    
    // Always use a temporary directory for agent execution to avoid interference with active sessions
    let temp_base = std::env::temp_dir();
    let unique_temp_dir = temp_base.join(format!("schaltwerk_namegen_{session_id}"));
    
    // Create the temp directory if it doesn't exist
    if let Err(e) = std::fs::create_dir_all(&unique_temp_dir) {
        log::warn!("Failed to create temp directory for name generation: {e}");
    }
    
    // For OpenCode specifically, initialize as a minimal git repo to avoid errors
    if agent_type == "opencode" {
        // Initialize a minimal git repo structure
        if let Err(e) = std::process::Command::new("git")
            .args(["init"])
            .current_dir(&unique_temp_dir)
            .output()
        {
            log::debug!("Failed to init git in temp dir (non-fatal): {e}");
        }
        
        // Create a minimal file so the directory isn't empty
        let readme_path = unique_temp_dir.join("README.md");
        if let Err(e) = std::fs::write(&readme_path, "# Temporary workspace for name generation\n") {
            log::debug!("Failed to create README in temp dir (non-fatal): {e}");
        }
    }
    
    let run_dir = unique_temp_dir.clone();
    log::info!("Using temp directory for name generation: {}", run_dir.display());
    
    // Use the appropriate agent based on user's selection
    if agent_type == "cursor" {
        log::info!("Attempting to generate name with cursor-agent");

        let output = Command::new("cursor-agent")
            .args(cursor_namegen_args(&prompt_plain))
            .current_dir(&run_dir)
            .env("NO_COLOR", "1")
            .env("CLICOLOR", "0")
            .env("TERM", "dumb")
            .env("CI", "1")
            .env("NONINTERACTIVE", "1")
            .stdin(std::process::Stdio::null())
            .output()
            .await;
        
        let output = match output {
            Ok(output) => {
                log::debug!("cursor-agent executed successfully");
                Some(output)
            },
            Err(e) => {
                log::warn!("Failed to execute cursor-agent: {e}");
                return Err(anyhow!("cursor-agent not available: {e}"));
            },
        };
        
        if let Some(output) = output {
            if output.status.success() {
                let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
                log::debug!("cursor-agent stdout: {stdout}");
                let stderr = String::from_utf8_lossy(&output.stderr);
                if !stderr.trim().is_empty() { log::debug!("cursor-agent stderr: {}", stderr.trim()); }

                // Try JSON first
                let parsed_json: Result<serde_json::Value, _> = serde_json::from_str(&stdout);
                let candidate = if let Ok(v) = parsed_json {
                    v.as_str()
                        .or_else(|| v.get("result").and_then(|x| x.as_str()))
                        .or_else(|| v.get("response").and_then(|x| x.as_str()))
                        .map(|s| s.to_string())
                } else {
                    None
                }
                // Fallback to raw plain text if JSON failed or missing fields
                .or_else(|| {
                    let raw = stdout.trim();
                    if !raw.is_empty() { Some(raw.to_string()) } else { None }
                });

                if let Some(result) = candidate {
                    log::info!("cursor-agent returned name candidate: {result}");
                    let name = sanitize_name(&result);
                    log::info!("Sanitized name: {name}");

                    if !name.is_empty() {
                        db.update_session_display_name(session_id, &name)?;
                        log::info!("Updated database with display_name '{name}' for session_id '{session_id}'");
                        return Ok(Some(name));
                    } else {
                        log::warn!("Sanitized name empty after processing cursor-agent output");
                    }
                } else {
                    log::warn!("cursor-agent produced no usable output for naming");
                }
            } else {
                let code = output.status.code().unwrap_or(-1);
                let stderr = String::from_utf8_lossy(&output.stderr);
                log::warn!("cursor-agent returned non-zero exit status: code={code}, stderr='{}'", stderr.trim());
            }
        }
        
        // If we get here with cursor, we couldn't generate a name
        log::warn!("cursor-agent could not generate a name for session_id '{session_id}'");
        // Clean up temp directory
        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }

    // Handle Codex name generation
    if agent_type == "codex" {
        log::info!("Attempting to generate name with codex");
        let mut args: Vec<String> = vec![
            "exec".into(),
            "--sandbox".into(), "workspace-write".into(),
            "--skip-git-repo-check".into(),
            "--json".into(),
        ];
        if let Some(cli) = cli_args {
            let mut extra = shell_words::split(cli).unwrap_or_else(|_| vec![cli.to_string()]);
            fix_codex_single_dash_long_flags(&mut extra);
            reorder_codex_model_after_profile(&mut extra);
            // Codex `exec` subcommand does not accept the interactive-only `--search` flag.
            // Filter it out to avoid exit code 2 during name generation.
            extra.retain(|a| a != "--search" && a != "-search");
            args.extend(extra);
        }
        // Capture only the last assistant message to a temp file for reliable parsing
        let tmp_file = std::env::temp_dir().join(format!("schaltwerk_codex_name_{session_id}.txt"));
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
            // Prefer the last message file if present
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
                        .find(|line| !line.is_empty()
                            && !line.contains(' ')
                            && line.chars().all(|c| c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit())
                            && line.len() <= 30)
                        .map(|s| s.to_string())
                        .or_else(|| {
                            let raw = stdout.trim();
                            if !raw.is_empty() { Some(raw.to_string()) } else { None }
                        })
                });

            if let Some(result) = candidate {
                log::info!("codex returned name candidate: {result}");
                let name = sanitize_name(&result);
                log::info!("Sanitized name: {name}");
                if !name.is_empty() {
                    db.update_session_display_name(session_id, &name)?;
                    log::info!("Updated database with display_name '{name}' for session_id '{session_id}'");
                    return Ok(Some(name));
                }
            } else {
                log::warn!("codex produced no usable output for naming");
            }
        } else {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            log::warn!("codex returned non-zero exit status: code={code}, stderr='{}', stdout='{}'", stderr.trim(), stdout.trim());
        }
        // Clean up temp directory
        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }

    // Handle OpenCode name generation
    if agent_type == "opencode" {
        log::info!("Attempting to generate name with opencode");
        
        // OpenCode uses the `run` command with a specific model and prompt
        let binary = super::opencode::resolve_opencode_binary();
        let output = Command::new(&binary)
            .args(["run", "--model", "openrouter/openai/gpt-4o-mini", &prompt_plain])
            .current_dir(&run_dir)
            .env("NO_COLOR", "1")
            .env("CLICOLOR", "0")
            .env("TERM", "dumb")
            .env("CI", "1")
            .env("NONINTERACTIVE", "1")
            .env("OPENCODE_NO_INTERACTIVE", "1")
            .stdin(std::process::Stdio::null())
            .output()
            .await;
        
        let output = match output {
            Ok(output) => {
                log::debug!("opencode executed successfully");
                output
            },
            Err(e) => {
                log::warn!("Failed to execute opencode: {e}");
                return Ok(None);
            },
        };
        
        if output.status.success() {
            let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
            log::debug!("opencode stdout: {stdout}");
            
            // OpenCode returns plain text, so we look for a kebab-case name in the output
            // Split by newlines and find the first line that looks like a kebab-case name
            let candidate = stdout
                .lines()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty())
                .filter(|line| !line.contains(' ')) // No spaces
                .filter(|line| line.chars().all(|c| c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit()))
                .filter(|line| line.len() <= 30) // Reasonable length
                .find(|_| true) // Get first match
                .map(|s| s.to_string());
            
            if let Some(result) = candidate {
                log::info!("opencode returned name candidate: {result}");
                let name = sanitize_name(&result);
                log::info!("Sanitized name: {name}");
                
                if !name.is_empty() {
                    db.update_session_display_name(session_id, &name)?;
                    log::info!("Updated database with display_name '{name}' for session_id '{session_id}'");
                    return Ok(Some(name));
                }
            } else {
                log::warn!("opencode produced no usable output for naming");
            }
        } else {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            log::warn!("opencode returned non-zero exit status: code={code}, stderr='{}', stdout='{}'", stderr.trim(), stdout.trim());
        }
        
        // Clean up temp directory
        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }
    
    // Handle Gemini name generation
    if agent_type == "gemini" {
        log::info!("Attempting to generate name with gemini");
        
        let binary = super::gemini::resolve_gemini_binary();
        let output = Command::new(&binary)
            .args(["--prompt", prompt_plain.as_str()])
            .current_dir(&run_dir)
            .env("NO_COLOR", "1")
            .env("CLICOLOR", "0")
            .env("TERM", "dumb")
            .env("CI", "1")
            .env("NONINTERACTIVE", "1")
            .stdin(std::process::Stdio::null())
            .output()
            .await;
        
        let output = match output {
            Ok(output) => {
                log::debug!("gemini executed successfully");
                output
            },
            Err(e) => {
                log::warn!("Failed to execute gemini: {e}");
                return Ok(None);
            },
        };
        
        if output.status.success() {
            let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
            log::debug!("gemini stdout: {stdout}");
            
            // Gemini returns plain text, so we look for a kebab-case name in the output
            // Split by newlines and find the first line that looks like a kebab-case name
            let candidate = stdout
                .lines()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty())
                .filter(|line| line.chars().all(|c| c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit()))
                .filter(|line| line.contains('-') || line.len() <= 10) // Has hyphens or very short
                .filter(|line| line.len() <= 30) // Reasonable length
                .find(|_| true) // Get first match
                .map(|s| s.to_string());
            
            if let Some(result) = candidate {
                log::info!("gemini returned name candidate: {result}");
                let name = sanitize_name(&result);
                log::info!("Sanitized name: {name}");
                
                if !name.is_empty() {
                    db.update_session_display_name(session_id, &name)?;
                    log::info!("Updated database with display_name '{name}' for session_id '{session_id}'");
                    return Ok(Some(name));
                }
            } else {
                log::warn!("gemini produced no usable output for naming");
            }
        } else {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            log::warn!("gemini returned non-zero exit status: code={code}, stderr='{}', stdout='{}'", stderr.trim(), stdout.trim());
        }
        
        // Clean up temp directory
        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }
    
    // Handle Qwen name generation
    if agent_type == "qwen" {
        log::info!("Attempting to generate name with qwen");
        
        let binary = super::qwen::resolve_qwen_binary();
        let output = Command::new(&binary)
            .args(["--prompt", prompt_plain.as_str()])
            .current_dir(&run_dir)
            .env("NO_COLOR", "1")
            .env("CLICOLOR", "0")
            .env("TERM", "dumb")
            .env("CI", "1")
            .env("NONINTERACTIVE", "1")
            .stdin(std::process::Stdio::null())
            .output()
            .await;
        
        let output = match output {
            Ok(output) => {
                log::debug!("qwen executed successfully");
                output
            },
            Err(e) => {
                log::warn!("Failed to execute qwen: {e}");
                return Ok(None);
            },
        };
        
        if output.status.success() {
            let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
            log::debug!("qwen stdout: {stdout}");
            
            // Qwen returns plain text, so we look for a kebab-case name in the output
            // Split by newlines and find the first line that looks like a kebab-case name
            let candidate = stdout
                .lines()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty())
                .filter(|line| line.chars().all(|c| c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit()))
                .filter(|line| line.contains('-') || line.len() <= 10) // Has hyphens or very short
                .filter(|line| line.len() <= 30) // Reasonable length
                .find(|_| true) // Get first match
                .map(|s| s.to_string());
            
            if let Some(result) = candidate {
                log::info!("qwen returned name candidate: {result}");
                let name = sanitize_name(&result);
                log::info!("Sanitized name: {name}");
                
                if !name.is_empty() {
                    db.update_session_display_name(session_id, &name)?;
                    log::info!("Updated database with display_name '{name}' for session_id '{session_id}'");
                    return Ok(Some(name));
                }
            } else {
                log::warn!("qwen produced no usable output for naming");
            }
        } else {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            log::warn!("qwen returned non-zero exit status: code={code}, stderr='{}', stdout='{}'", stderr.trim(), stdout.trim());
        }
        
        // Clean up temp directory
        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }
    
    // Use Claude only if claude was selected (not as a fallback)
    if agent_type != "claude" {
        log::info!("Agent type is '{agent_type}', not generating name with claude");
        // Clean up temp directory
        let _ = std::fs::remove_dir_all(&unique_temp_dir);
        return Ok(None);
    }
    
    log::info!("Attempting to generate name with claude");
    let output = Command::new("claude")
        .args(["--print", prompt_plain.as_str(), "--output-format", "json", "--model", "sonnet"])
        .current_dir(&run_dir)
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0")
        .env("TERM", "dumb")
        .env("CI", "1")
        .env("NONINTERACTIVE", "1")
        .stdin(std::process::Stdio::null())
        .output()
        .await;
    
    let output = match output {
        Ok(output) => {
            log::debug!("claude executed successfully");
            output
        },
        Err(e) => {
            log::error!("Failed to execute claude: {e}");
            return Err(anyhow!("Failed to execute claude: {e}"))
        },
    };
    
    if output.status.success() {
        let stdout = ansi_strip(&String::from_utf8_lossy(&output.stdout));
        log::debug!("claude stdout: {stdout}");

        // Try JSON first, then fallback to raw text
        let parsed_json: Result<serde_json::Value, _> = serde_json::from_str(&stdout);
        let candidate = if let Ok(v) = parsed_json {
            v.as_str()
                .or_else(|| v.get("result").and_then(|x| x.as_str()))
                .map(|s| s.to_string())
        } else { None }
        .or_else(|| {
            let raw = stdout.trim();
            if !raw.is_empty() { Some(raw.to_string()) } else { None }
        });

        if let Some(result) = candidate {
            log::info!("claude returned name candidate: {result}");
            let name = sanitize_name(&result);
            log::info!("Sanitized name: {name}");

            if !name.is_empty() {
                db.update_session_display_name(session_id, &name)?;
                log::info!("Updated database with display_name '{name}' for session_id '{session_id}'");
                // Clean up temp directory
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
        log::warn!("claude returned non-zero exit status: code={code}, stderr='{}', stdout='{}'", stderr.trim(), stdout.trim());
    }

    log::warn!("No name could be generated for session_id '{session_id}'");
    // Clean up temp directory
    let _ = std::fs::remove_dir_all(&unique_temp_dir);
    Ok(None)
}

// Build arguments for cursor-agent name generation
fn cursor_namegen_args(prompt_plain: &str) -> Vec<String> {
    // Align flags with Claude semantics: use --print and JSON output
    vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "-m".to_string(),
        "gpt-5".to_string(),
        prompt_plain.to_string(),
    ]
}

// Codex helpers (keep in sync with schaltwerk_core)
// NOTE: These functions are duplicated here because the naming module needs to apply
// the same Codex-specific flag normalization when invoking Codex for name generation.
// Any changes to these functions should be synchronized with the versions in schaltwerk_core.rs
fn fix_codex_single_dash_long_flags(args: &mut [String]) {
    for a in args.iter_mut() {
        if a.starts_with("--") { continue; }
        if let Some(stripped) = a.strip_prefix('-') {
            if stripped.len() == 1 { continue; }
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
    fn test_cursor_namegen_arg_shape_with_gpt5() {
        let prompt = "Generate a short name";
        let args = cursor_namegen_args(prompt);
        // Expect shape: --print --output-format json -m gpt-5 <prompt>
        assert_eq!(args[0], "--print");
        assert_eq!(args[1], "--output-format");
        assert_eq!(args[2], "json");
        assert_eq!(args[3], "-m");
        assert_eq!(args[4], "gpt-5");
        assert_eq!(args[5], prompt);
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
        
        let long_prompt = "This is a very long prompt that contains multiple lines\nSecond line here\nThird line\nFourth line\nFifth line should be truncated";
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
        let four_lines = "Line 1\nLine 2\nLine 3\nLine 4";
        assert_eq!(truncate_prompt(four_lines), four_lines);
        
        // More than 4 lines
        let many_lines = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6";
        let result = truncate_prompt(many_lines);
        assert_eq!(result, "Line 1\nLine 2\nLine 3\nLine 4");
    }

    #[test]
    fn test_ansi_strip() {
        // Test ANSI escape sequences removal
        assert_eq!(ansi_strip("\x1b[31mRed Text\x1b[0m"), "Red Text");
        assert_eq!(ansi_strip("\x1b[1;32mBold Green\x1b[0m"), "Bold Green");
        assert_eq!(ansi_strip("Normal \x1b[33mYellow\x1b[0m Text"), "Normal Yellow Text");
        assert_eq!(ansi_strip("\x1b[2J\x1b[H"), ""); // Clear screen codes
        assert_eq!(ansi_strip("No ANSI codes"), "No ANSI codes");
        assert_eq!(ansi_strip(""), "");
        
        // Complex sequences
        assert_eq!(ansi_strip("\x1b[38;5;196mExtended Color\x1b[0m"), "Extended Color");
        assert_eq!(ansi_strip("\x1b[48;2;255;0;0mRGB Background\x1b[0m"), "RGB Background");
    }

    #[test]
    fn test_fix_codex_single_dash_long_flags() {
        let mut v = vec!["-model=gpt-4o".to_string(), "-p".to_string(), "-profile=dev".to_string()];
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
            "-m".to_string(),       // Should remain as short flag
            "sonnet".to_string(),
            "--model=claude".to_string(), // Already correct
            "-profile".to_string(),
            "work".to_string(),
            "-p".to_string(),       // Should remain as short flag  
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
        let mut v = vec!["--model".to_string(), "gpt".to_string(), "--profile".to_string(), "work".to_string()];
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
        let p = args.iter().position(|a| a == "-p" || a == "--profile").unwrap();
        let m = args.iter().position(|a| a == "-m" || a.starts_with("--model")).unwrap();
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
        let mut args: Vec<String> = vec!["exec".into(), "--sandbox".into(), "workspace-write".into(), "--json".into()];
        let mut extra = shell_words::split(cli_args).unwrap();
        fix_codex_single_dash_long_flags(&mut extra);
        reorder_codex_model_after_profile(&mut extra);
        extra.retain(|a| a != "--search" && a != "-search");
        args.extend(extra);
        // Ensure --search was filtered out for exec
        assert!(args.iter().all(|a| a != "--search" && a != "-search"));
        // Model should still be present
        assert!(args.contains(&"--model".to_string()) || args.iter().any(|a| a.starts_with("--model=")));
    }

    #[tokio::test]
    async fn test_generate_display_name_skips_empty_prompt() {
        use tempfile::TempDir;
        use crate::schaltwerk_core::database::Database;
        
        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(Some(temp_dir.path().join("test.db"))).unwrap();
        let worktree_path = temp_dir.path().join("worktree");
        
        // Test with None prompt
        let result = generate_display_name(
            &db,
            "test-session",
            &worktree_path,
            "claude",
            None,
            None,
            &[],
        ).await;
        
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
        
        // Test with empty prompt
        let result = generate_display_name(
            &db,
            "test-session",
            &worktree_path,
            "claude",
            Some(""),
            None,
            &[],
        ).await;
        
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
        
        // Test with whitespace-only prompt
        let result = generate_display_name(
            &db,
            "test-session",
            &worktree_path,
            "claude",
            Some("   \n\t  "),
            None,
            &[],
        ).await;
        
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_generate_display_name_timeout_simulation() {
        use tempfile::TempDir;
        use crate::schaltwerk_core::database::Database;
        
        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(Some(temp_dir.path().join("test.db"))).unwrap();
        let worktree_path = temp_dir.path().join("worktree");
        
        // Simulate timeout by using a non-existent agent
        let result = timeout(
            Duration::from_millis(100),
            generate_display_name(
                &db,
                "test-timeout",
                &worktree_path,
                "non_existent_agent",
                Some("Test prompt for timeout"),
                None,
                &[],
            )
        ).await;
        
        // Should either timeout or return None (agent not found)
        match result {
            Ok(Ok(None)) => {}, // Agent not found
            Ok(Ok(Some(_))) => panic!("Should not generate name for non-existent agent"),
            Ok(Err(_)) => {}, // Agent execution error
            Err(_) => {}, // Timeout
        }
    }

    #[tokio::test]
    async fn test_generate_display_name_handles_invalid_agent_output() {
        use tempfile::TempDir;
        use crate::schaltwerk_core::database::Database;
        
        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(Some(temp_dir.path().join("test.db"))).unwrap();
        let worktree_path = temp_dir.path().join("worktree");
        
        // Test with unsupported agent type
        let result = generate_display_name(
            &db,
            "test-unsupported",
            &worktree_path,
            "unsupported_agent_type",
            Some("Test prompt"),
            None,
            &[],
        ).await;
        
        // Should return None for unsupported agent types
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_session_rename_context_creation() {
        use tempfile::TempDir;
        use crate::schaltwerk_core::database::Database;
        
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
            cli_args: Some("--model sonnet"),
            env_vars: &[("KEY".to_string(), "VALUE".to_string())],
        };
        
        // Verify context fields are accessible
        assert_eq!(ctx.session_id, "test-session");
        assert_eq!(ctx.agent_type, "claude");
        assert_eq!(ctx.initial_prompt, Some("Test prompt"));
        assert_eq!(ctx.cli_args, Some("--model sonnet"));
        assert_eq!(ctx.env_vars.len(), 1);
    }

    #[test]
    fn test_cursor_namegen_args_structure() {
        // Test that cursor args are properly formatted for name generation
        let prompt = "Build a todo app with React";
        let args = cursor_namegen_args(prompt);
        
        // Verify the exact structure expected by cursor-agent
        assert_eq!(args.len(), 6);
        assert_eq!(args[0], "--print");
        assert_eq!(args[1], "--output-format");
        assert_eq!(args[2], "json");
        assert_eq!(args[3], "-m");
        assert_eq!(args[4], "gpt-5");
        assert_eq!(args[5], prompt);
    }
}
