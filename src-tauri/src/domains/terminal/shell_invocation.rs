use super::get_effective_shell;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellInvocation {
    pub program: String,
    pub args: Vec<String>,
}

pub fn build_login_shell_invocation(command: &str) -> ShellInvocation {
    let (shell, base_args) = get_effective_shell();
    build_login_shell_invocation_with_shell(&shell, &base_args, command)
}

pub fn build_login_shell_invocation_with_shell(
    shell: &str,
    base_args: &[String],
    command: &str,
) -> ShellInvocation {
    let shell_kind = classify_shell(shell);
    let command_flag = command_flag(shell_kind);
    let mut args: Vec<String> = sanitize_base_args(base_args, command_flag);

    for flag in login_flags(shell_kind) {
        ensure_flag(&mut args, flag);
    }

    if let Some(flag) = command_flag {
        ensure_flag(&mut args, flag);
    }

    args.push(command.to_string());

    ShellInvocation {
        program: shell.to_string(),
        args,
    }
}

pub fn shell_invocation_to_posix(invocation: &ShellInvocation) -> String {
    let mut parts = Vec::with_capacity(invocation.args.len() + 1);
    parts.push(sh_quote_string(&invocation.program));
    for arg in &invocation.args {
        parts.push(sh_quote_string(arg));
    }
    parts.join(" ")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShellKind {
    BashLike,
    Fish,
    Nu,
    Tcsh,
    PowerShell,
    Unknown,
}

fn classify_shell(shell: &str) -> ShellKind {
    use ShellKind::*;
    let name = std::path::Path::new(shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(shell)
        .to_ascii_lowercase();

    match name.as_str() {
        "bash" | "zsh" | "ksh" | "sh" | "dash" | "ash" => BashLike,
        "fish" => Fish,
        "nu" | "nushell" => Nu,
        "tcsh" | "csh" => Tcsh,
        "pwsh" | "powershell" => PowerShell,
        _ => Unknown,
    }
}

fn login_flags(kind: ShellKind) -> &'static [&'static str] {
    use ShellKind::*;
    match kind {
        Nu => &["--login"],
        PowerShell => &["-Login"],
        BashLike | Fish | Tcsh | Unknown => &["-l"],
    }
}

fn command_flag(kind: ShellKind) -> Option<&'static str> {
    use ShellKind::*;
    match kind {
        PowerShell => Some("-Command"),
        _ => Some("-c"),
    }
}

fn sanitize_base_args(base_args: &[String], command_flag: Option<&str>) -> Vec<String> {
    if command_flag.is_none() {
        return base_args.to_vec();
    }

    let flag = command_flag.unwrap();
    let mut sanitized = Vec::with_capacity(base_args.len());
    let mut i = 0;
    while i < base_args.len() {
        let arg = &base_args[i];

        if flag == "-c" {
            if arg == flag {
                i += 1; // skip flag
                if i < base_args.len() {
                    i += 1; // skip user command
                }
                continue;
            }

            if arg.starts_with('-') && !arg.starts_with("--") {
                let mut cluster: Vec<char> = arg[1..].chars().collect();
                if cluster.contains(&'c') {
                    cluster.retain(|ch| *ch != 'c');
                    if !cluster.is_empty() {
                        let mut rebuilt = String::from("-");
                        for ch in cluster {
                            rebuilt.push(ch);
                        }
                        sanitized.push(rebuilt);
                    }
                    i += 1;
                    if i < base_args.len() {
                        i += 1; // skip user command argument
                    }
                    continue;
                }
            }
        } else if arg == flag {
            i += 1; // skip flag
            if i < base_args.len() {
                i += 1; // skip user command
            }
            continue;
        }

        sanitized.push(arg.clone());
        i += 1;
    }

    sanitized
}

fn ensure_flag(args: &mut Vec<String>, flag: &str) {
    if flag.starts_with("--") || flag.len() > 2 {
        if args.iter().any(|existing| existing == flag) {
            return;
        }
    } else if flag.starts_with('-') && flag.len() == 2 {
        let short = flag.chars().nth(1).unwrap();
        if args
            .iter()
            .any(|existing| short_flag_contains(existing, short))
        {
            return;
        }
    } else if args.iter().any(|existing| existing == flag) {
        return;
    }

    args.push(flag.to_string());
}

