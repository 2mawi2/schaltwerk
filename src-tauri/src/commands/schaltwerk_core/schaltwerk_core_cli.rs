// Normalize user-provided CLI text copied from rich sources:
// - Replace Unicode dash-like characters with ASCII '-'
// - Replace various Unicode spaces (including NBSP) with ASCII ' '
pub fn normalize_cli_text(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            // Dashes
            '\u{2010}' /* HYPHEN */
            | '\u{2011}' /* NON-BREAKING HYPHEN */
            | '\u{2012}' /* FIGURE DASH */
            | '\u{2013}' /* EN DASH */
            | '\u{2014}' /* EM DASH */
            | '\u{2015}' /* HORIZONTAL BAR */
            | '\u{2212}' /* MINUS SIGN */ => '-',
            // Spaces
            '\u{00A0}' /* NBSP */
            | '\u{2000}'..='\u{200B}' /* En/Em/Thin spaces incl. ZWSP */
            | '\u{202F}' /* NNBSP */
            | '\u{205F}' /* MMSP */
            | '\u{3000}' /* IDEOGRAPHIC SPACE */ => ' ',
            _ => c,
        })
        .collect()
}

// For Codex, detect and extract a trailing prompt without
// accidentally consuming flag values (e.g., sandbox mode).
// Returns Some(prompt) if a prompt was extracted, otherwise None.
// Table-driven predicates for Codex flags (kept minimal; expand here when Codex adds flags)
const MODEL_FLAGS: [&str; 2] = ["--model", "-m"];
const PROFILE_FLAGS: [&str; 2] = ["--profile", "-p"];
const CONFIG_FLAGS: [&str; 2] = ["--config", "-c"];
const SANDBOX_FLAGS: [&str; 1] = ["--sandbox"]; // value required

#[inline]
fn is_flag_with_value(s: &str) -> bool {
    MODEL_FLAGS.contains(&s)
        || PROFILE_FLAGS.contains(&s)
        || CONFIG_FLAGS.contains(&s)
        || SANDBOX_FLAGS.contains(&s)
}

#[inline]
fn is_model_flag_token(s: &str) -> bool {
    s == "--model" || s == "-m"
}
#[inline]
fn is_model_eq_token(s: &str) -> bool {
    s.starts_with("--model=") || s.starts_with("-m=")
}

pub fn extract_codex_prompt_if_present(args: &mut Vec<String>) -> Option<String> {
    if args.is_empty() {
        return None;
    }
    // If last token is a flag itself, it's not a prompt
    if args.last().map(|s| s.starts_with('-')).unwrap_or(false) {
        return None;
    }
    // If the previous token is a flag that takes a value, the last token is that value,
    // not a prompt. Keep this list minimal but sufficient for our usage.
    if args.len() >= 2 {
        let prev = args[args.len() - 2].as_str();
        if is_flag_with_value(prev) {
            return None;
        }
    }
    args.pop()
}

// Turn accidental single-dash long options into proper double-dash for Codex
// Only affects known long flags: model, profile, search. Keeps true short flags intact.
pub fn fix_codex_single_dash_long_flags(args: &mut [String]) {
    for a in args.iter_mut() {
        if a.starts_with("--") {
            continue;
        }
        if let Some(stripped) = a.strip_prefix('-') {
            // Keep short flags like -m, -p, -v
            if stripped.len() == 1 {
                continue;
            }
            // Check name part (before optional '=')
            let (name, value_opt) = match stripped.split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (stripped, None),
            };
            // Treat accidental single-dash long options as double-dash for known long flags
            const NORMALIZE_LONGS: [&str; 3] = ["model", "profile", "search"];
            if NORMALIZE_LONGS.contains(&name) {
                if let Some(v) = value_opt {
                    *a = format!("--{name}={v}");
                } else {
                    *a = format!("--{name}");
                }
            }
        }
    }
}

