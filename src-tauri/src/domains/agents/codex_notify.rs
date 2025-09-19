use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static TOKEN_REGISTRY: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static WEBHOOK_PORT: OnceLock<Mutex<Option<u16>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, String>> {
    TOKEN_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn port_cell() -> &'static Mutex<Option<u16>> {
    WEBHOOK_PORT.get_or_init(|| Mutex::new(None))
}

pub fn generate_session_token(session: &str) -> String {
    use rand::{distr::Alphanumeric, rng, Rng};

    let mut rng = rng();
    let token: String = (&mut rng)
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let mut map = registry().lock().expect("token registry poisoned");
    map.insert(session.to_string(), token.clone());
    token
}

pub fn validate_session_token(session: &str, token: &str) -> bool {
    let map = registry().lock().expect("token registry poisoned");
    map.get(session).is_some_and(|stored| stored == token)
}

pub fn consume_session_token(session: &str, token: &str) -> bool {
    let mut map = registry().lock().expect("token registry poisoned");
    if map.get(session).is_some_and(|stored| stored == token) {
        map.remove(session);
        true
    } else {
        false
    }
}

pub fn has_session_token(session: &str) -> bool {
    let map = registry().lock().expect("token registry poisoned");
    map.contains_key(session)
}

pub fn clear_session_token(session: &str) {
    let mut map = registry().lock().expect("token registry poisoned");
    map.remove(session);
}

pub fn set_webhook_port(port: u16) {
    let mut cell = port_cell().lock().expect("webhook port mutex poisoned");
    *cell = Some(port);
}

pub fn get_webhook_port() -> Option<u16> {
    let cell = port_cell().lock().expect("webhook port mutex poisoned");
    *cell
}

pub fn parse_session_name_from_terminal(id: &str) -> Option<String> {
    const PREFIX: &str = "session-";
    if !id.starts_with(PREFIX) {
        return None;
    }
    let rest = &id[PREFIX.len()..];
    let mut parts = rest.rsplitn(2, '-');
    let suffix = parts.next()?;
    if suffix != "top" && suffix != "bottom" {
        return None;
    }
    let name = parts.next()?.to_string();
    if name.is_empty() {
        return None;
    }
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_are_unique_per_session() {
        let token_a = generate_session_token("session-a");
        let token_b = generate_session_token("session-b");
        assert_ne!(token_a, token_b);
        assert!(validate_session_token("session-a", &token_a));
        assert!(validate_session_token("session-b", &token_b));
    }

    #[test]
    fn validation_fails_after_clear() {
        let token = generate_session_token("session-clear");
        assert!(validate_session_token("session-clear", &token));
        clear_session_token("session-clear");
        assert!(!validate_session_token("session-clear", &token));
        assert!(!has_session_token("session-clear"));
    }

    #[test]
    fn consume_session_token_removes_entry() {
        let session = "session-consume";
        let token = generate_session_token(session);
        assert!(validate_session_token(session, &token));
        assert!(consume_session_token(session, &token));
        assert!(!consume_session_token(session, &token));
        assert!(!validate_session_token(session, &token));
        assert!(!has_session_token(session));
    }

    #[test]
    fn webhook_port_round_trip() {
        set_webhook_port(9000);
        assert_eq!(get_webhook_port(), Some(9000));
    }

    #[test]
    fn parse_session_name() {
        assert_eq!(
            parse_session_name_from_terminal("session-demo-top"),
            Some("demo".to_string())
        );
        assert_eq!(
            parse_session_name_from_terminal("session-demo-feature-bottom"),
            Some("demo-feature".to_string())
        );
        assert_eq!(parse_session_name_from_terminal("orchestrator-top"), None);
    }
}
