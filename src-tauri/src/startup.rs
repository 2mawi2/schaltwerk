use crate::projects;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum CliDirectoryResult {
    NoArgument,
    Valid(PathBuf),
    ValidationError { path: PathBuf, error: String },
}

pub fn resolve_initial_directory(cli_dir: Option<&Path>) -> Option<PathBuf> {
    cli_dir.map(normalize_path_hint)
}

pub fn validate_cli_directory(path: Option<&Path>) -> CliDirectoryResult {
    let Some(path) = path else {
        return CliDirectoryResult::NoArgument;
    };
    let path = path.to_path_buf();

    if !projects::directory_exists(&path) {
        return CliDirectoryResult::ValidationError {
            path: path.clone(),
            error: format!("Directory does not exist: {}", path.display()),
        };
    }

    if !projects::is_git_repository(&path) {
        return CliDirectoryResult::ValidationError {
            path: path.clone(),
            error: format!(
                "Not a Git repository: {}. Please select a valid Git repository.",
                path.display()
            ),
        };
    }

    if let Err(e) = std::fs::read_dir(&path) && e.kind() == std::io::ErrorKind::PermissionDenied {
        return CliDirectoryResult::ValidationError {
            path,
            error: "Permission denied. Please grant access and try again.".to_string(),
        };
    }

    CliDirectoryResult::Valid(path)
}

fn normalize_path_hint(path: &Path) -> PathBuf {
    if let Some(parent) = path.parent().filter(|_| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("src-tauri"))
    }) {
        return parent.to_path_buf();
    }

    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn returns_cli_dir_when_provided() {
        let cli = Path::new("/projects/alpha");
        let result = resolve_initial_directory(Some(cli));
        assert_eq!(result, Some(cli.to_path_buf()));
    }

    #[test]
    fn returns_none_without_cli_arg() {
        let result = resolve_initial_directory(None);
        assert_eq!(result, None);
    }

    #[test]
    fn normalizes_src_tauri_directories_to_parent() {
        let current = Path::new("/projects/alpha/src-tauri");
        let result = resolve_initial_directory(Some(current));
        assert_eq!(result, Some(PathBuf::from("/projects/alpha")));
    }

    #[test]
    fn validate_cli_directory_returns_no_argument_when_none() {
        let result = validate_cli_directory(None);
        assert!(matches!(result, CliDirectoryResult::NoArgument));
    }

    #[test]
    fn validate_cli_directory_returns_error_for_nonexistent_path() {
        let path = PathBuf::from("/nonexistent/path/that/does/not/exist");
        let result = validate_cli_directory(Some(&path));
        match result {
            CliDirectoryResult::ValidationError { error, .. } => {
                assert!(error.contains("does not exist"));
            }
            _ => panic!("Expected ValidationError, got {:?}", result),
        }
    }

    #[test]
    fn validate_cli_directory_returns_error_for_non_git_directory() {
        let tmp = TempDir::new().expect("Failed to create temp dir");
        let path = tmp.path().to_path_buf();
        let result = validate_cli_directory(Some(&path));
        match result {
            CliDirectoryResult::ValidationError { error, .. } => {
                assert!(error.contains("Not a Git repository"));
            }
            _ => panic!("Expected ValidationError, got {:?}", result),
        }
    }

    #[test]
    fn validate_cli_directory_returns_valid_for_git_repository() {
        let tmp = TempDir::new().expect("Failed to create temp dir");
        let git_dir = tmp.path().join(".git");
        std::fs::create_dir(&git_dir).expect("Failed to create .git dir");

        let path = tmp.path().to_path_buf();
        let result = validate_cli_directory(Some(&path));
        match result {
            CliDirectoryResult::Valid(valid_path) => {
                assert_eq!(valid_path, path);
            }
            _ => panic!("Expected Valid, got {:?}", result),
        }
    }
}
