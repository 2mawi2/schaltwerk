use arch_test_utils::{check_imports_in_directory, format_violation_report};

const CROSS_DOMAIN_ALLOWLIST: &[(&str, &str)] = &[
    ("sessions", "git"),        // Sessions need git stats for dashboards
    ("sessions", "agents"),     // Session creation wires agent manifests
    ("merge", "git"),           // Merge domain shells out to git operations
    ("merge", "sessions"),      // Merge domain coordinates session state
    ("workspace", "git"),       // Workspace diff engine pulls repo data
    ("workspace", "sessions"),  // Workspace watchers stream session metadata
    ("projects", "terminal"),   // Projects manager still proxies terminal lifecycle
    ("workspace", "merge"),     // Workspace watcher queries merge state snapshots
    ("agents", "git"),          // Agent naming uses git stats for formatting
    ("agents", "sessions"),     // Agent naming maps session IDs to metadata
    ("sessions", "merge"),      // Session activity surfaces merge preview state
    ("sessions", "terminal"),   // Session utils generate terminal launch commands
    ("git", "sessions"),        // Git projections enrich session stats
];

const LEGACY_EXCEPTION_LIST: &[(&str, &str)] = &[
    // Agents still rely on legacy database helpers for name canonicalisation
    ("domains/agents/naming.rs", "schaltwerk_core::database::Database"),
    ("domains/agents/naming.rs", "schaltwerk_core::{"),
    // Git domain persists stats through the legacy database layer
    ("domains/git/db_git_stats.rs", "schaltwerk_core::database::Database"),
    // Merge service writes merge state snapshots through legacy DB plumbing
    ("domains/merge/service.rs", "schaltwerk_core::database::Database"),
    // Projects manager still delegates lifecycle to schaltwerk_core facade
    ("domains/projects/manager.rs", "schaltwerk_core::SchaltwerkCore"),
    // Session activity hydrates history via schaltwerk_core database APIs
    ("domains/sessions/activity.rs", "schaltwerk_core::database::Database"),
    // Session persistence wraps the old project config repositories
    ("domains/sessions/db_sessions.rs", "schaltwerk_core::database::Database"),
    ("domains/sessions/repository.rs", "schaltwerk_core::database::Database"),
    ("domains/sessions/repository.rs", "schaltwerk_core::db_app_config"),
    ("domains/sessions/repository.rs", "schaltwerk_core::db_project_config"),
    // Session service still reads raw Database handles during refactor
    ("domains/sessions/service.rs", "schaltwerk_core::database::Database"),
    ("domains/sessions/sorting.rs", "schaltwerk_core::database::Database"),
    // Session utils rely on default branch prefix from legacy config schema
    ("domains/sessions/utils.rs", "schaltwerk_core::db_project_config"),
    // Workspace diff commands still call helper that proxies to core
    ("domains/workspace/diff_commands.rs", "get_schaltwerk_core"),
];

const LAYERING_BLOCKLIST: &[&str] = &["commands", "services"];

#[test]
fn no_cross_domain_imports() {
    let violations = check_imports_in_directory("src/domains", |path, import| {
        arch_test_utils::validate_cross_domain_import(path, import, CROSS_DOMAIN_ALLOWLIST)
    });

    assert!(
        violations.is_empty(),
        "{}",
        format_violation_report("Cross-Domain Import", &violations)
    );
}

#[test]
fn no_legacy_schaltwerk_core_imports() {
    let violations = check_imports_in_directory("src/domains", |path, import| {
        arch_test_utils::validate_legacy_import(path, import, LEGACY_EXCEPTION_LIST)
    });

    assert!(
        violations.is_empty(),
        "{}",
        format_violation_report("Legacy Import", &violations)
    );
}

#[test]
fn domains_only_depend_on_allowed_layers() {
    let violations = check_imports_in_directory("src/domains", |path, import| {
        arch_test_utils::validate_layering(path, import, LAYERING_BLOCKLIST)
    });

    assert!(
        violations.is_empty(),
        "{}",
        format_violation_report("Layering Violation", &violations)
    );
}

