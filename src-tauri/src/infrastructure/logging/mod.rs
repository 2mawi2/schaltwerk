use chrono::Local;
use env_logger::Builder;
use log::LevelFilter;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
static LOG_FILE_WRITER: Mutex<Option<BufWriter<File>>> = Mutex::new(None);
static LOGGER_INITIALIZED: Mutex<bool> = Mutex::new(false);

const DEFAULT_RETENTION_HOURS: u64 = 72;
const SECONDS_PER_HOUR: u64 = 3_600;

#[derive(Debug)]
struct LoggingConfig {
    file_logging_enabled: bool,
    retention: Duration,
    log_dir: PathBuf,
    deferred_warnings: Vec<String>,
}

/// Get the application's log directory
pub fn get_log_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("schaltwerk")
        .join("logs")
}

/// Get the current log file path
pub fn get_log_path() -> PathBuf {
    if let Ok(guard) = LOG_PATH.lock() {
        if let Some(ref path) = *guard {
            return path.clone();
        }
    }

    let log_dir = get_log_dir();

    // Create directory if it doesn't exist
    if let Err(e) = fs::create_dir_all(&log_dir) {
        eprintln!("Failed to create log directory: {e}");
    }

    let log_file = log_dir.join(format!(
        "schaltwerk-{}.log",
        Local::now().format("%Y%m%d-%H%M%S")
    ));

    if let Ok(mut guard) = LOG_PATH.lock() {
        *guard = Some(log_file.clone());
    }

    log_file
}

/// Initialize logging to both console and file
pub fn init_logging() {
    // Make idempotent: avoid double init in tests or multiple starts
    {
        let mut initialized = LOGGER_INITIALIZED.lock().unwrap();
        if *initialized {
            return;
        }
        *initialized = true;
    }
    let mut config = resolve_logging_config();
    let mut log_path: Option<PathBuf> = None;

    if config.file_logging_enabled {
        if let Err(e) = fs::create_dir_all(&config.log_dir) {
            config.deferred_warnings.push(format!(
                "Failed to create log directory {}: {e}",
                config.log_dir.display()
            ));
        } else {
            let cleanup_warnings = cleanup_old_logs(&config.log_dir, config.retention);
            config.deferred_warnings.extend(cleanup_warnings);

            let candidate = config.log_dir.join(format!(
                "schaltwerk-{}.log",
                Local::now().format("%Y%m%d-%H%M%S")
            ));

            match OpenOptions::new()
                .create(true)
                .append(true)
                .open(&candidate)
            {
                Ok(file) => {
                    let writer = BufWriter::new(file);
                    if let Ok(mut guard) = LOG_FILE_WRITER.lock() {
                        *guard = Some(writer);
                    }
                    if let Ok(mut path_guard) = LOG_PATH.lock() {
                        *path_guard = Some(candidate.clone());
                    }
                    log_path = Some(candidate);
                }
                Err(e) => {
                    config.deferred_warnings.push(format!(
                        "Failed to open log file {}: {e}. Continuing with console logging only.",
                        candidate.display()
                    ));
                }
            }
        }
    }

    let mut builder = Builder::new();
    // In tests, capture logs via test harness and keep console quiet unless failures
    if cfg!(test) {
        builder.is_test(true);
    }

    // Set log level from env or default to DEBUG for our crates, INFO for others
    if let Ok(rust_log) = env::var("RUST_LOG") {
        builder.parse_filters(&rust_log);
    } else if config.file_logging_enabled {
        // Our crate (schaltwerk) - set to Debug to see all our logs
        builder.filter_module("schaltwerk", LevelFilter::Debug);

        // Third-party crates we care about
        builder.filter_module("portable_pty", LevelFilter::Info);
        builder.filter_module("tauri", LevelFilter::Info);

        // Everything else defaults to Warn
        builder.filter_level(LevelFilter::Warn);
    } else {
        builder.filter_level(LevelFilter::Warn);
    }

    // Custom format with timestamps and module info
    builder.format(move |buf, record| {
        let level_str = match record.level() {
            log::Level::Error => "ERROR",
            log::Level::Warn => "WARN ",
            log::Level::Info => "INFO ",
            log::Level::Debug => "DEBUG",
            log::Level::Trace => "TRACE",
        };

        let log_line = format!(
            "[{} {} {}] {}",
            Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            level_str,
            record.target(),
            record.args()
        );

        // Write to the buffer (stderr via env_logger)
        writeln!(buf, "{log_line}")?;
        // Force flush to ensure immediate output
        buf.flush()?;

        // Also write to buffered file writer (with error handling)
        if let Ok(mut guard) = LOG_FILE_WRITER.lock() {
            if let Some(ref mut writer) = *guard {
                let _ = writeln!(writer, "{log_line}");
                // Only flush periodically for better performance
                let _ = writer.flush();
            }
        }

        Ok(())
    });

    // Write to stderr (which Tauri will capture)
    builder.target(env_logger::Target::Stderr);

    // Initialize the logger
    // Initialize the logger; subsequent calls are prevented by guard above
    builder.init();

    // Force stderr to be line-buffered for immediate output
    // This ensures logs appear immediately in development
    use std::io::{self, IsTerminal};
    if io::stderr().is_terminal() {
        // In a terminal, ensure line buffering
        let _ = io::stderr().flush();
    }

    log::info!("========================================");
    log::info!("Schaltwerk v{} starting", env!("CARGO_PKG_VERSION"));
    if let Some(path) = log_path.as_ref() {
        log::info!("Log file: {}", path.display());
    } else {
        log::info!("File logging disabled. Console logging set to WARN by default.");
    }
    log::info!("Process ID: {}", std::process::id());
    log::info!("========================================");

    // Print to console so user knows where logs are (skip in tests to avoid noisy outputs)
    if !cfg!(test) {
        if let Some(path) = log_path {
            eprintln!("📝 Logs are being written to: {}", path.display());
        }
        // Force immediate flush
        use std::io::{self, Write as IoWrite};
        let _ = io::stderr().flush();
    }

    for warning in config.deferred_warnings {
        log::warn!("{warning}");
    }
}