fn short_flag_contains(candidate: &str, flag: char) -> bool {
    if !candidate.starts_with('-') || candidate.starts_with("--") {
        return false;
    }

    let rest = &candidate[1..];
    if rest.is_empty() {
        return false;
    }

    if rest.len() == 1 {
        return rest.starts_with(flag);
    }

    if rest.chars().all(|ch| ch.is_ascii_alphabetic()) {
        return rest.chars().any(|ch| ch == flag);
    }

    false
}

pub fn sh_quote_string(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    let mut quoted = String::with_capacity(s.len() + 2);
    quoted.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            quoted.push_str("'\\''");
        } else {
            quoted.push(ch);
        }
    }
    quoted.push('\'');
    quoted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_vec(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn adds_login_flags_for_bash_like_shells() {
        let invocation =
            build_login_shell_invocation_with_shell("/bin/zsh", &[], "sh '/tmp/setup.sh'");
        assert_eq!(invocation.program, "/bin/zsh");
        assert_eq!(invocation.args, to_vec(&["-l", "-c", "sh '/tmp/setup.sh'"]));
    }

    #[test]
    fn preserves_existing_args_and_appends_needed_flags() {
        let invocation = build_login_shell_invocation_with_shell(
            "/bin/bash",
            &to_vec(&["-i"]),
            "sh '/tmp/setup.sh'",
        );
        assert_eq!(invocation.program, "/bin/bash");
        assert_eq!(
            invocation.args,
            to_vec(&["-i", "-l", "-c", "sh '/tmp/setup.sh'"])
        );
    }

    #[test]
    fn uses_fish_specific_flag_layout() {
        let invocation = build_login_shell_invocation_with_shell(
            "/usr/local/bin/fish",
            &[],
            "sh '/tmp/setup.sh'",
        );
        assert_eq!(invocation.program, "/usr/local/bin/fish");
        assert_eq!(invocation.args, to_vec(&["-l", "-c", "sh '/tmp/setup.sh'"]));
    }

    #[test]
    fn uses_nu_specific_flags() {
        let invocation =
            build_login_shell_invocation_with_shell("/usr/local/bin/nu", &[], "sh '/tmp/setup.sh'");
        assert_eq!(invocation.program, "/usr/local/bin/nu");
        assert_eq!(
            invocation.args,
            to_vec(&["--login", "-c", "sh '/tmp/setup.sh'"])
        );
    }

    #[test]
    fn replaces_existing_command_argument() {
        let invocation = build_login_shell_invocation_with_shell(
            "/bin/bash",
            &to_vec(&["-i", "-c", "tmux attach"]),
            "sh '/tmp/setup.sh'",
        );
        assert_eq!(invocation.program, "/bin/bash");
        assert_eq!(
            invocation.args,
            to_vec(&["-i", "-l", "-c", "sh '/tmp/setup.sh'"])
        );
    }

    #[test]
    fn handles_combined_short_flags() {
        let invocation = build_login_shell_invocation_with_shell(
            "/bin/zsh",
            &to_vec(&["-lc"]),
            "sh '/tmp/setup.sh'",
        );
        assert_eq!(invocation.program, "/bin/zsh");
        assert_eq!(invocation.args, to_vec(&["-l", "-c", "sh '/tmp/setup.sh'"]));
    }

    #[test]
    fn replaces_powershell_command_argument() {
        let invocation = build_login_shell_invocation_with_shell(
            "pwsh",
            &to_vec(&["-Login", "-Command", "Write-Host hi"]),
            "Write-Host 'setup'",
        );
        assert_eq!(invocation.program, "pwsh");
        assert_eq!(
            invocation.args,
            to_vec(&["-Login", "-Command", "Write-Host 'setup'"])
        );
    }

    #[test]
    fn converts_invocation_to_posix_string() {
        let invocation = ShellInvocation {
            program: "/bin/zsh".to_string(),
            args: to_vec(&["-l", "-c", "sh '/tmp/setup.sh'"]),
        };
        let expected = vec![
            sh_quote_string("/bin/zsh"),
            sh_quote_string("-l"),
            sh_quote_string("-c"),
            sh_quote_string("sh '/tmp/setup.sh'"),
        ]
        .join(" ");
        assert_eq!(shell_invocation_to_posix(&invocation), expected);
    }
}
