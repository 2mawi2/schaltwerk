use schaltwerk::domains::git::{get_git_history as fetch_git_history, HistoryProviderSnapshot};
use std::path::Path;

#[tauri::command]
pub fn get_git_graph_history(repo_path: String) -> Result<HistoryProviderSnapshot, String> {
    let path = Path::new(&repo_path);
    fetch_git_history(path).map_err(|e| format!("Failed to get git history: {e}"))
}
