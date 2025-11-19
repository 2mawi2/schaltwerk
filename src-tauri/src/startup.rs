use git2::Repository;
use std::path::{Path, PathBuf};

pub fn resolve_initial_directory(cli_dir: Option<&Path>) -> Option<PathBuf> {
    cli_dir
        .map(normalize_path_hint)
        .or_else(resolve_env_repo_path)
        .or_else(resolve_repo_from_cwd)
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

fn resolve_env_repo_path() -> Option<PathBuf> {
    let env_value = std::env::var_os("PARA_REPO_PATH")?;
    if env_value.is_empty() {
        return None;
    }

    let candidate = PathBuf::from(env_value);
    if candidate.exists() {
        Some(normalize_path_hint(&candidate))
    } else {
        None
    }
}

fn resolve_repo_from_cwd() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    Repository::discover(&cwd)
        .ok()
        .and_then(|repo| repo.workdir().map(|path| path.to_path_buf()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use schaltwerk::utils::env_adapter::EnvAdapter;
    use serial_test::serial;
    use tempfile::TempDir;

    #[test]
    fn returns_cli_dir_when_provided() {
        let cli = Path::new("/projects/alpha");
        let result = resolve_initial_directory(Some(cli));
        assert_eq!(result, Some(cli.to_path_buf()));
    }

    #[test]
    fn normalizes_src_tauri_directories_to_parent() {
        let current = Path::new("/projects/alpha/src-tauri");
        let result = resolve_initial_directory(Some(current));
        assert_eq!(result, Some(PathBuf::from("/projects/alpha")));
    }

    #[test]
    #[serial]
    fn falls_back_to_env_variable_when_available() {
        let original = std::env::var("PARA_REPO_PATH").ok();
        EnvAdapter::set_var("PARA_REPO_PATH", "/projects/beta/src-tauri");
        let result = resolve_initial_directory(None);
        assert_eq!(result, Some(PathBuf::from("/projects/beta")));
        match original {
            Some(value) => EnvAdapter::set_var("PARA_REPO_PATH", &value),
            None => EnvAdapter::remove_var("PARA_REPO_PATH"),
        }
    }

    #[test]
    #[serial]
    fn falls_back_to_cwd_when_git_repo_present() {
        let temp = TempDir::new().expect("temp dir");
        Repository::init(temp.path()).expect("init repo");

        let original = std::env::current_dir().expect("cwd");
        let original_env = std::env::var("PARA_REPO_PATH").ok();
        EnvAdapter::remove_var("PARA_REPO_PATH");
        std::env::set_current_dir(temp.path()).expect("chdir");

        let result = resolve_initial_directory(None);
        assert_eq!(result, Some(temp.path().to_path_buf()));

        std::env::set_current_dir(original).expect("restore cwd");
        if let Some(value) = original_env {
            EnvAdapter::set_var("PARA_REPO_PATH", &value);
        }
    }

    #[test]
    #[serial]
    fn returns_none_when_no_sources_available() {
        let temp = TempDir::new().expect("temp dir");
        let original = std::env::current_dir().expect("cwd");
        let original_env = std::env::var("PARA_REPO_PATH").ok();
        EnvAdapter::remove_var("PARA_REPO_PATH");
        std::env::set_current_dir(temp.path()).expect("chdir");

        let result = resolve_initial_directory(None);
        assert!(result.is_none());

        std::env::set_current_dir(original).expect("restore cwd");
        if let Some(value) = original_env {
            EnvAdapter::set_var("PARA_REPO_PATH", &value);
        }
    }
}
