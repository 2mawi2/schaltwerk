use std::collections::HashSet;
use std::path::Path;

use schaltwerk::shared::terminal_id::session_terminal_base_variants;
pub use schaltwerk::shared::terminal_id::{
    legacy_terminal_id_for_session_bottom, legacy_terminal_id_for_session_top,
    previous_hashed_terminal_id_for_session_bottom, previous_hashed_terminal_id_for_session_top,
    previous_tilde_hashed_terminal_id_for_session_bottom,
    previous_tilde_hashed_terminal_id_for_session_top, terminal_id_for_session_bottom,
    terminal_id_for_session_top,
};

pub fn ensure_cwd_access<P: AsRef<Path>>(cwd: P) -> Result<(), String> {
    let path = cwd.as_ref();
    let path_str = path.to_string_lossy();

    // Debug logging for Windows path issues
    log::debug!(
        "ensure_cwd_access: checking path '{}' (len={}, bytes={:?})",
        path_str,
        path_str.len(),
        path_str.as_bytes().iter().take(50).collect::<Vec<_>>()
    );

    // Check for common path issues
    if path_str.is_empty() {
        return Err("Working directory path is empty".to_string());
    }

    // Check for NUL bytes which would cause ERROR_BAD_PATHNAME
    if path_str.as_bytes().contains(&0) {
        return Err(format!(
            "Working directory path contains NUL byte: {:?}",
            path_str
        ));
    }

    match std::fs::read_dir(path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Err(format!(
            "Permission required for folder: {}. Please grant access when prompted and then retry starting the agent.",
            path.display()
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(format!(
            "Working directory not found: {}",
            path.display()
        )),
        Err(e) => Err(format!(
            "Error accessing working directory '{}': {} (raw_os_error={:?})",
            path.display(),
            e,
            e.raw_os_error()
        )),
    }
}

pub async fn close_session_terminals_if_any(session_name: &str) {
    if let Ok(manager) = crate::get_terminal_manager().await {
        let mut ids: HashSet<String> = HashSet::new();
        ids.insert(terminal_id_for_session_top(session_name));
        ids.insert(terminal_id_for_session_bottom(session_name));
        ids.insert(previous_tilde_hashed_terminal_id_for_session_top(
            session_name,
        ));
        ids.insert(previous_tilde_hashed_terminal_id_for_session_bottom(
            session_name,
        ));
        ids.insert(previous_hashed_terminal_id_for_session_top(session_name));
        ids.insert(previous_hashed_terminal_id_for_session_bottom(session_name));
        ids.insert(legacy_terminal_id_for_session_top(session_name));
        ids.insert(legacy_terminal_id_for_session_bottom(session_name));

        let prefixes = session_terminal_prefixes(session_name);
        for (active_id, _) in manager.get_all_terminal_activity().await {
            if matches_session_terminal(&active_id, &prefixes) {
                ids.insert(active_id);
            }
        }

        for id in ids {
            if let Ok(true) = manager.terminal_exists(&id).await {
                let _ = manager.close_terminal(id).await;
            }
        }
    }
}

fn session_terminal_prefixes(session_name: &str) -> Vec<String> {
    session_terminal_base_variants(session_name)
        .into_iter()
        .flat_map(|base| {
            ["-top", "-bottom"]
                .into_iter()
                .map(move |suffix| format!("{base}{suffix}"))
        })
        .collect()
}

fn matches_session_terminal(terminal_id: &str, prefixes: &[String]) -> bool {
    prefixes
        .iter()
        .any(|prefix| terminal_matches_prefix(terminal_id, prefix))
}

fn terminal_matches_prefix(terminal_id: &str, prefix: &str) -> bool {
    if terminal_id == prefix {
        return true;
    }

    terminal_id
        .strip_prefix(prefix)
        .and_then(|rest| rest.strip_prefix('-'))
        .map(|suffix| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use schaltwerk::shared::terminal_id::session_terminal_base;
    use std::path::PathBuf;

    #[test]
    fn test_sanitize_and_ids() {
        assert_eq!(
            terminal_id_for_session_top("x y"),
            "session-x_y~caca3794-top"
        );
        assert_eq!(
            terminal_id_for_session_bottom("x/y"),
            "session-x_y~c2cc6993-bottom"
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

    #[test]
    fn prefixes_cover_all_variant_generations() {
        let prefixes = session_terminal_prefixes("alpha beta");
        assert!(prefixes.iter().any(|p| p.contains('~')));
        assert!(prefixes.iter().any(|p| !p.contains('~')));
        assert!(prefixes.iter().any(|p| p.ends_with("-top")));
        assert!(prefixes.iter().any(|p| p.ends_with("-bottom")));
    }

    #[test]
    fn numeric_suffix_matching_handles_extra_tabs() {
        let prefixes = session_terminal_prefixes("dreamy kirch");
        let base = session_terminal_base("dreamy kirch");
        let bottom = format!("{base}-bottom");
        assert!(matches_session_terminal(&bottom, &prefixes));
        assert!(matches_session_terminal(&format!("{bottom}-2"), &prefixes));
        assert!(!matches_session_terminal(
            &format!("{bottom}-custom"),
            &prefixes
        ));
        assert!(!matches_session_terminal(
            "session-other~00000000-bottom-1",
            &prefixes
        ));
    }
}
