use std::process::Command;
use std::path::Path;
// no serde derives used in this module
use crate::get_para_core;
use crate::para_core::{git, types::ChangedFile};
use crate::file_utils;
use crate::diff_engine::{
    compute_unified_diff, add_collapsible_sections, compute_split_diff,
    calculate_diff_stats, calculate_split_diff_stats, get_file_language,
    DiffResponse, SplitDiffResponse, FileInfo
};

#[tauri::command]
pub async fn get_changed_files_from_main(session_name: Option<String>) -> Result<Vec<ChangedFile>, String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    git::get_changed_files(std::path::Path::new(&repo_path), &base_branch)
        .map_err(|e| format!("Failed to compute changed files: {e}"))
}

#[tauri::command]
pub async fn get_file_diff_from_main(
    session_name: Option<String>, 
    file_path: String
) -> Result<(String, String), String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    
    // Check if the worktree file is diffable
    let worktree_path = Path::new(&repo_path).join(&file_path);
    if worktree_path.exists() {
        let diff_info = file_utils::check_file_diffability(&worktree_path);
        if !diff_info.is_diffable {
            return Err(format!("Cannot diff file: {}", 
                diff_info.reason.unwrap_or_else(|| "Unknown reason".to_string())));
        }
    }
    
    // Check if the base file is diffable by trying to get it first
    let base_content = Command::new("git")
        .args(["-C", &repo_path, "show", &format!("{base_branch}:{file_path}")])
        .output()
        .map_err(|e| format!("Failed to get base content: {e}"))?;
    
    let base_text = if base_content.status.success() {
        // Check if the base content looks binary
        let base_bytes = &base_content.stdout;
        if base_bytes.len() > 10 * 1024 * 1024 {
            return Err("Base file is too large to diff (>10MB)".to_string());
        }
        if base_bytes.contains(&0) || is_likely_binary(base_bytes) {
            return Err("Base file appears to be binary".to_string());
        }
        String::from_utf8_lossy(base_bytes).to_string()
    } else {
        String::new()
    };
    
    let worktree_text = if worktree_path.exists() {
        std::fs::read_to_string(worktree_path)
            .map_err(|e| format!("Failed to read worktree file: {e}"))?
    } else {
        String::new()
    };
    
    Ok((base_text, worktree_text))
}

fn is_likely_binary(bytes: &[u8]) -> bool {
    // Use Git's standard algorithm: check for null bytes in first 8000 bytes
    // This matches Git's buffer_is_binary() function
    let check_size = std::cmp::min(8000, bytes.len());
    let sample = &bytes[..check_size];
    
    // Check for null bytes (Git's standard binary detection)
    sample.contains(&0)
}

#[tauri::command]
pub async fn get_base_branch_name(session_name: Option<String>) -> Result<String, String> {
    get_base_branch(session_name).await
}

