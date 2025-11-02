use arch_test_utils::{
    check_content_in_directory, check_imports_in_directory, format_violation_report,
};

const LAYERING_EXCEPTIONS: &[(&str, &str, &str)] = &[];

const DATABASE_EXCEPTIONS: &[(&str, &str)] = &[];

const EVENT_EXCEPTIONS: &[(&str, &str)] = &[];

#[test]
fn commands_should_not_import_domains_directly() {
    let violations = check_imports_in_directory("src/commands", |path, import| {
        arch_test_utils::validate_commands_domains_layering(path, import, LAYERING_EXCEPTIONS)
    });

    assert!(
        violations.is_empty(),
        "{}",
        format_violation_report("Commands → Domains", &violations)
    );
}

#[test]
fn domains_should_not_import_commands_or_services() {
    let violations = check_imports_in_directory("src/domains", |path, import| {
        arch_test_utils::validate_domains_upward_imports(path, import)
    });

    assert!(
        violations.is_empty(),
        "{}",
        format_violation_report("Domains → Commands/Services", &violations)
    );
}

#[test]
fn services_should_not_import_commands() {
    let violations = check_imports_in_directory("src/services", |path, import| {
        arch_test_utils::validate_services_commands_layering(path, import)
    });

    assert!(
        violations.is_empty(),
        "{}",
        format_violation_report("Services → Commands", &violations)
    );
}

#[test]
fn services_should_not_use_rusqlite_directly() {
    let violations = check_imports_in_directory("src/services", |path, import| {
        arch_test_utils::validate_rusqlite_usage_in_services(path, import, DATABASE_EXCEPTIONS)
    });

    let violations_in_domain_services =
        check_imports_in_directory("src/domains", |path, import| {
            if !path.ends_with("service.rs") {
                return Vec::new();
            }
            arch_test_utils::validate_rusqlite_usage_in_services(path, import, DATABASE_EXCEPTIONS)
        });

    let mut all_violations = violations;
    all_violations.extend(violations_in_domain_services);

    assert!(
        all_violations.is_empty(),
        "{}",
        format_violation_report("Services → Rusqlite", &all_violations)
    );
}

#[test]
fn only_repository_layer_can_use_rusqlite() {
    let violations = check_imports_in_directory("src", |path, import| {
        arch_test_utils::validate_rusqlite_restricted_usage(path, import)
    });

    assert!(
        violations.is_empty(),
        "{}",
        format_violation_report("Rusqlite Usage", &violations)
    );
}

#[test]
fn no_string_literal_event_names() {
    let violations = check_content_in_directory("src", |path, content| {
        arch_test_utils::validate_event_system_usage(path, content, EVENT_EXCEPTIONS)
    });

    assert!(
        violations.is_empty(),
        "{}",
        format_violation_report("Event String Literals", &violations)
    );
}

mod arch_test_utils {
    use regex::Regex;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;
    use walkdir::WalkDir;

    pub struct ImportViolation {
        pub file: PathBuf,
        pub import: String,
        pub reason: String,
    }

    pub fn check_imports_in_directory<F>(dir: &str, predicate: F) -> Vec<ImportViolation>
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

            let imports = extract_imports(entry.path());
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

    pub fn check_content_in_directory<F>(dir: &str, predicate: F) -> Vec<ImportViolation>
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

            let Ok(content) = fs::read_to_string(entry.path()) else {
                continue;
            };

            let relative_file = entry
                .path()
                .strip_prefix(manifest_dir)
                .unwrap_or_else(|_| entry.path())
                .to_path_buf();

