use clap::Parser;
use std::path::PathBuf;

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Schaltwerk - An orchestrator for your agents
#[derive(Debug, Parser)]
#[command(
    name = "schaltwerk",
    about = "Schaltwerk - An orchestrator for your agents",
    version = VERSION,
    help_template = "\
{before-help}{name} {version}
{about-with-newline}
{usage-heading} {usage}

{all-args}{after-help}

EXAMPLES:
    schaltwerk                    # Open current directory
    schaltwerk /path/to/project   # Open specific project directory
    schaltwerk --version, -V      # Show version information
    schaltwerk --help, -h         # Show this help message
"
)]
pub struct Cli {
    /// Optional project directory to open. Defaults to current working directory if omitted.
    #[arg(value_name = "DIR")]
    pub dir: Option<PathBuf>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_from<I, T>(itr: I) -> Cli
    where
        I: IntoIterator<Item = T>,
        T: Into<std::ffi::OsString>,
    {
        let iter = std::iter::once(std::ffi::OsString::from("schaltwerk"))
            .chain(itr.into_iter().map(Into::into));
        Cli::parse_from(iter)
    }

    #[test]
    fn parses_no_args() {
        let cli = parse_from::<[&str; 0], &str>([]);
        assert!(cli.dir.is_none());
    }

    #[test]
    fn parses_positional_dir() {
        let cli = parse_from(["/tmp/repo"]);
        assert_eq!(cli.dir.as_deref(), Some(std::path::Path::new("/tmp/repo")));
    }

    #[test]
    fn version_consistent_with_tauri_conf() {
        use std::fs;
        use std::path::PathBuf;
        let conf_path: PathBuf = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let contents = fs::read_to_string(&conf_path)
            .expect("failed to read tauri.conf.json for version consistency check");
        let v: serde_json::Value =
            serde_json::from_str(&contents).expect("failed to parse tauri.conf.json as JSON");
        let tauri_version = v
            .get("version")
            .and_then(|x| x.as_str())
            .expect("missing 'version' in tauri.conf.json");
        assert_eq!(
            VERSION, tauri_version,
            "Rust crate version and tauri.conf.json version must match"
        );
    }

    #[test]
    fn help_template_contains_examples() {
        use clap::CommandFactory;
        let mut cmd = Cli::command();
        let help_text = cmd.render_help();
        let help_string = help_text.to_string();
        assert!(help_string.contains("EXAMPLES:"));
        assert!(help_string.contains("schaltwerk --version, -V"));
        assert!(help_string.contains("schaltwerk --help, -h"));
    }

    #[test]
    fn version_flag_triggers_display_version() {
        use clap::Parser;
        let err = Cli::try_parse_from(["schaltwerk", "--version"]).unwrap_err();
        assert_eq!(err.kind(), clap::error::ErrorKind::DisplayVersion);
    }
}
