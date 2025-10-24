use schaltwerk::domains::git::{
    get_commit_file_changes as fetch_commit_files, get_git_history as fetch_git_history,
    get_git_history_with_head as fetch_git_history_with_head, CommitFileChange,
    HistoryProviderSnapshot,
};
use std::path::Path;

#[tauri::command]
pub fn get_git_graph_history(
    repo_path: String,
    limit: Option<usize>,
    cursor: Option<String>,
    since_head: Option<String>,
) -> Result<HistoryProviderSnapshot, String> {
    let path = Path::new(&repo_path);
    let cursor_ref = cursor.as_deref();
    let since_head_ref = since_head.as_deref();

    let use_since_head = since_head_ref.is_some();
    let result = if use_since_head {
        fetch_git_history_with_head(path, limit, cursor_ref, since_head_ref)
    } else {
        fetch_git_history(path, limit, cursor_ref)
    };

    result
        .map_err(|e| format!("Failed to get git history: {e}"))
}

#[tauri::command]
pub fn get_git_graph_commit_files(
    repo_path: String,
    commit_hash: String,
) -> Result<Vec<CommitFileChange>, String> {
    let path = Path::new(&repo_path);
    fetch_commit_files(path, &commit_hash).map_err(|e| format!("Failed to get commit files: {e}"))
}
