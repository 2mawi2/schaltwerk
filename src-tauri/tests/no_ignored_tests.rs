use std::path::Path;
use walkdir::WalkDir;

fn should_skip(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
        matches!(
            name,
            "target" | ".git" | "node_modules" | ".schaltwerk" | "dist"
        )
    } else {
        false
    }
}

#[test]
fn rust_tests_must_not_be_ignored() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut violations = Vec::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !should_skip(e.path()))
        .filter_map(Result::ok)
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map_or(false, |ext| ext == "rs")
        })
    {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .map_or(false, |name| name == "no_ignored_tests.rs")
        {
            continue;
        }
        let contents = std::fs::read_to_string(path).expect("failed to read source file");
        for (idx, line) in contents.lines().enumerate() {
            if line.contains("#[ignore") {
                let relative = path
                    .strip_prefix(root)
                    .unwrap_or(path)
                    .display()
                    .to_string();
                violations.push(format!("{}:{}", relative, idx + 1));
            }
        }
    }

    if !violations.is_empty() {
        panic!(
            "#[ignore] is not allowed in this crate. Found in:\n{}",
            violations.join("\n")
        );
    }
}
