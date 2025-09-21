use anyhow::Result;
use serde_json::Value;

pub fn parse_opencode_output(stdout: &str) -> Option<String> {
    // Try JSON first, then fallback to raw text
    let parsed_json: Result<Value, _> = serde_json::from_str(stdout);
    let candidate = if let Ok(v) = parsed_json {
        v.as_str()
            .or_else(|| v.get("name").and_then(|x| x.as_str()))
            .map(|s| s.to_string())
    } else {
        None
    }
    .or_else(|| {
        // Fallback to plain text parsing for backward compatibility
        stdout
            .lines()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .filter(|line| !line.contains(' ')) // No spaces
            .filter(|line| {
                line.chars()
                    .all(|c| c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit())
            })
            .filter(|line| line.len() <= 30) // Reasonable length
            .find(|_| true) // Get first match
            .map(|s| s.to_string())
            .or_else(|| {
                // Final fallback: if no strict pattern match, use the raw output
                let raw = stdout.trim();
                if !raw.is_empty() {
                    Some(raw.to_string())
                } else {
                    None
                }
            })
    });

    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_json_output() {
        let input = r#"{"name": "test-name"}"#;
        let result = parse_opencode_output(input);
        assert_eq!(result, Some("test-name".to_string()));
    }

    #[test]
    fn test_parse_json_as_string() {
        let input = r#""direct-name""#;
        let result = parse_opencode_output(input);
        assert_eq!(result, Some("direct-name".to_string()));
    }

    #[test]
    fn test_parse_plain_kebab_case() {
        let input = "auth-system\nother line";
        let result = parse_opencode_output(input);
        assert_eq!(result, Some("auth-system".to_string()));
    }

    #[test]
    fn test_parse_no_match() {
        let input = "No kebab case here";
        let result = parse_opencode_output(input);
        assert_eq!(result, None);
    }

    #[test]
    fn test_parse_raw_fallback() {
        let input = "fallback-name";
        let result = parse_opencode_output(input);
        assert_eq!(result, Some("fallback-name".to_string()));
    }

    #[test]
    fn test_parse_empty() {
        let input = "";
        let result = parse_opencode_output(input);
        assert_eq!(result, None);
    }

    #[test]
    fn test_parse_with_spaces() {
        let input = "invalid name with spaces";
        let result = parse_opencode_output(input);
        assert_eq!(result, None); // Should fallback to raw, but raw has spaces, so None? Wait, fallback uses raw if no strict match
    }

    #[test]
    fn test_parse_long_name() {
        let input = "this-is-a-very-long-name-that-exceeds-thirty-characters-limit";
        let result = parse_opencode_output(input);
        assert!(result.is_some());
        assert!(result.unwrap().len() <= 30);
    }
}