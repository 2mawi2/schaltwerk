use anyhow::{anyhow, Result};
use crate::para_core::{Database, db_sessions::SessionMethods, git};
use std::path::Path;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

pub struct SessionRenameContext<'a> {
    pub db: &'a Database,
    pub session_id: &'a str,
    pub worktree_path: &'a Path,
    pub repo_path: &'a Path,
    pub current_branch: &'a str,
    pub agent_type: &'a str,
    pub initial_prompt: Option<&'a str>,
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
    let result = generate_display_name(ctx.db, ctx.session_id, ctx.worktree_path, ctx.agent_type, ctx.initial_prompt).await?;
    
    if let Some(ref new_name) = result {
        // Generate new branch name based on the display name
        let new_branch = format!("para/{new_name}");
        
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
    worktree_path: &Path,
    agent_type: &str,
    initial_prompt: Option<&str>,
) -> Result<Option<String>> {
    log::info!("generate_display_name called: session_id={}, agent_type={}, prompt={:?}", 
        session_id, agent_type, initial_prompt.map(truncate_prompt));
    
    let base_prompt = initial_prompt.unwrap_or("Name this coding session succinctly");
    let truncated = truncate_prompt(base_prompt);
    log::debug!("Truncated prompt for name generation: {truncated}");

    // Prompt for plain text result for JSON wrappers
    // Explicitly tell the AI to not use tools for faster response
    let prompt_plain = format!(
        r#"IMPORTANT: Do not use any tools. Answer this message directly without searching or reading files.

Generate a SHORT kebab-case name for this task.

Rules:
- Maximum 3-4 words
- 20 characters or less preferred
- Use only lowercase letters, numbers, hyphens
- Be concise - capture the essence, not details
- Return ONLY the name, no quotes or explanation
- Do NOT use tools or commands

Examples of good names:
- "auth-system" (not "implement-user-authentication-system")
- "horse-app" (not "lets-talk-about-horses-and-build")
- "fix-login" (not "fix-the-login-button-on-homepage")
- "api-docs" (not "create-api-documentation-for-endpoints")

Task: {truncated}

Respond with just the short kebab-case name:"#
    );
    
    // Use the appropriate agent based on user's selection
    if agent_type == "cursor" {
        log::info!("Attempting to generate name with cursor-agent");
        // Preflight: verify we can read the worktree directory; if not, fall back to a safe temp dir
        let mut run_dir = worktree_path.to_path_buf();
        match std::fs::read_dir(worktree_path) {
            Ok(_) => {
                log::debug!("Worktree readable for cursor-agent name generation: {}", worktree_path.display());
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                let tmp = std::env::temp_dir();
                log::warn!(
                    "Permission denied reading worktree '{}'. Falling back to temp dir '{}' for cursor-agent name generation.",
                    worktree_path.display(),
                    tmp.display()
                );
                run_dir = tmp;
            }
            Err(e) => {
                log::debug!("Worktree read_dir returned error (non-fatal): {e}");
            }
        }

        // Cursor Agent can take longer to initialize; allow a bit more time
        let timeout_duration = Duration::from_secs(45);
        let cursor_future = Command::new("cursor-agent")
            .args(cursor_namegen_args(&prompt_plain))
            .current_dir(&run_dir)
            .env("NO_COLOR", "1")
            .env("CLICOLOR", "0")
            .output();
        
        let output = match timeout(timeout_duration, cursor_future).await {
            Ok(Ok(output)) => {
                log::debug!("cursor-agent executed successfully");
                Some(output)
            },
            Ok(Err(e)) => {
                log::warn!("Failed to execute cursor-agent: {e}");
                // User selected cursor but it's not available - don't fall back to claude
                return Err(anyhow!("cursor-agent not available: {e}"));
            },
            Err(_) => {
                log::warn!("Cursor-agent timed out after 30 seconds");
                return Err(anyhow!("cursor-agent timed out"));
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
        return Ok(None);
    }

    // Handle OpenCode name generation
    if agent_type == "opencode" {
        log::info!("Attempting to generate name with opencode");
        
        // OpenCode uses the `run` command with a specific model and prompt
        let timeout_duration = Duration::from_secs(20);
        let binary = crate::para_core::opencode::resolve_opencode_binary();
        let opencode_future = Command::new(&binary)
            .args(["run", "--model", "openrouter/openai/gpt-4o-mini", &prompt_plain])
            .current_dir(worktree_path)
            .env("NO_COLOR", "1")
            .env("CLICOLOR", "0")
            .env("OPENCODE_NO_INTERACTIVE", "1") // Ensure non-interactive mode
            .output();
        
        let output = match timeout(timeout_duration, opencode_future).await {
            Ok(Ok(output)) => {
                log::debug!("opencode executed successfully");
                output
            },
            Ok(Err(e)) => {
                log::warn!("Failed to execute opencode: {e}");
                return Ok(None);
            },
            Err(_) => {
                log::warn!("OpenCode timed out after 15 seconds");
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
            log::warn!("opencode returned non-zero exit status");
        }
        
        return Ok(None);
    }
    
    // Handle Gemini name generation
    if agent_type == "gemini" {
        log::info!("Attempting to generate name with gemini");
        
        let timeout_duration = Duration::from_secs(15);
        let binary = crate::para_core::gemini::resolve_gemini_binary();
        let gemini_future = Command::new(&binary)
            .args(["--prompt", prompt_plain.as_str()])
            .current_dir(worktree_path)
            .env("NO_COLOR", "1")
            .env("CLICOLOR", "0")
            .output();
        
        let output = match timeout(timeout_duration, gemini_future).await {
            Ok(Ok(output)) => {
                log::debug!("gemini executed successfully");
                output
            },
            Ok(Err(e)) => {
                log::warn!("Failed to execute gemini: {e}");
                return Ok(None);
            },
            Err(_) => {
                log::warn!("Gemini timed out after 15 seconds");
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
            log::warn!("gemini returned non-zero exit status");
        }
        
        return Ok(None);
    }
    
    // Use Claude only if claude was selected (not as a fallback)
    if agent_type != "claude" {
        log::info!("Agent type is '{agent_type}', not generating name with claude");
        return Ok(None);
    }
    
    log::info!("Attempting to generate name with claude");
    let timeout_duration = Duration::from_secs(10);
    let claude_future = Command::new("claude")
        .args(["--print", prompt_plain.as_str(), "--output-format", "json", "--model", "sonnet"])
        .current_dir(worktree_path)
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0")
        .output();
    
    let output = match timeout(timeout_duration, claude_future).await {
        Ok(Ok(output)) => {
            log::debug!("claude executed successfully");
            output
        },
        Ok(Err(e)) => {
            log::error!("Failed to execute claude: {e}");
            return Err(anyhow!("Failed to execute claude: {e}"))
        },
        Err(_) => {
            log::error!("Claude timed out after 10 seconds");
            return Err(anyhow!("Claude timed out after 10 seconds"))
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
                return Ok(Some(name));
            } else {
                log::warn!("Sanitized name is empty");
            }
        } else {
            log::warn!("Claude produced no usable output for naming");
        }
    } else {
        log::warn!("claude returned non-zero exit status");
    }

    log::warn!("No name could be generated for session_id '{session_id}'");
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_truncate_prompt() {
        let short_prompt = "Short task";
        assert_eq!(truncate_prompt(short_prompt), "Short task");
        
        let long_prompt = "This is a very long prompt that contains multiple lines\nSecond line here\nThird line\nFourth line\nFifth line should be truncated";
        let result = truncate_prompt(long_prompt);
        assert!(result.lines().count() <= 4);
        assert!(result.len() <= 400);
    }
}
