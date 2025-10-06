use std::path::Path;

pub fn sanitize_session_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn sanitized_component_with_hash(name: &str) -> String {
    let mut sanitized: String = sanitize_session_name(name);
    let used_fallback = sanitized.is_empty();
    if used_fallback {
        sanitized = "session".to_string();
    }

    let has_disallowed = name
        .chars()
        .any(|c| !(c.is_alphanumeric() || c == '_' || c == '-'));

    if has_disallowed || used_fallback {
        let hash = crc32fast::hash(name.as_bytes());
        format!("{sanitized}-{hash:08x}")
    } else {
        sanitized
    }
}

pub fn terminal_id_for_session_top(name: &str) -> String {
    format!("session-{}-top", sanitized_component_with_hash(name))
}
pub fn terminal_id_for_session_bottom(name: &str) -> String {
    format!("session-{}-bottom", sanitized_component_with_hash(name))
}

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
        for id in [
            terminal_id_for_session_top(session_name),
            terminal_id_for_session_bottom(session_name),
        ] {
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
        assert_eq!(sanitize_session_name("abc-DEF_123"), "abc-DEF_123");
        assert_eq!(sanitize_session_name("weird name!*"), "weird_name__");
        assert_eq!(
            terminal_id_for_session_top("x y"),
            format!(
                "session-{}-top",
                super::sanitized_component_with_hash("x y")
            )
        );
        assert_eq!(
            terminal_id_for_session_bottom("x/y"),
            format!(
                "session-{}-bottom",
                super::sanitized_component_with_hash("x/y")
            )
        );
        assert_eq!(terminal_id_for_session_top("demo"), "session-demo-top");
    }

    #[test]
    fn test_terminal_ids_unique_for_colliding_names() {
        let top_with_slash = terminal_id_for_session_top("feature/auth");
        let top_with_underscore = terminal_id_for_session_top("feature_auth");
        assert_ne!(top_with_slash, top_with_underscore);

        let bottom_with_space = terminal_id_for_session_bottom("draft session");
        let bottom_with_dash = terminal_id_for_session_bottom("draft-session");
        assert_ne!(bottom_with_space, bottom_with_dash);
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
