const FNV_OFFSET_BASIS: u32 = 0x811c9dc5;
const FNV_PRIME: u32 = 0x0100_0193;
const HASH_SLICE: usize = 6;

pub fn sanitize_session_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

pub fn session_terminal_hash(name: &str) -> u32 {
    let mut hash = FNV_OFFSET_BASIS;
    for unit in name.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

pub fn session_terminal_hash_fragment(name: &str) -> String {
    let hash_hex = format!("{:08x}", session_terminal_hash(name));
    hash_hex[..HASH_SLICE].to_string()
}

pub fn session_terminal_base(name: &str) -> String {
    let sanitized = sanitize_session_name(name);
    let fragment = session_terminal_hash_fragment(name);
    format!("session-{sanitized}~{fragment}")
}

pub fn terminal_id_for_session_top(name: &str) -> String {
    format!("{}-top", session_terminal_base(name))
}

pub fn terminal_id_for_session_bottom(name: &str) -> String {
    format!("{}-bottom", session_terminal_base(name))
}

pub fn legacy_terminal_id_for_session_top(name: &str) -> String {
    format!("session-{}-top", sanitize_session_name(name))
}

pub fn legacy_terminal_id_for_session_bottom(name: &str) -> String {
    format!("session-{}-bottom", sanitize_session_name(name))
}

pub fn previous_hashed_terminal_id_for_session_top(name: &str) -> String {
    let sanitized = sanitize_session_name(name);
    let fragment = session_terminal_hash_fragment(name);
    format!("session-{sanitized}-{fragment}-top")
}

pub fn previous_hashed_terminal_id_for_session_bottom(name: &str) -> String {
    let sanitized = sanitize_session_name(name);
    let fragment = session_terminal_hash_fragment(name);
    format!("session-{sanitized}-{fragment}-bottom")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_session_name_and_handles_empty() {
        assert_eq!(sanitize_session_name("alpha beta"), "alpha_beta");
        assert_eq!(sanitize_session_name("////"), "____");
        assert_eq!(sanitize_session_name(""), "unknown");
    }

    #[test]
    fn stable_hash_fragment_is_consistent() {
        let fragment_a = session_terminal_hash_fragment("alpha beta");
        let fragment_b = session_terminal_hash_fragment("alpha beta");
        assert_eq!(fragment_a, fragment_b);
    }

    #[test]
    fn base_and_terminal_ids_include_tilde_hash() {
        let base = session_terminal_base("alpha beta");
        assert!(base.starts_with("session-alpha_beta~"));
        let top = terminal_id_for_session_top("alpha beta");
        assert_eq!(format!("{base}-top"), top);
        let bottom = terminal_id_for_session_bottom("alpha beta");
        assert_eq!(format!("{base}-bottom"), bottom);
    }

    #[test]
    fn distinct_inputs_produce_distinct_ids_even_when_sanitized_same() {
        assert_eq!(
            sanitize_session_name("alpha beta"),
            sanitize_session_name("alpha?beta")
        );
        let top_a = terminal_id_for_session_top("alpha beta");
        let top_b = terminal_id_for_session_top("alpha?beta");
        assert_ne!(top_a, top_b);
    }

    #[test]
    fn legacy_and_previous_hash_helpers_match_expected_patterns() {
        assert!(legacy_terminal_id_for_session_top("alpha beta").starts_with("session-alpha_beta-"));
        assert!(previous_hashed_terminal_id_for_session_top("alpha beta")
            .starts_with("session-alpha_beta-"));
    }
}