            for (pattern, reason) in predicate(entry.path(), &content) {
                violations.push(ImportViolation {
                    file: relative_file.clone(),
                    import: pattern,
                    reason,
                });
            }
        }

        violations
    }

    pub fn format_violation_report(title: &str, violations: &[ImportViolation]) -> String {
        let mut report = String::new();
        report.push_str("Architecture Violations:\n\n");

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

    pub fn validate_commands_domains_layering(
        path: &Path,
        import: &str,
        exceptions: &[(&str, &str, &str)],
    ) -> Vec<(String, String)> {
        if !import.contains("domains::") {
            return Vec::new();
        }

        if import.contains("::service") {
            return Vec::new();
        }

        if is_layering_exception(path, import, exceptions) {
            return Vec::new();
        }

        vec![(
            import.to_string(),
            "Commands should use services, not domains directly".to_string(),
        )]
    }

    pub fn validate_domains_upward_imports(_path: &Path, import: &str) -> Vec<(String, String)> {
        let mut violations = Vec::new();

        if import.contains("crate::commands::") {
            violations.push((
                import.to_string(),
                "Domains cannot depend on commands (layering inversion)".to_string(),
            ));
        }

        if import.contains("crate::services::") {
            violations.push((
                import.to_string(),
                "Domains cannot depend on services (layering inversion)".to_string(),
            ));
        }

        violations
    }

    pub fn validate_services_commands_layering(
        _path: &Path,
        import: &str,
    ) -> Vec<(String, String)> {
        if !import.contains("crate::commands::") {
            return Vec::new();
        }

        vec![(
            import.to_string(),
            "Services cannot depend on commands (layering inversion)".to_string(),
        )]
    }

    pub fn validate_rusqlite_usage_in_services(
        path: &Path,
        import: &str,
        exceptions: &[(&str, &str)],
    ) -> Vec<(String, String)> {
        if !import.contains("rusqlite::") {
            return Vec::new();
        }

        if is_database_exception(path, exceptions) {
            return Vec::new();
        }

        vec![(
            import.to_string(),
            "Services should use repository traits, not rusqlite directly".to_string(),
        )]
    }

    pub fn validate_rusqlite_restricted_usage(path: &Path, import: &str) -> Vec<(String, String)> {
        if !import.contains("rusqlite::") {
            return Vec::new();
        }

        if is_repository_file(path) {
            return Vec::new();
        }

        vec![(
            import.to_string(),
            "Only repository layer and infrastructure can use rusqlite directly".to_string(),
        )]
    }

    pub fn validate_event_system_usage(
        path: &Path,
        content: &str,
        exceptions: &[(&str, &str)],
    ) -> Vec<(String, String)> {
        if is_events_module(path) {
            return Vec::new();
        }

        if is_event_exception(path, exceptions) {
            return Vec::new();
        }

        static EMIT_REGEX: OnceLock<Regex> = OnceLock::new();
        let regex = EMIT_REGEX
            .get_or_init(|| Regex::new(r#"(?:app|handle)\.emit\s*\(\s*"([^"]+)""#).unwrap());

        let mut violations = Vec::new();

        for caps in regex.captures_iter(content) {
            let event_name = caps.get(1).unwrap().as_str();

            if event_name.starts_with("schaltwerk:") {
                violations.push((
                    format!("app.emit(\"{}\")", event_name),
                    format!(
                        "Use emit_event(&app, SchaltEvent::*, ...) instead of string literal \"{}\"",
                        event_name
                    ),
                ));
            }
        }

        violations
    }

    fn extract_imports(path: &Path) -> Vec<String> {
        let content = match fs::read_to_string(path) {
            Ok(content) => content,
            Err(_) => return Vec::new(),
        };

        static USE_REGEX: OnceLock<Regex> = OnceLock::new();
        let regex = USE_REGEX.get_or_init(|| Regex::new(r"(?s)use\s+([^;]+);").unwrap());

        regex
            .captures_iter(&content)
            .map(|caps| {
                let statement = caps.get(1).unwrap().as_str();
                normalize_use_statement(statement)
            })
            .collect()
    }

    fn normalize_use_statement(body: &str) -> String {
        let mut statement = String::from("use ");
        statement.push_str(body.trim());
        statement.push(';');

        statement
            .lines()
            .map(|line| line.trim())
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn is_repository_file(path: &Path) -> bool {
        let path_str = path.to_string_lossy();

        path.ends_with("repository.rs")
            || path_str.contains("infrastructure/database")
            || path_str.contains("/db_")
            || path_str.contains("\\db_")
    }

    fn is_events_module(path: &Path) -> bool {
        path.ends_with("events.rs") || path.to_string_lossy().contains("infrastructure/events")
    }

    fn relative_path_str(path: &Path) -> Option<String> {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let relative = path.strip_prefix(manifest_dir).ok()?;
        Some(relative.to_string_lossy().replace('\\', "/"))
    }

    fn is_layering_exception(path: &Path, import: &str, exceptions: &[(&str, &str, &str)]) -> bool {
        let Some(relative_file) = relative_path_str(path) else {
            return false;
        };

        exceptions.iter().any(|(file, pattern, _reason)| {
            relative_file.contains(file) && import.contains(pattern)
        })
    }

    fn is_database_exception(path: &Path, exceptions: &[(&str, &str)]) -> bool {
        let Some(relative_file) = relative_path_str(path) else {
            return false;
        };

        exceptions
            .iter()
            .any(|(file, _reason)| relative_file.contains(file))
    }

    fn is_event_exception(path: &Path, exceptions: &[(&str, &str)]) -> bool {
        let Some(relative_file) = relative_path_str(path) else {
            return false;
        };

        exceptions
            .iter()
            .any(|(file, _reason)| relative_file.contains(file))
    }
}
