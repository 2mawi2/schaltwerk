use crate::domains::agents::parse_agent_command;

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
fn test_parse_agent_command_cursor_with_force_and_prompt() {
    let cmd = r#"cd /a/b && cursor-agent -f "implement \"feature\"""#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/a/b");
    assert_eq!(agent, "cursor-agent");
    assert_eq!(args, vec!["-f", "implement \"feature\""]);
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
fn test_parse_agent_command_gemini_with_prompt() {
    let cmd = r#"cd /tmp/work && gemini --yolo""#;
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
fn test_parse_agent_command_qwen_with_yolo() {
    let cmd = r#"cd /tmp/work && qwen --yolo"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "qwen");
    assert_eq!(args, vec!["--yolo"]);
}

#[test]
fn test_parse_agent_command_qwen_absolute_path() {
    let cmd = r#"cd /tmp/work && /usr/local/bin/qwen"#;
    let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
    assert_eq!(cwd, "/tmp/work");
    assert_eq!(agent, "/usr/local/bin/qwen");
    assert_eq!(args, Vec::<String>::new());
}
