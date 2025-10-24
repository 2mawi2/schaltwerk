use crate::domains::agents::{command_parser::normalize_cwd, parse_agent_command};

#[test]
fn test_parse_agent_command_claude_with_prompt() {
    let cmd = r#"cd /tmp/work && claude --dangerously-skip-permissions "do the thing""#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "claude");
    assert_eq!(args, vec!["--dangerously-skip-permissions", "do the thing"]);
}

#[test]
fn test_parse_agent_command_claude_resume() {
    let cmd = r#"cd /repo && claude -r "1234""#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/repo");
    assert_eq!(agent, "claude");
    assert_eq!(args, vec!["-r", "1234"]);
}

#[test]
fn test_parse_agent_command_invalid_format() {
    let cmd = "echo hi";
    let res = parse_agent_command(cmd);
    assert!(res.is_err());
}

#[test]
fn test_parse_agent_command_opencode_with_prompt_absolute() {
    let cmd = r#"cd /tmp/work && /opt/bin/opencode --prompt "hello world""#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "/opt/bin/opencode");
    assert_eq!(args, vec!["--prompt", "hello world"]);
}

#[test]
fn test_parse_agent_command_opencode_with_prompt_path() {
    let cmd = r#"cd /tmp/work && opencode --prompt "hello world""#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "opencode");
    assert_eq!(args, vec!["--prompt", "hello world"]);
}

#[test]
fn test_parse_agent_command_opencode_continue_absolute() {
    let cmd = r#"cd /repo && /opt/bin/opencode --continue"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/repo");
    assert_eq!(agent, "/opt/bin/opencode");
    assert_eq!(args, vec!["--continue"]);
}

#[test]
fn test_parse_agent_command_claude_absolute_path_with_spaces() {
    let cmd = r#"cd /repo && "/Applications/Claude Latest/bin/claude" --version"#;
    let result = parse_agent_command(cmd);
    assert!(
        result.is_ok(),
        "command should parse despite spaces in binary path: {cmd}"
    );

    let (cwd, agent, args) = result.unwrap();
    assert_eq!(cwd, "/repo");
    assert_eq!(agent, "/Applications/Claude Latest/bin/claude");
    assert_eq!(args, vec!["--version"]);
}

#[test]
fn test_parse_agent_command_gemini_with_prompt() {
    let cmd = r#"cd /tmp/work && gemini --yolo"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "gemini");
    assert_eq!(args, vec!["--yolo"]);
}

#[test]
fn test_parse_agent_command_gemini_resume() {
    let cmd = r#"cd /repo && gemini"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/repo");
    assert_eq!(agent, "gemini");
    assert_eq!(args, Vec::<String>::new());
}

#[test]
fn test_parse_agent_command_gemini_absolute_path() {
    let cmd = r#"cd /tmp/work && /usr/local/bin/gemini"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "/usr/local/bin/gemini");
    assert_eq!(args, Vec::<String>::new());
}

#[test]
fn test_parse_agent_command_opencode_with_double_ampersand_in_prompt() {
    // This test demonstrates the bug: prompts containing " && " break the parser
    let cmd = r#"cd /tmp/work && opencode --prompt "Scripts Configured && run mode active""#;
    let result = parse_agent_command(cmd);

    // This should succeed but currently fails with "Invalid command format"
    assert!(
        result.is_ok(),
        "Command with && in prompt should parse successfully"
    );

    let (cwd, agent, args) = result.unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "opencode");
    assert_eq!(
        args,
        vec!["--prompt", "Scripts Configured && run mode active"]
    );
}

#[test]
fn test_parse_agent_command_claude_with_double_ampersand_in_prompt() {
    // Another test case with claude agent
    let cmd = r#"cd /path/to/project && claude -d "Check A && B && C conditions""#;
    let result = parse_agent_command(cmd);

    assert!(
        result.is_ok(),
        "Command with multiple && in prompt should parse successfully"
    );

    let (cwd, agent, args) = result.unwrap();
    assert_eq!(cwd, "/path/to/project");
    assert_eq!(agent, "claude");
    assert_eq!(args, vec!["-d", "Check A && B && C conditions"]);
}

#[test]
fn test_parse_agent_command_codex_with_sandbox() {
    let cmd = r#"cd /tmp/work && codex --sandbox workspace-write "test prompt""#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "codex");
    assert_eq!(args, vec!["--sandbox", "workspace-write", "test prompt"]);
}

#[test]
fn test_parse_agent_command_codex_danger_mode() {
    let cmd = r#"cd /repo && codex --sandbox danger-full-access"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/repo");
    assert_eq!(agent, "codex");
    assert_eq!(args, vec!["--sandbox", "danger-full-access"]);
}

#[test]
fn test_parse_agent_command_rejects_unsupported_agent() {
    let cmd = r#"cd /a/b && cursor-agent -f "implement feature""#;
    let result = parse_agent_command(cmd);
    assert!(result.is_err());

    let qwen_cmd = r#"cd /tmp/work && qwen --yolo"#;
    let qwen_result = parse_agent_command(qwen_cmd);
    assert!(qwen_result.is_ok());
    let (cwd, agent, args) = qwen_result.unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "qwen");
    assert_eq!(args, vec!["--yolo"]);
}

#[test]
fn test_parse_agent_command_cwd_with_spaces() {
    let cmd = r#"cd "/path/with spaces" && claude --version"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/path/with spaces");
    assert_eq!(agent, "claude");
    assert_eq!(args, vec!["--version"]);
}

#[test]
fn test_parse_agent_command_amp_with_dangerously_allow_all() {
    let cmd = r#"cd /tmp/work && amp --dangerously-allow-all <<< 'implement feature'"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "amp");
    assert_eq!(
        args,
        vec!["--dangerously-allow-all", "<<<", "implement feature"]
    );
}

#[test]
fn test_parse_agent_command_amp_with_pipeline_prompt() {
    let cmd = r#"cd /tmp/work && echo "implement feature X" | amp --dangerously-allow-all"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "amp");
    assert_eq!(args, vec!["--dangerously-allow-all"]);
}

#[test]
fn test_parse_agent_command_amp_with_full_path_pipeline() {
    let cmd = r#"cd /tmp/work && echo "test prompt" | /usr/local/bin/amp"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "/usr/local/bin/amp");
    assert_eq!(args, Vec::<String>::new());
}

#[test]
fn test_normalize_cwd_strips_double_quotes() {
    let result = normalize_cwd("\"/path with spaces\"");
    assert_eq!(result, "/path with spaces");
}

#[test]
fn test_normalize_cwd_strips_single_quotes() {
    let result = normalize_cwd("'/another path'");
    assert_eq!(result, "/another path");
}

#[test]
fn test_normalize_cwd_preserves_unquoted() {
    let result = normalize_cwd("/simple/path");
    assert_eq!(result, "/simple/path");
}