mod arch_test_utils {
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Component, Path, PathBuf};
    use std::sync::OnceLock;

    use regex::Regex;
    use walkdir::WalkDir;

    pub struct ImportViolation {
        pub file: PathBuf,
        pub import: String,
        pub reason: String,
    }

    pub fn check_imports_in_directory<F>(
        dir: &str,
        predicate: F,
    ) -> Vec<ImportViolation>
    where
        F: Fn(&Path, &str) -> Vec<(String, String)>,
    {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = manifest_dir.join(dir);
        if !root.exists() {
            return Vec::new();
        }

        let mut violations = Vec::new();
        for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
            if !entry.file_type().is_file() {
                continue;
            }
            if entry.path().extension().and_then(|ext| ext.to_str()) != Some("rs") {
                continue;
            }

            let imports = extract_imports_from_file(entry.path());
            if imports.is_empty() {
                continue;
            }

            let relative_file = entry
                .path()
                .strip_prefix(manifest_dir)
                .unwrap_or_else(|_| entry.path())
                .to_path_buf();

            for import in imports {
                for (import_display, reason) in predicate(entry.path(), &import) {
                    violations.push(ImportViolation {
                        file: relative_file.clone(),
                        import: import_display,
                        reason,
                    });
                }
            }
        }

        violations
    }

    pub fn format_violation_report(title: &str, violations: &[ImportViolation]) -> String {
        let mut report = String::new();
        report.push_str("Domain Isolation Violations:\n\n");

        use std::fmt::Write as _;

        for violation in violations {
            let _ = writeln!(report, "[{}]", title);
            let _ = writeln!(report, "  File: {}", violation.file.display());
            let _ = writeln!(report, "  Import: {}", violation.import);
            let _ = writeln!(report, "  Reason: {}\n", violation.reason);
        }

        let _ = write!(report, "Total violations: {}", violations.len());
        report
    }

    pub fn validate_cross_domain_import(
        path: &Path,
        import: &str,
        allowlist: &[(&str, &str)],
    ) -> Vec<(String, String)> {
        let Some(source_domain) = get_domain_from_path(path) else {
            return Vec::new();
        };

        static DOMAIN_REGEX: OnceLock<Regex> = OnceLock::new();
        let regex = DOMAIN_REGEX.get_or_init(|| Regex::new(r"domains::([a-z_]+)").unwrap());

        let mut seen = HashSet::new();
        let mut violations = Vec::new();

        for caps in regex.captures_iter(import) {
            let full_match = caps.get(0).unwrap().as_str();
            if !seen.insert(full_match.to_string()) {
                continue;
            }

            let target_domain = caps.get(1).unwrap().as_str();
            if target_domain == source_domain {
                continue;
            }

            if allowlist
                .iter()
                .any(|(src, dst)| *src == source_domain && *dst == target_domain)
            {
                continue;
            }

            let import_display = format!("crate::{}", full_match);
            let reason = format!(
                "{} → {} cross-domain import not allowed",
                source_domain, target_domain
            );

            violations.push((import_display, reason));
        }

        violations
    }

    pub fn validate_legacy_import(
        path: &Path,
        import: &str,
        exceptions: &[(&str, &str)],
    ) -> Vec<(String, String)> {
        if !import.contains("schaltwerk_core") {
            return Vec::new();
        }

        if is_exception(path, import, exceptions) {
            return Vec::new();
        }

        vec![(
            import.to_string(),
            "Domain imports legacy schaltwerk_core module".to_string(),
        )]
    }

    pub fn validate_layering(
        path: &Path,
        import: &str,
        blocklist: &[&str],
    ) -> Vec<(String, String)> {
        if get_domain_from_path(path).is_none() {
            return Vec::new();
        }

        static BLOCK_REGEX: OnceLock<Regex> = OnceLock::new();
        let regex = BLOCK_REGEX
            .get_or_init(|| Regex::new(r"crate::(commands|services)::[A-Za-z0-9_]+").unwrap());

        let mut seen = HashSet::new();
        let mut violations = Vec::new();

        for caps in regex.captures_iter(import) {
            let module = caps.get(1).unwrap().as_str();
            if !blocklist.contains(&module) {
                continue;
            }

            let full_match = caps.get(0).unwrap().as_str();
            if !seen.insert(full_match.to_string()) {
                continue;
            }

            let import_display = full_match.to_string();
            let source_domain = get_domain_from_path(path).unwrap();
            let reason = format!(
                "{} imports {} layering violation",
                source_domain, module
            );

            violations.push((import_display, reason));
        }

        violations
    }

    fn extract_imports_from_file(path: &Path) -> Vec<String> {
        let content = match fs::read_to_string(path) {
            Ok(content) => content,
            Err(_) => return Vec::new(),
        };

        static USE_REGEX: OnceLock<Regex> = OnceLock::new();
        let regex = USE_REGEX
            .get_or_init(|| Regex::new(r"(?s)use\s+crate::([^;]+);").unwrap());

        regex
            .captures_iter(&content)
            .map(|caps| normalize_use_statement(caps.get(1).unwrap().as_str()))
            .collect()
    }

    fn normalize_use_statement(body: &str) -> String {
        let mut statement = String::from("use crate::");
        statement.push_str(body.trim());
        statement.push(';');

        statement
            .lines()
            .map(|line| line.trim())
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn get_domain_from_path(path: &Path) -> Option<String> {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let relative = path.strip_prefix(manifest_dir).ok()?;

        let mut components = relative.components();

        while let Some(component) = components.next() {
            match component {
                Component::Normal(name) if name == "src" => {
                    if let Some(Component::Normal(domains)) = components.next() {
                        if domains == "domains" {
                            if let Some(Component::Normal(domain)) = components.next() {
                                return Some(domain.to_string_lossy().to_string());
                            }
                        }
                    }
                }
                Component::Normal(name) if name == "domains" => {
                    if let Some(Component::Normal(domain)) = components.next() {
                        return Some(domain.to_string_lossy().to_string());
                    }
                }
                _ => continue,
            }
        }

        None
    }

    fn relative_domain_path(path: &Path) -> Option<String> {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let relative = path.strip_prefix(manifest_dir).ok()?;
        let mut components = relative.components();

        match (components.next(), components.next()) {
            (Some(Component::Normal(first)), Some(Component::Normal(second)))
                if first == "src" && second == "domains" => {}
            (Some(Component::Normal(first)), _) if first == "domains" => {}
            _ => return None,
        }

        let mut path_buf = PathBuf::new();
        for component in relative.components() {
            if let Component::Normal(part) = component {
                if part == "src" {
                    continue;
                }
                path_buf.push(part);
            }
        }

        Some(path_buf.to_string_lossy().replace('\\', "/"))
    }

    fn is_exception(path: &Path, import: &str, exceptions: &[(&str, &str)]) -> bool {
        let Some(relative_file) = relative_domain_path(path) else {
            return false;
        };

        exceptions.iter().any(|(file, pattern)| {
            *file == relative_file && import.contains(pattern)
        })
    }
}
