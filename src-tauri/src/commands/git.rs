use schaltwerk::domains::git::{
    get_commit_file_changes as fetch_commit_files, get_git_history as fetch_git_history,
    CommitFileChange, HistoryProviderSnapshot,
};
use std::path::Path;

#[tauri::command]
pub fn get_git_graph_history(
    repo_path: String,
    limit: Option<usize>,
    cursor: Option<String>,
) -> Result<HistoryProviderSnapshot, String> {
    let path = Path::new(&repo_path);
    fetch_git_history(path, limit, cursor.as_deref())
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
