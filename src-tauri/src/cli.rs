use clap::Parser;
use std::path::PathBuf;

/// Schaltwerk - An orchestrator for your agents
#[derive(Debug, Parser)]
#[command(
    name = "schaltwerk",
    about = "Schaltwerk - An orchestrator for your agents"
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
}