#[tauri::command]
pub async fn get_current_branch_name(session_name: Option<String>) -> Result<String, String> {
    let repo_path = get_repo_path(session_name).await?;
    
    let output = Command::new("git")
        .args(["-C", &repo_path, "branch", "--show-current"])
        .output()
        .map_err(|e| format!("Failed to get branch name: {e}"))?;
    
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn get_commit_comparison_info(session_name: Option<String>) -> Result<(String, String), String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    
    let base_output = Command::new("git")
        .args(["-C", &repo_path, "rev-parse", "--short", &base_branch])
        .output()
        .map_err(|e| format!("Failed to get base commit: {e}"))?;
    
    let base_commit = String::from_utf8_lossy(&base_output.stdout).trim().to_string();
    
    let head_output = Command::new("git")
        .args(["-C", &repo_path, "rev-parse", "--short", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to get HEAD commit: {e}"))?;
    
    let head_commit = String::from_utf8_lossy(&head_output.stdout).trim().to_string();
    
    Ok((base_commit, head_commit))
}

async fn get_repo_path(session_name: Option<String>) -> Result<String, String> {
    if let Some(name) = session_name {
        let core = get_para_core().await?;
        let core = core.lock().await;
        let manager = core.session_manager();
        
        let sessions = manager.list_enriched_sessions()
            .map_err(|e| format!("Failed to get sessions: {e}"))?;
        
        let session = sessions.into_iter().find(|s| s.info.session_id == name);
        
        if let Some(session) = session {
            Ok(session.info.worktree_path)
        } else {
            Err(format!("Session '{name}' not found"))
        }
    } else {
        // For diff commands without session, use current project path if available,
        // otherwise fall back to current directory for backward compatibility
        let manager = crate::get_project_manager().await;
        if let Ok(project) = manager.current_project().await {
            Ok(project.path.to_string_lossy().to_string())
        } else {
            // Fallback for when no project is active (needed for Claude sessions)
            let current_dir = std::env::current_dir()
                .map_err(|e| format!("Failed to get current directory: {e}"))?;
            
            if current_dir.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
                current_dir.parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .ok_or_else(|| "Failed to get parent directory".to_string())
            } else {
                Ok(current_dir.to_string_lossy().to_string())
            }
        }
    }
}

async fn get_base_branch(session_name: Option<String>) -> Result<String, String> {
    if let Some(name) = session_name {
        let core = get_para_core().await?;
        let core = core.lock().await;
        let manager = core.session_manager();
        
        let sessions = manager.list_enriched_sessions()
            .map_err(|e| format!("Failed to get sessions: {e}"))?;
        
        let session = sessions.into_iter().find(|s| s.info.session_id == name);
        
        if let Some(session) = session {
            Ok(session.info.base_branch)
        } else {
            Err(format!("Session '{name}' not found"))
        }
    } else {
        // No session specified, get default branch from current project
        let manager = crate::get_project_manager().await;
        if let Ok(project) = manager.current_project().await {
            crate::para_core::git::get_default_branch(&project.path)
                .map_err(|e| format!("Failed to get default branch: {e}"))
        } else {
            // Fallback for when no project is active (needed for Claude sessions)
            let current_dir = std::env::current_dir()
                .map_err(|e| format!("Failed to get current directory: {e}"))?;
            crate::para_core::git::get_default_branch(&current_dir)
                .map_err(|e| format!("Failed to get default branch: {e}"))
        }
    }
}

#[tauri::command]
pub async fn compute_unified_diff_backend(
    session_name: Option<String>,
    file_path: String
) -> Result<DiffResponse, String> {
    use std::time::Instant;
    let start_total = Instant::now();
    
    // Profile file content loading
    let start_load = Instant::now();
    let (old_content, new_content) = get_file_diff_from_main(session_name, file_path.clone()).await?;
    let load_duration = start_load.elapsed();
    
    // Profile diff computation
    let start_diff = Instant::now();
    let diff_lines = compute_unified_diff(&old_content, &new_content);
    let diff_duration = start_diff.elapsed();
    
    // Profile collapsible sections
    let start_collapse = Instant::now();
    let lines_with_collapsible = add_collapsible_sections(diff_lines);
    let collapse_duration = start_collapse.elapsed();
    
    // Profile stats calculation
    let start_stats = Instant::now();
    let stats = calculate_diff_stats(&lines_with_collapsible);
    let stats_duration = start_stats.elapsed();
    
    let file_info = FileInfo {
        language: get_file_language(&file_path),
        size_bytes: new_content.len(),
    };
    
    let is_large_file = new_content.len() > 5 * 1024 * 1024;
    let total_duration = start_total.elapsed();
    
    // Log performance metrics
    if total_duration.as_millis() > 100 || is_large_file {
        log::info!(
            "Diff performance for {}: total={}ms (load={}ms, diff={}ms, collapse={}ms, stats={}ms), size={}KB, lines={}",
            file_path,
            total_duration.as_millis(),
            load_duration.as_millis(),
            diff_duration.as_millis(),
            collapse_duration.as_millis(),
            stats_duration.as_millis(),
            new_content.len() / 1024,
            lines_with_collapsible.len()
        );
    }
    
    Ok(DiffResponse {
        lines: lines_with_collapsible,
        stats,
        file_info,
        is_large_file,
    })
}

#[tauri::command]
pub async fn compute_split_diff_backend(
    session_name: Option<String>,
    file_path: String
) -> Result<SplitDiffResponse, String> {
    use std::time::Instant;
    let start_total = Instant::now();
    
    // Profile file content loading
    let start_load = Instant::now();
    let (old_content, new_content) = get_file_diff_from_main(session_name, file_path.clone()).await?;
    let load_duration = start_load.elapsed();
    
    // Profile diff computation
    let start_diff = Instant::now();
    let split_result = compute_split_diff(&old_content, &new_content);
    let diff_duration = start_diff.elapsed();
    
    // Profile stats calculation
    let start_stats = Instant::now();
    let stats = calculate_split_diff_stats(&split_result);
    let stats_duration = start_stats.elapsed();
    
    let file_info = FileInfo {
        language: get_file_language(&file_path),
        size_bytes: new_content.len(),
    };
    
    let is_large_file = new_content.len() > 5 * 1024 * 1024;
    let total_duration = start_total.elapsed();
    
    // Log performance metrics
    if total_duration.as_millis() > 100 || is_large_file {
        log::info!(
            "Split diff performance for {}: total={}ms (load={}ms, diff={}ms, stats={}ms), size={}KB, lines={}+{}",
            file_path,
            total_duration.as_millis(),
            load_duration.as_millis(),
            diff_duration.as_millis(),
            stats_duration.as_millis(),
            new_content.len() / 1024,
            split_result.left_lines.len(),
            split_result.right_lines.len()
        );
    }
    
    Ok(SplitDiffResponse {
        split_result,
        stats,
        file_info,
        is_large_file,
    })
}

// Tests removed: diff_commands functions now use active project instead of current working directory