use super::repository::get_default_branch;
use anyhow::{Context, Result, anyhow};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use url::Url;

#[derive(Debug)]
pub struct CloneOptions<'a> {
    pub remote_url: &'a str,
    pub parent_directory: &'a Path,
    pub folder_name: &'a str,
}

#[derive(Debug)]
pub struct CloneResult {
    pub project_path: PathBuf,
    pub default_branch: Option<String>,
    pub remote_display: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteMetadata {
    pub display: String,
    pub history_entry: String,
}

fn strip_git_suffix(path: &str) -> &str {
    path.trim_end_matches(".git").trim_end_matches('/')
}

fn sanitize_https_remote(mut parsed: Url) -> RemoteMetadata {
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);
    let history_entry = parsed.to_string();
    let display = parsed
        .host_str()
        .map(|host| {
            let path = strip_git_suffix(parsed.path());
            if path.is_empty() {
                host.to_string()
            } else {
                format!("{host}{path}")
            }
        })
        .unwrap_or_else(|| strip_git_suffix(parsed.as_str()).to_string());
    RemoteMetadata {
        display,
        history_entry,
    }
}

fn sanitize_ssh_remote(remote_url: &str) -> Option<RemoteMetadata> {
    let trimmed = remote_url.trim_start_matches("ssh://");
    let (user_host, path) = trimmed.split_once(':')?;
    let host = user_host
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(user_host);
    let normalized_path = strip_git_suffix(path);
    let display = if normalized_path.is_empty() {
        host.to_string()
    } else {
        format!("{host}/{}", normalized_path.trim_start_matches('/'))
    };
    Some(RemoteMetadata {
        display,
        history_entry: format!("git@{host}:{normalized_path}"),
    })
}

pub fn sanitize_remote(remote_url: &str) -> RemoteMetadata {
    if let Ok(parsed) = Url::parse(remote_url) {
        return sanitize_https_remote(parsed);
    }

    if let Some(ssh) = sanitize_ssh_remote(remote_url) {
        return ssh;
    }

    let fallback = strip_git_suffix(remote_url).to_string();
    RemoteMetadata {
        display: fallback.clone(),
        history_entry: fallback,
    }
}

fn ensure_parent_directory(parent: &Path) -> Result<()> {
    if !parent.exists() || !parent.is_dir() {
        return Err(anyhow!(
            "Parent directory does not exist or is not a directory: {}",
            parent.display()
        ));
    }
    Ok(())
}

fn ensure_destination_available(destination: &Path) -> Result<()> {
    if destination.exists() {
        return Err(anyhow!(
            "Destination directory already exists: {}",
            destination.display()
        ));
    }
    Ok(())
}

pub fn clone_repository<F>(options: &CloneOptions, mut on_progress: F) -> Result<CloneResult>
where
    F: FnMut(&str),
{
    if options.folder_name.contains('/') {
        return Err(anyhow!(
            "Folder name must not contain path separators: {}",
            options.folder_name
        ));
    }

    ensure_parent_directory(options.parent_directory)?;
    let destination = options.parent_directory.join(options.folder_name);
    ensure_destination_available(&destination)?;

    let destination_str = destination
        .to_str()
        .ok_or_else(|| anyhow!("Destination path contains invalid Unicode"))?;

    on_progress("Starting git clone...");

    // We intentionally shell out to the user's git binary so we can stream real-time clone progress
    // via `--progress`, which libgit2 does not expose through our existing bindings.
    let mut child = Command::new("git")
        .args([
            "clone",
            "--origin",
            "origin",
            "--progress",
            options.remote_url,
            destination_str,
        ])
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .with_context(|| format!("Failed to spawn git clone for {}", options.remote_url))?;

    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                on_progress(trimmed);
            }
        }
    }

    let status = child
        .wait()
        .context("Failed to wait for git clone process to finish")?;

    if !status.success() {
        let _ = fs::remove_dir_all(&destination);
        return Err(anyhow!("git clone exited with status {status}"));
    }

    let default_branch = get_default_branch(&destination).ok();
    let metadata = sanitize_remote(options.remote_url);

    Ok(CloneResult {
        project_path: destination,
        default_branch,
        remote_display: metadata.display,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    fn setup_remote_repo() -> TempDir {
        let remote = TempDir::new().expect("remote temp dir");
        Command::new("git")
            .args(["init", "--initial-branch", "main"])
            .current_dir(remote.path())
            .status()
            .expect("git init");
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(remote.path())
            .status()
            .expect("git config email");
        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(remote.path())
            .status()
            .expect("git config name");
        std::fs::write(remote.path().join("README.md"), "# Sample").expect("write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(remote.path())
            .status()
            .expect("git add");
        Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(remote.path())
            .status()
            .expect("git commit");
        remote
    }

    #[test]
    fn sanitize_remote_url_strips_credentials() {
        let https = sanitize_remote("https://user:token@git.example.com/org/repo.git");
        assert_eq!(https.display, "git.example.com/org/repo");
        assert_eq!(https.history_entry, "https://git.example.com/org/repo.git");

        let ssh = sanitize_remote("git@github.com:mariusw/project.git");
        assert_eq!(ssh.display, "github.com/mariusw/project");
        assert_eq!(ssh.history_entry, "git@github.com:mariusw/project");
    }

    #[test]
    fn sanitize_remote_handles_non_urls() {
        let fallback = sanitize_remote("not-a-url");
        assert_eq!(fallback.display, "not-a-url");
        assert_eq!(fallback.history_entry, "not-a-url");
    }

    #[test]
    fn clone_repository_clones_local_repo() {
        let remote = setup_remote_repo();
        let parent = TempDir::new().expect("parent temp dir");

        let options = CloneOptions {
            remote_url: remote.path().to_str().unwrap(),
            parent_directory: parent.path(),
            folder_name: "cloned",
        };

        let result = clone_repository(&options, |_| {});
        assert!(result.is_ok(), "expected clone to succeed: {:?}", result);

        let result = result.unwrap();
        assert!(result.project_path.join(".git").exists());
        assert_eq!(result.default_branch.as_deref(), Some("main"));
        assert_eq!(result.remote_display, remote.path().to_string_lossy());
    }
}