// For Codex, ensure `--model`/`-m` appears after any `--profile`
pub fn reorder_codex_model_after_profile(args: &mut Vec<String>) {
    let mut without_model = Vec::with_capacity(args.len());
    let mut model_flags = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if is_model_flag_token(a) {
            // capture flag and its value if present
            model_flags.push(a.clone());
            if i + 1 < args.len() {
                model_flags.push(args[i + 1].clone());
                i += 2;
            } else {
                i += 1;
            }
        } else if is_model_eq_token(a) {
            model_flags.push(a.clone());
            i += 1;
        } else {
            without_model.push(a.clone());
            i += 1;
        }
    }
    without_model.extend(model_flags);
    *args = without_model;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_no_prompt_when_just_sandbox_pair() {
        let mut args = vec!["--sandbox".to_string(), "workspace-write".to_string()];
        let extracted = extract_codex_prompt_if_present(&mut args);
        assert!(extracted.is_none());
        assert_eq!(args, vec!["--sandbox", "workspace-write"]);
    }

    #[test]
    fn codex_extracts_prompt_when_present() {
        let mut args = vec![
            "--sandbox".to_string(),
            "workspace-write".to_string(),
            "do things".to_string(),
        ];
        let extracted = extract_codex_prompt_if_present(&mut args);
        assert_eq!(extracted.as_deref(), Some("do things"));
        assert_eq!(args, vec!["--sandbox", "workspace-write"]);
    }

    #[test]
    fn codex_does_not_consume_model_value_as_prompt() {
        let mut args = vec![
            "--sandbox".to_string(),
            "workspace-write".to_string(),
            "--model".to_string(),
            "o3".to_string(),
        ];
        let extracted = extract_codex_prompt_if_present(&mut args);
        assert!(extracted.is_none());
        assert_eq!(args, vec!["--sandbox", "workspace-write", "--model", "o3"]);
    }

    #[test]
    fn codex_does_not_consume_profile_value_as_prompt() {
        let mut args = vec![
            "--sandbox".to_string(),
            "workspace-write".to_string(),
            "-p".to_string(),
            "dev".to_string(),
        ];
        let extracted = extract_codex_prompt_if_present(&mut args);
        assert!(extracted.is_none());
        assert_eq!(args, vec!["--sandbox", "workspace-write", "-p", "dev"]);
    }

    #[test]
    fn codex_does_not_consume_config_value_as_prompt() {
        let mut args = vec![
            "--sandbox".to_string(),
            "workspace-write".to_string(),
            "-c".to_string(),
            "search=true".to_string(),
        ];
        let extracted = extract_codex_prompt_if_present(&mut args);
        assert!(extracted.is_none());
        assert_eq!(
            args,
            vec!["--sandbox", "workspace-write", "-c", "search=true"]
        );

        let mut args2 = vec![
            "--sandbox".to_string(),
            "workspace-write".to_string(),
            "--config".to_string(),
            "model=\"o3\"".to_string(),
        ];
        let extracted2 = extract_codex_prompt_if_present(&mut args2);
        assert!(extracted2.is_none());
        assert_eq!(
            args2,
            vec!["--sandbox", "workspace-write", "--config", "model=\"o3\""]
        );
    }

    #[test]
    fn test_fix_codex_single_dash_long_flags() {
        let mut args = vec!["-model".to_string(), "gpt-4".to_string()];
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["--model", "gpt-4"]);

        let mut args = vec!["-profile".to_string(), "work".to_string()];
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["--profile", "work"]);

        let mut args = vec!["-model=gpt-4".to_string()];
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["--model=gpt-4"]);

        let mut args = vec!["-m".to_string(), "o3".to_string()];
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["-m", "o3"]);

        let mut args = vec!["-p".to_string(), "work".to_string()];
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["-p", "work"]);

        let mut args = vec!["-search".to_string()];
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["--search"]);
    }

    #[test]
    fn test_fix_codex_single_dash_long_flags_edge_cases() {
        let mut args = vec!["-".to_string()];
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["-"]);

        let mut args = vec!["-?".to_string()];
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["-?"]);

        let mut args = vec!["-mm".to_string()];
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["-mm"]);

        let mut args = vec!["-m=foo".to_string()];
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["-m=foo"]);

        let unicode_dash = "\u{2014}search"; // EM DASH followed by search
        let mut args = vec![normalize_cli_text(unicode_dash)];
        // After normalize_cli_text, this will be "-search"
        fix_codex_single_dash_long_flags(&mut args);
        assert_eq!(args, vec!["--search"]);
    }

    #[test]
    fn test_reorder_codex_model_after_profile() {
        let mut args = vec![
            "--model".to_string(),
            "gpt-4".to_string(),
            "--profile".to_string(),
            "work".to_string(),
        ];
        reorder_codex_model_after_profile(&mut args);
        assert_eq!(args, vec!["--profile", "work", "--model", "gpt-4"]);

        let mut args = vec![
            "--model=gpt-4".to_string(),
            "--profile".to_string(),
            "work".to_string(),
        ];
        reorder_codex_model_after_profile(&mut args);
        assert_eq!(args, vec!["--profile", "work", "--model=gpt-4"]);

        let mut args = vec![
            "-m".to_string(),
            "o3".to_string(),
            "-p".to_string(),
            "dev".to_string(),
        ];
        reorder_codex_model_after_profile(&mut args);
        assert_eq!(args, vec!["-p", "dev", "-m", "o3"]);
    }

    #[test]
    fn test_reorder_codex_model_after_profile_edge_cases() {
        let mut args: Vec<String> = vec![];
        reorder_codex_model_after_profile(&mut args);
        assert!(args.is_empty());

        let mut args = vec!["--profile".to_string()];
        reorder_codex_model_after_profile(&mut args);
        assert_eq!(args, vec!["--profile"]);

        let mut args = vec!["--model".to_string()];
        reorder_codex_model_after_profile(&mut args);
        assert_eq!(args, vec!["--model"]);

        let mut args = vec!["-m".to_string()];
        reorder_codex_model_after_profile(&mut args);
        assert_eq!(args, vec!["-m"]);

        let mut args = vec![
            "--profile".to_string(),
            "work".to_string(),
            "--model".to_string(),
        ];
        reorder_codex_model_after_profile(&mut args);
        assert_eq!(args, vec!["--profile", "work", "--model"]);

        let mut args = vec!["-p".to_string(), "dev".to_string(), "-m".to_string()];
        reorder_codex_model_after_profile(&mut args);
        assert_eq!(args, vec!["-p", "dev", "-m"]);

        let mut args = vec![
            "--profile".to_string(),
            "work".to_string(),
            "-m".to_string(),
            "o3".to_string(),
            "--model".to_string(),
            "gpt-4".to_string(),
        ];
        // Also normalize single-dash long flags before reordering in real flows
        fix_codex_single_dash_long_flags(&mut args);
        reorder_codex_model_after_profile(&mut args);
        assert_eq!(
            args,
            vec!["--profile", "work", "-m", "o3", "--model", "gpt-4"]
        );
    }
}
