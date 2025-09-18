use std::path::Path;

pub fn extract_worktree_session(path: &Path) -> Option<String> {
    let components: Vec<String> = path
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect();

    for index in 0..components.len() {
        if components[index] == "worktrees" && index > 0 && components[index - 1] == ".schaltwerk" {
            if let Some(session) = components.get(index + 1) {
                if !session.is_empty() {
                    return Some(session.clone());
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::extract_worktree_session;
    use std::path::PathBuf;

    #[test]
    fn detects_session_from_worktree_path() {
        let path = PathBuf::from("/Users/example/project/.schaltwerk/worktrees/focused_carson");
        let session = extract_worktree_session(&path);
        assert_eq!(session.as_deref(), Some("focused_carson"));
    }

    #[test]
    fn detects_session_from_nested_worktree_path() {
        let path = PathBuf::from("/Users/example/project/.schaltwerk/worktrees/focused_carson/src-tauri/src");
        let session = extract_worktree_session(&path);
        assert_eq!(session.as_deref(), Some("focused_carson"));
    }

    #[test]
    fn returns_none_for_non_worktree_paths() {
        let path = PathBuf::from("/Users/example/project/src");
        let session = extract_worktree_session(&path);
        assert!(session.is_none());
    }
}
