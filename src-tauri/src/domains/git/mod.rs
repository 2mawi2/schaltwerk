pub mod branches;
pub mod clone;
pub mod db_git_stats;
pub mod github_cli;
pub mod gitlab_cli;
pub mod history;
pub mod operations;
pub mod repository;
pub mod service;
pub mod stats;
pub mod worktrees;

#[cfg(test)]
mod tests;

pub use db_git_stats::*;
pub use service::*;

pub fn strip_ansi_codes(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for ch in chars.by_ref() {
                    if ch.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(ch);
        }
    }

    result
}
