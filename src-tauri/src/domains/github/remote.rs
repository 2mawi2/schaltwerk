use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubRemote {
    pub remote_name: String,
    pub owner: String,
    pub repo: String,
    pub host: String,
}

impl fmt::Display for GitHubRemote {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({}/{})", self.remote_name, self.owner, self.repo)
    }
}

pub fn parse_github_remote(remote_name: &str, url: &str) -> Option<GitHubRemote> {
    let trimmed = url.trim();

    let (host, owner, repo) = if let Some(rest) = trimmed.strip_prefix("git@") {
        // Format: git@github.com:owner/repo(.git)
        let mut parts = rest.splitn(2, ':');
        let host = parts.next()?.trim_matches('/');
        let path = parts.next()?;
        let mut segments = path.split('/');
        let owner = segments.next()?;
        let repo = segments.next()?;
        (host.to_string(), owner.to_string(), repo.to_string())
    } else if let Some(rest) = trimmed.strip_prefix("ssh://git@") {
        // Format: ssh://git@github.com/owner/repo(.git)
        let mut parts = rest.splitn(2, '/');
        let host = parts.next()?.trim_matches('/');
        let path = parts.next()?;
        let mut segments = path.split('/');
        let owner = segments.next()?;
        let repo = segments.next()?;
        (host.to_string(), owner.to_string(), repo.to_string())
    } else if let Some(rest) = trimmed.strip_prefix("https://") {
        // Format: https://github.com/owner/repo(.git)
        let mut segments = rest.split('/');
        let host = segments.next()?.trim_matches('/');
        let owner = segments.next()?;
        let repo = segments.next()?;
        (host.to_string(), owner.to_string(), repo.to_string())
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        let mut segments = rest.split('/');
        let host = segments.next()?.trim_matches('/');
        let owner = segments.next()?;
        let repo = segments.next()?;
        (host.to_string(), owner.to_string(), repo.to_string())
    } else {
        return None;
    };

    let host_lc = host.to_lowercase();
    if host_lc != "github.com" {
        return None;
    }

    let owner = owner.trim().to_string();
    let repo = repo.trim_end_matches(".git").trim_end_matches('/').trim().to_string();

    if repo.is_empty() || owner.is_empty() {
        return None;
    }

    Some(GitHubRemote {
        remote_name: remote_name.to_string(),
        owner,
        repo,
        host: host_lc,
    })
}

pub fn build_compare_url(remote: &GitHubRemote, base: &str, head: &str) -> String {
    let encoded_base = urlencoding::encode(base);
    let encoded_head = urlencoding::encode(head);

    format!(
        "https://{}/{}/{}/compare/{}...{}?expand=1&quick_pull=1",
        remote.host, remote.owner, remote.repo, encoded_base, encoded_head
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_https_github_remote() {
        let remote = parse_github_remote("origin", "https://github.com/acme/widgets.git");
        assert_eq!(
            remote,
            Some(GitHubRemote {
                remote_name: "origin".into(),
                owner: "acme".into(),
                repo: "widgets".into(),
                host: "github.com".into(),
            })
        );
    }

    #[test]
    fn parses_ssh_github_remote() {
        let remote = parse_github_remote("upstream", "git@github.com:octo/robot.git");
        assert_eq!(
            remote,
            Some(GitHubRemote {
                remote_name: "upstream".into(),
                owner: "octo".into(),
                repo: "robot".into(),
                host: "github.com".into(),
            })
        );
    }

    #[test]
    fn rejects_non_github_remote() {
        let remote = parse_github_remote("origin", "https://gitlab.com/acme/widgets.git");
        assert_eq!(remote, None);
    }

    #[test]
    fn builds_compare_url_with_encoded_branches() {
        let remote = GitHubRemote {
            remote_name: "origin".into(),
            owner: "octo".into(),
            repo: "robot".into(),
            host: "github.com".into(),
        };
        let url = build_compare_url(&remote, "main", "feature/awesome");
        assert_eq!(
            url,
            "https://github.com/octo/robot/compare/main...feature%2Fawesome?expand=1&quick_pull=1"
        );
    }
}
