use std::fs;
use std::path::Path;

use toml_edit::{Array, DocumentMut};

#[derive(Debug, PartialEq, Eq)]
pub enum NotifyConfigState {
    Added,
    AlreadyEnabled,
    Removed,
    AlreadyDisabled,
}

#[derive(thiserror::Error, Debug, PartialEq, Eq)]
pub enum NotifyConfigError {
    #[error("notify entry conflicts with existing configuration")]
    Conflict,
    #[error("I/O error: {0}")]
    Io(String),
    #[error("TOML parse error: {0}")]
    Parse(String),
}

pub fn enable_notify(
    path: &Path,
    command: &[String],
) -> Result<NotifyConfigState, NotifyConfigError> {
    let parent = path
        .parent()
        .ok_or_else(|| NotifyConfigError::Io("config path has no parent".into()))?;
    if !parent.exists() {
        fs::create_dir_all(parent)
            .map_err(|e| NotifyConfigError::Io(format!("failed to create config dir: {e}")))?;
    }

    let mut doc = if path.exists() {
        let content = fs::read_to_string(path)
            .map_err(|e| NotifyConfigError::Io(format!("failed to read config: {e}")))?;
        if content.trim().is_empty() {
            DocumentMut::new()
        } else {
            content
                .parse::<DocumentMut>()
                .map_err(|e| NotifyConfigError::Parse(format!("{e}")))?
        }
    } else {
        DocumentMut::new()
    };

    let notify_key = "notify";
    if let Some(existing) = doc.get_mut(notify_key) {
        if let Some(arr) = existing.as_array() {
            let matches = arr
                .iter()
                .map(|item| item.as_str().map(|s| s.to_string()))
                .collect::<Option<Vec<_>>>();
            if let Some(existing_vec) = matches {
                if existing_vec == command {
                    return Ok(NotifyConfigState::AlreadyEnabled);
                }
            }
        }
        return Err(NotifyConfigError::Conflict);
    }

    let mut toml_array = Array::new();
    for item in command {
        toml_array.push(item.clone());
    }
    doc.insert(notify_key, toml_array.into());

    fs::write(path, doc.to_string())
        .map_err(|e| NotifyConfigError::Io(format!("failed to write config: {e}")))?;

    Ok(NotifyConfigState::Added)
}

pub fn disable_notify(
    path: &Path,
    command: &[String],
) -> Result<NotifyConfigState, NotifyConfigError> {
    if !path.exists() {
        return Ok(NotifyConfigState::AlreadyDisabled);
    }

    let content = fs::read_to_string(path)
        .map_err(|e| NotifyConfigError::Io(format!("failed to read config: {e}")))?;

    if content.trim().is_empty() {
        return Ok(NotifyConfigState::AlreadyDisabled);
    }

    let mut doc = content
        .parse::<DocumentMut>()
        .map_err(|e| NotifyConfigError::Parse(format!("{e}")))?;

    let mut removed = false;
    if let Some(existing) = doc.get("notify") {
        if let Some(arr) = existing.as_array() {
            let matches = arr
                .iter()
                .map(|item| item.as_str().map(|s| s.to_string()))
                .collect::<Option<Vec<_>>>();
            if let Some(existing_vec) = matches {
                if existing_vec == command {
                    doc.remove("notify");
                    removed = true;
                }
            }
        }
    }

    if removed {
        fs::write(path, doc.to_string())
            .map_err(|e| NotifyConfigError::Io(format!("failed to write config: {e}")))?;
        Ok(NotifyConfigState::Removed)
    } else {
        Ok(NotifyConfigState::AlreadyDisabled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn helper_vec(path: &str) -> Vec<String> {
        vec!["/bin/sh".into(), path.into()]
    }

    #[test]
    fn enable_creates_file_and_sets_notify() {
        let dir = tempdir().unwrap();
        let config_path = dir.path().join("config.toml");
        let helper_path = dir.path().join("hook.sh");
        fs::write(&helper_path, "#!/bin/sh\nexit 0\n").unwrap();

        let result =
            enable_notify(&config_path, &helper_vec(helper_path.to_str().unwrap())).unwrap();
        assert_eq!(result, NotifyConfigState::Added);

        let written = fs::read_to_string(&config_path).unwrap();
        assert!(
            written.contains("notify"),
            "config missing notify entry: {written}"
        );
        assert!(written.contains(helper_path.to_str().unwrap()));
    }

    #[test]
    fn enable_is_idempotent_when_command_matches() {
        let dir = tempdir().unwrap();
        let config_path = dir.path().join("config.toml");
        let helper_path = dir.path().join("hook.sh");
        fs::write(&helper_path, "#!/bin/sh\nexit 0\n").unwrap();
        let helper_vec = helper_vec(helper_path.to_str().unwrap());

        enable_notify(&config_path, &helper_vec).unwrap();
        let second = enable_notify(&config_path, &helper_vec).unwrap();
        assert_eq!(second, NotifyConfigState::AlreadyEnabled);
    }

    #[test]
    fn enable_conflicts_with_other_notify() {
        let dir = tempdir().unwrap();
        let config_path = dir.path().join("config.toml");
        fs::write(&config_path, "notify = [\"python\", \"/tmp/custom.py\"]\n").unwrap();

        let helper_path = dir.path().join("hook.sh");
        fs::write(&helper_path, "#!/bin/sh\nexit 0\n").unwrap();

        let err =
            enable_notify(&config_path, &helper_vec(helper_path.to_str().unwrap())).unwrap_err();
        assert!(matches!(err, NotifyConfigError::Conflict));
    }

    #[test]
    fn disable_removes_matching_entry() {
        let dir = tempdir().unwrap();
        let config_path = dir.path().join("config.toml");
        let helper_path = dir.path().join("hook.sh");
        fs::write(&helper_path, "#!/bin/sh\nexit 0\n").unwrap();
        let helper_vec = helper_vec(helper_path.to_str().unwrap());

        enable_notify(&config_path, &helper_vec).unwrap();
        let result = disable_notify(&config_path, &helper_vec).unwrap();
        assert_eq!(result, NotifyConfigState::Removed);

        let content = fs::read_to_string(&config_path).unwrap();
        assert!(!content.contains("notify"));
    }

    #[test]
    fn disable_noop_when_not_present() {
        let dir = tempdir().unwrap();
        let config_path = dir.path().join("config.toml");
        fs::write(&config_path, "# empty\n").unwrap();
        let result = disable_notify(&config_path, &helper_vec("/tmp/hook.sh"));
        assert_eq!(result.unwrap(), NotifyConfigState::AlreadyDisabled);
    }
}
