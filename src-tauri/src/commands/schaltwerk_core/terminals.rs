use std::collections::HashSet;
use std::path::Path;

pub use schaltwerk::shared::terminal_id::{
    legacy_terminal_id_for_session_bottom, legacy_terminal_id_for_session_top,
    previous_hashed_terminal_id_for_session_bottom, previous_hashed_terminal_id_for_session_top,
    terminal_id_for_session_bottom, terminal_id_for_session_top,
};

pub fn ensure_cwd_access<P: AsRef<Path>>(cwd: P) -> Result<(), String> {
    match std::fs::read_dir(&cwd) {
        Ok(_) => Ok(()),
        Err(e) if e.kind()==std::io::ErrorKind::PermissionDenied =>
            Err(format!("Permission required for folder: {}. Please grant access when prompted and then retry starting the agent.", cwd.as_ref().display())),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound =>
            Err(format!("Working directory not found: {}", cwd.as_ref().display())),
        Err(e) => Err(format!("Error accessing working directory: {e}")),
    }
}

pub async fn close_session_terminals_if_any(session_name: &str) {
    if let Ok(manager) = crate::get_terminal_manager().await {
        let mut ids: HashSet<String> = HashSet::new();
        ids.insert(terminal_id_for_session_top(session_name));
        ids.insert(terminal_id_for_session_bottom(session_name));
        ids.insert(previous_hashed_terminal_id_for_session_top(session_name));
        ids.insert(previous_hashed_terminal_id_for_session_bottom(session_name));
        ids.insert(legacy_terminal_id_for_session_top(session_name));
        ids.insert(legacy_terminal_id_for_session_bottom(session_name));

        for id in ids {
            if let Ok(true) = manager.terminal_exists(&id).await {
                let _ = manager.close_terminal(id).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_sanitize_and_ids() {
        assert_eq!(terminal_id_for_session_top("x y"), "session-x_y~caca37-top");
        assert_eq!(
            terminal_id_for_session_bottom("x/y"),
            "session-x_y~c2cc69-bottom"
        );
        let empty_top = terminal_id_for_session_top("");
        assert!(empty_top.starts_with("session-unknown~"));
    }

    #[test]
    fn test_collision_resistance() {
        let id_a = terminal_id_for_session_top("alpha beta");
        let id_b = terminal_id_for_session_top("alpha?beta");
        assert_ne!(id_a, id_b);
    }

    #[test]
    fn test_ensure_cwd_access_ok_and_notfound() {
        let tmp = tempfile::tempdir().unwrap();
        ensure_cwd_access(tmp.path()).expect("tempdir should be accessible");
        let mut nonexist = PathBuf::from(tmp.path());
        nonexist.push("nope-subdir-404");
        let err = ensure_cwd_access(&nonexist).unwrap_err();
        assert!(err.contains("not found"));
        // cleanup
        drop(tmp);
    }
}