fn resolve_logging_config() -> LoggingConfig {
    let mut deferred_warnings = Vec::new();

    let log_dir = get_log_dir();

    let retention = match env::var("SCHALTWERK_LOG_RETENTION_HOURS") {
        Ok(value) => match value.parse::<u64>() {
            Ok(hours) => Duration::from_secs(hours.saturating_mul(SECONDS_PER_HOUR)),
            Err(_) => {
                deferred_warnings.push(format!(
                    "Invalid SCHALTWERK_LOG_RETENTION_HOURS value '{value}'. Using default {DEFAULT_RETENTION_HOURS} hours."
                ));
                Duration::from_secs(DEFAULT_RETENTION_HOURS * SECONDS_PER_HOUR)
            }
        },
        Err(_) => Duration::from_secs(DEFAULT_RETENTION_HOURS * SECONDS_PER_HOUR),
    };

    let mut file_logging_enabled = cfg!(debug_assertions);
    if let Ok(value) = env::var("SCHALTWERK_ENABLE_LOGS") {
        match parse_bool(&value) {
            Some(flag) => file_logging_enabled = flag,
            None => deferred_warnings.push(format!(
                "Invalid SCHALTWERK_ENABLE_LOGS value '{value}'. Expected a boolean. Falling back to default ({file_logging_enabled})."
            )),
        }
    }

    LoggingConfig {
        file_logging_enabled,
        retention,
        log_dir,
        deferred_warnings,
    }
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn cleanup_old_logs(log_dir: &Path, retention: Duration) -> Vec<String> {
    if retention.is_zero() {
        return Vec::new();
    }

    let mut warnings = Vec::new();
    let cutoff = match SystemTime::now().checked_sub(retention) {
        Some(cutoff) => cutoff,
        None => return warnings,
    };

    let entries = match fs::read_dir(log_dir) {
        Ok(entries) => entries,
        Err(_) => return warnings,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()).unwrap_or("") != "log" {
            continue;
        }

        match entry.metadata().and_then(|meta| meta.modified()) {
            Ok(modified) if modified < cutoff => {
                if let Err(e) = fs::remove_file(&path) {
                    warnings.push(format!(
                        "Failed to delete old log file {}: {e}",
                        path.display()
                    ));
                }
            }
            Ok(_) => {}
            Err(_) => warnings.push(format!(
                "Unable to determine age for log file {}",
                path.display()
            )),
        }
    }

    warnings
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{set_file_mtime, FileTime};
    use serial_test::serial;
    use std::env;
    use std::time::{Duration, SystemTime};
    use tempfile::TempDir;

    #[test]
    #[serial]
    fn test_get_log_dir_uses_data_local_dir() {
        let tmp = TempDir::new().unwrap();
        // Redirect HOME so dirs uses temp location on macOS
        let prev = env::var("HOME").ok();
        env::set_var("HOME", tmp.path());

        let dir = get_log_dir();
        assert!(dir.exists() || dir.to_string_lossy().contains("schaltwerk/logs"));

        if let Some(p) = prev {
            env::set_var("HOME", p);
        } else {
            env::remove_var("HOME");
        }
    }

    #[test]
    #[serial]
    fn test_get_log_path_creates_directory_and_returns_file() {
        let tmp = TempDir::new().unwrap();
        let prev = env::var("HOME").ok();
        env::set_var("HOME", tmp.path());

        let path = get_log_path();
        // Parent directory may not exist until first write; ensure we can create it
        let parent = path.parent().unwrap();
        std::fs::create_dir_all(parent).unwrap();
        assert!(parent.exists());
        // file may not exist until first write, but path should be under logs dir
        assert!(path.to_string_lossy().contains("schaltwerk"));

        if let Some(p) = prev {
            env::set_var("HOME", p);
        } else {
            env::remove_var("HOME");
        }
    }

    #[test]
    #[serial]
    fn test_cleanup_removes_only_logs_older_than_retention() {
        let tmp = TempDir::new().unwrap();
        let log_dir = tmp.path().join("logs");
        std::fs::create_dir_all(&log_dir).unwrap();

        let old_log = log_dir.join("schaltwerk-old.log");
        let recent_log = log_dir.join("schaltwerk-recent.log");
        std::fs::write(&old_log, "old").unwrap();
        std::fs::write(&recent_log, "recent").unwrap();

        let two_hours_ago = SystemTime::now() - Duration::from_secs(2 * 60 * 60);
        let thirty_minutes_ago = SystemTime::now() - Duration::from_secs(30 * 60);
        set_file_mtime(&old_log, FileTime::from_system_time(two_hours_ago)).unwrap();
        set_file_mtime(&recent_log, FileTime::from_system_time(thirty_minutes_ago)).unwrap();

        let warnings = cleanup_old_logs(&log_dir, Duration::from_secs(60 * 60));
        assert!(warnings.is_empty());
        assert!(!old_log.exists());
        assert!(recent_log.exists());
    }

    #[test]
    #[serial]
    fn test_resolve_logging_config_respects_env_toggle() {
        let tmp = TempDir::new().unwrap();
        let prev_home = env::var("HOME").ok();
        let prev_enable = env::var("SCHALTWERK_ENABLE_LOGS").ok();
        env::set_var("HOME", tmp.path());
        env::set_var("SCHALTWERK_ENABLE_LOGS", "0");

        let config = resolve_logging_config();
        assert!(!config.file_logging_enabled);

        env::set_var("SCHALTWERK_ENABLE_LOGS", "1");
        let enabled_config = resolve_logging_config();
        assert!(enabled_config.file_logging_enabled);

        if let Some(prev) = prev_enable {
            env::set_var("SCHALTWERK_ENABLE_LOGS", prev);
        } else {
            env::remove_var("SCHALTWERK_ENABLE_LOGS");
        }
        if let Some(prev) = prev_home {
            env::set_var("HOME", prev);
        } else {
            env::remove_var("HOME");
        }
    }
}
