use std::path::{Path, PathBuf};

pub fn resolve_initial_directory(cli_dir: Option<&Path>) -> Option<PathBuf> {
    cli_dir.map(normalize_path_hint)
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
}
