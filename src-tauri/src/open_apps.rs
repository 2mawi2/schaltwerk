use crate::schaltwerk_core::db_app_config::AppConfigMethods;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_kinds_are_valid() {
        let apps = detect_available_apps();
        for app in apps {
            assert!(
                app.kind == "system" || app.kind == "terminal" || app.kind == "editor",
                "Invalid app kind: {}",
                app.kind
            );
        }
    }

    #[test]
    fn test_platform_specific_defaults() {
        let db = crate::schaltwerk_core::Database::new_in_memory().unwrap();
        let default = get_default_open_app_from_db(&db).unwrap();

        #[cfg(target_os = "macos")]
        assert_eq!(default, "finder");

        #[cfg(target_os = "linux")]
        assert_eq!(default, "nautilus");
    }

    #[test]
    fn test_default_open_app_roundtrip_in_db() {
        let db = crate::schaltwerk_core::Database::new_in_memory()
            .expect("failed to create in-memory db");

        let default = get_default_open_app_from_db(&db).expect("failed to read default open app");

        #[cfg(target_os = "macos")]
        assert_eq!(default, "finder");

        #[cfg(target_os = "linux")]
        assert_eq!(default, "nautilus");

        set_default_open_app_in_db(&db, "vscode").expect("failed to persist default open app");

        let updated =
            get_default_open_app_from_db(&db).expect("failed to read updated default open app");
        assert_eq!(updated, "vscode");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_resolve_request_sets_terminal_parent_for_files() {
        let req = resolve_request("/repo/root", Some("src/main.rs"), Some(10), None)
            .expect("resolve should succeed");
        assert_eq!(req.terminal_workdir, PathBuf::from("/repo/root/src"));
        let target = req.target.expect("target should exist");
        assert!(target.is_file);
        assert_eq!(
            target.absolute_path,
            PathBuf::from("/repo/root/src/main.rs")
        );
        assert_eq!(target.line, Some(10));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_build_command_for_vscode_with_goto() {
        let req = resolve_request("/repo/root", Some("src/main.rs"), Some(12), Some(3))
            .expect("resolve should succeed");
        let spec = build_command_macos("code", &req).expect("build should succeed");
        assert_eq!(spec.program, "code");
        assert_eq!(spec.working_dir, Some(PathBuf::from("/repo/root")));
        assert!(spec.args.contains(&"--reuse-window".into()));
        assert!(spec.args.contains(&"--folder-uri".into()));
        assert!(
            spec.args
                .iter()
                .any(|arg| arg.starts_with("file:///repo/root"))
        );
        assert!(spec.args.contains(&"--goto".into()));
        assert!(
            spec.args
                .iter()
                .any(|arg| arg.ends_with("src/main.rs:12:3"))
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_build_command_for_intellij_root_only() {
        let req = resolve_request("/repo/root", None, None, None).expect("resolve should succeed");
        let spec = build_command_macos("idea", &req).expect("build should succeed");
        assert_eq!(spec.program, "idea");
        assert_eq!(spec.args, vec!["/repo/root"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_build_command_for_zed_with_root_and_file() {
        let req = resolve_request("/repo/root", Some("src/lib.rs"), Some(5), None)
            .expect("resolve should succeed");
        let spec = build_command_macos("zed", &req).expect("build should succeed");
        assert_eq!(spec.program, "zed");
        assert_eq!(
            spec.args,
            vec![
                "/repo/root".to_string(),
                "/repo/root/src/lib.rs:5".to_string()
            ]
        );
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OpenApp {
    pub id: String,   // e.g., "finder", "cursor", "vscode", "ghostty", "warp", "terminal"
    pub name: String, // Display name
    pub kind: String, // "editor" | "terminal" | "system"
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedTarget {
    pub absolute_path: PathBuf,
    pub is_file: bool,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedRequest {
    pub worktree_root: PathBuf,
    pub target: Option<ResolvedTarget>,
    pub terminal_workdir: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub working_dir: Option<PathBuf>,
}

fn detect_available_apps() -> Vec<OpenApp> {
    let mut apps = Vec::new();

    #[cfg(target_os = "macos")]
    {
        apps.push(OpenApp {
            id: "finder".into(),
            name: "Finder".into(),
            kind: "system".into(),
        });
        apps.extend(detect_macos_terminals());
    }

    #[cfg(target_os = "linux")]
    {
        apps.extend(detect_linux_file_managers());
        apps.extend(detect_linux_terminals());
    }

    // Cross-platform editors
    apps.extend(detect_editors());

    apps
}

#[cfg(target_os = "linux")]
fn detect_linux_file_managers() -> Vec<OpenApp> {
    let candidates = [
        ("dolphin", "Dolphin"),
        ("nautilus", "Nautilus"),
        ("nemo", "Nemo"),
        ("pcmanfm", "PCManFM"),
        ("thunar", "Thunar"),
    ];

    candidates
        .iter()
        .filter(|(id, _)| which::which(id).is_ok())
        .map(|(id, name)| OpenApp {
            id: (*id).to_string(),
            name: (*name).to_string(),
            kind: "system".to_string(),
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn detect_linux_terminals() -> Vec<OpenApp> {
    let candidates = [
        ("alacritty", "Alacritty"),
        ("ghostty", "Ghostty"),
        ("gnome-terminal", "GNOME Terminal"),
        ("kgx", "Console"),
        ("kitty", "Kitty"),
        ("konsole", "Konsole"),
        ("ptyxis", "Ptyxis"),
        ("tilix", "Tilix"),
        ("tmux", "Tmux"),
        ("warp", "Warp"),
        ("wezterm", "WezTerm"),
        ("xfce4-terminal", "Xfce Terminal"),
        ("zellij", "Zellij"),
    ];

    candidates
        .iter()
        .filter(|(id, _)| which::which(id).is_ok())
        .map(|(id, name)| OpenApp {
            id: (*id).to_string(),
            name: (*name).to_string(),
            kind: "terminal".to_string(),
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn detect_macos_terminals() -> Vec<OpenApp> {
    vec![
        OpenApp {
            id: "ghostty".into(),
            name: "Ghostty".into(),
            kind: "terminal".into(),
        },
        OpenApp {
            id: "warp".into(),
            name: "Warp".into(),
            kind: "terminal".into(),
        },
        OpenApp {
            id: "terminal".into(),
            name: "Terminal".into(),
            kind: "terminal".into(),
        },
    ]
}

fn detect_editors() -> Vec<OpenApp> {
    let candidates = [
        ("cursor", "Cursor"),
        ("code", "VS Code"),
        ("idea", "IntelliJ IDEA"),
        ("zed", "Zed"),
    ];

    candidates
        .iter()
        .filter(|(id, _)| {
            which::which(id).is_ok() || {
                #[cfg(target_os = "macos")]
                {
                    // Check for .app bundles on macOS
                    match *id {
                        "cursor" => std::path::Path::new("/Applications/Cursor.app").exists(),
                        "code" => {
                            std::path::Path::new("/Applications/Visual Studio Code.app").exists()
                        }
                        "idea" => find_existing_intellij_bundle().is_some(),
                        "zed" => find_existing_macos_zed_bundle().is_some(),
                        _ => false,
                    }
                }
                #[cfg(not(target_os = "macos"))]
                false
            }
        })
        .map(|(id, name)| OpenApp {
            id: (*id).to_string(),
            name: (*name).to_string(),
            kind: "editor".to_string(),
        })
        .collect()
}

fn guess_is_file(path: &Path) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_file(),
        Err(_) => path.extension().map(|ext| !ext.is_empty()).unwrap_or(false),
    }
}

fn resolve_request(
    worktree_root: &str,
    target_path: Option<&str>,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<ResolvedRequest, String> {
    let root = PathBuf::from(worktree_root);
    if !root.is_absolute() {
        return Err("Worktree root must be an absolute path".into());
    }

    let mut terminal_workdir = root.clone();
    let target = target_path.map(|raw| {
        let mut abs = PathBuf::from(raw);
        if !abs.is_absolute() {
            abs = root.join(raw);
        }
        let is_file = guess_is_file(&abs);
        if is_file {
            if let Some(parent) = abs.parent() {
                terminal_workdir = parent.to_path_buf();
            }
        } else {
            terminal_workdir = abs.clone();
        }
        ResolvedTarget {
            absolute_path: abs,
            is_file,
            line,
            column,
        }
    });

    Ok(ResolvedRequest {
        worktree_root: root,
        target,
        terminal_workdir,
    })
}

fn format_path_with_position(path: &Path, line: Option<u32>, column: Option<u32>) -> String {
    match (line, column) {
        (Some(l), Some(c)) => format!("{}:{}:{}", path.to_string_lossy(), l, c),
        (Some(l), None) => format!("{}:{}", path.to_string_lossy(), l),
        _ => path.to_string_lossy().to_string(),
    }
}

#[cfg(target_os = "macos")]
fn to_file_uri(path: &Path) -> String {
    format!("file://{}", path.to_string_lossy())
}

#[cfg(target_os = "macos")]
fn build_command_macos(app_id: &str, req: &ResolvedRequest) -> Result<CommandSpec, String> {
    let root = req.worktree_root.to_string_lossy().to_string();
    let goto = req
        .target
        .as_ref()
        .map(|t| format_path_with_position(&t.absolute_path, t.line, t.column));
    let terminal_dir = req.terminal_workdir.to_string_lossy().to_string();

    match app_id {
        "finder" => Ok(CommandSpec {
            program: "/usr/bin/open".into(),
            args: vec![root],
            working_dir: None,
        }),
        "terminal" => Ok(CommandSpec {
            program: "/usr/bin/open".into(),
            args: vec!["-a".into(), "Terminal".into(), terminal_dir],
            working_dir: None,
        }),
        "warp" => Ok(CommandSpec {
            program: "warp".into(),
            args: vec!["--cwd".into(), terminal_dir],
            working_dir: None,
        }),
        "ghostty" => Ok(CommandSpec {
            program: "ghostty".into(),
            args: vec![format!("--working-directory={}", terminal_dir)],
            working_dir: None,
        }),
        "vscode" | "code" => {
            let mut args = vec![
                "--reuse-window".into(),
                "--folder-uri".into(),
                to_file_uri(&req.worktree_root),
            ];
            if let Some(g) = goto {
                args.push("--goto".into());
                args.push(g);
            }
            Ok(CommandSpec {
                program: "code".into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        "cursor" => {
            let mut args = vec![
                "--reuse-window".into(),
                "--folder-uri".into(),
                to_file_uri(&req.worktree_root),
            ];
            if let Some(g) = goto {
                args.push("--goto".into());
                args.push(g);
            }
            Ok(CommandSpec {
                program: "cursor".into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        "intellij" | "idea" => {
            let mut args: Vec<String> = Vec::new();
            if let Some(target) = req.target.as_ref() {
                if let Some(line) = target.line {
                    args.push("--line".into());
                    args.push(line.to_string());
                }
                args.push(target.absolute_path.to_string_lossy().to_string());
            } else {
                args.push(root);
            }
            Ok(CommandSpec {
                program: "idea".into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        "zed" => {
            let mut args = vec![root];
            if let Some(target) = req.target.as_ref() {
                args.push(format_path_with_position(
                    &target.absolute_path,
                    target.line,
                    target.column,
                ));
            }
            Ok(CommandSpec {
                program: "zed".into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        other => Err(format!("Unsupported app id: {other}")),
    }
}

#[cfg(target_os = "linux")]
fn build_command_linux(app_id: &str, req: &ResolvedRequest) -> Result<CommandSpec, String> {
    let root = req.worktree_root.to_string_lossy().to_string();
    let goto = req
        .target
        .as_ref()
        .map(|t| format_path_with_position(&t.absolute_path, t.line, t.column));
    let terminal_dir = req.terminal_workdir.to_string_lossy().to_string();
    let target_or_root = req
        .target
        .as_ref()
        .map(|t| t.absolute_path.to_string_lossy().to_string())
        .unwrap_or_else(|| root.clone());

    match app_id {
        // File managers
        "dolphin" | "nautilus" | "nemo" | "pcmanfm" | "thunar" => Ok(CommandSpec {
            program: app_id.into(),
            args: vec![target_or_root],
            working_dir: None,
        }),

        // Terminals
        "alacritty" => Ok(CommandSpec {
            program: "alacritty".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "gnome-terminal" => Ok(CommandSpec {
            program: "gnome-terminal".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "konsole" => Ok(CommandSpec {
            program: "konsole".into(),
            args: vec!["--workdir".into(), terminal_dir],
            working_dir: None,
        }),
        "kitty" => Ok(CommandSpec {
            program: "kitty".into(),
            args: vec!["--directory".into(), terminal_dir],
            working_dir: None,
        }),
        "kgx" => Ok(CommandSpec {
            program: "kgx".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "ptyxis" => Ok(CommandSpec {
            program: "ptyxis".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "tilix" => Ok(CommandSpec {
            program: "tilix".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "xfce4-terminal" => Ok(CommandSpec {
            program: "xfce4-terminal".into(),
            args: vec!["--working-directory".into(), terminal_dir],
            working_dir: None,
        }),
        "wezterm" => Ok(CommandSpec {
            program: "wezterm".into(),
            args: vec!["start".into(), "--cwd".into(), terminal_dir],
            working_dir: None,
        }),
        "ghostty" => Ok(CommandSpec {
            program: "ghostty".into(),
            args: vec![format!("--working-directory={terminal_dir}")],
            working_dir: None,
        }),
        "warp" => Ok(CommandSpec {
            program: "warp".into(),
            args: vec!["--cwd".into(), terminal_dir],
            working_dir: None,
        }),
        "tmux" => Ok(CommandSpec {
            program: "tmux".into(),
            args: vec!["new-session".into(), "-c".into(), terminal_dir],
            working_dir: None,
        }),
        "zellij" => Ok(CommandSpec {
            program: "zellij".into(),
            args: vec!["--cwd".into(), terminal_dir],
            working_dir: None,
        }),

        // Editors
        "cursor" | "code" | "vscode" => {
            let mut args = vec!["--reuse-window".into(), root.clone()];
            if let Some(g) = goto {
                args.push("--goto".into());
                args.push(g);
            }
            Ok(CommandSpec {
                program: if app_id == "cursor" { "cursor" } else { "code" }.into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        "idea" => {
            let mut args: Vec<String> = Vec::new();
            if let Some(target) = req.target.as_ref() {
                if let Some(line) = target.line {
                    args.push("--line".into());
                    args.push(line.to_string());
                }
                args.push(target.absolute_path.to_string_lossy().to_string());
            } else {
                args.push(root);
            }
            Ok(CommandSpec {
                program: "idea".into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }
        "zed" => {
            let mut args = vec![root];
            if let Some(target) = req.target.as_ref() {
                args.push(format_path_with_position(
                    &target.absolute_path,
                    target.line,
                    target.column,
                ));
            }
            Ok(CommandSpec {
                program: "zed".into(),
                args,
                working_dir: Some(req.worktree_root.clone()),
            })
        }

        other => Err(format!("Unsupported app id: {other}")),
    }
}

fn open_path_in(
    app_id: &str,
    worktree_root: &str,
    target_path: Option<&str>,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<(), String> {
    let resolved = resolve_request(worktree_root, target_path, line, column)?;

    #[cfg(target_os = "macos")]
    {
        let spec = build_command_macos(app_id, &resolved)?;
        run_command_spec(spec)
    }

    #[cfg(target_os = "linux")]
    {
        let spec = build_command_linux(app_id, &resolved)?;
        run_command_spec(spec)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported platform".to_string())
    }
}

fn run_command_spec(spec: CommandSpec) -> Result<(), String> {
    let mut cmd = std::process::Command::new(&spec.program);
    if let Some(cwd) = spec.working_dir {
        cmd.current_dir(cwd);
    }
    cmd.args(&spec.args);
    match cmd.status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("{} exited with status: {status}", spec.program)),
        Err(e) => Err(format!("Failed to open in {}: {e}", spec.program)),
    }
}

#[cfg(target_os = "macos")]
fn find_existing_macos_zed_bundle() -> Option<std::path::PathBuf> {
    macos_zed_bundle_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
}

#[cfg(target_os = "macos")]
fn macos_zed_bundle_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates = vec![std::path::PathBuf::from("/Applications/Zed.app")];

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Applications/Zed.app"));
    }

    candidates
        .into_iter()
        .filter(|candidate| !candidate.as_os_str().is_empty())
        .collect()
}

#[cfg(target_os = "macos")]
fn find_existing_intellij_bundle() -> Option<std::path::PathBuf> {
    intellij_app_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
}

#[cfg(test)]
mod linux_tests {
    #[cfg(target_os = "linux")]
    #[test]
    fn test_build_command_for_code_with_goto_linux() {
        let req = resolve_request("/repo/root", Some("src/main.rs"), Some(8), Some(2))
            .expect("resolve should succeed");
        let spec = build_command_linux("code", &req).expect("build should succeed");
        assert_eq!(spec.program, "code");
        assert_eq!(spec.working_dir, Some(PathBuf::from("/repo/root")));
        assert!(spec.args.contains(&"--reuse-window".into()));
        assert!(spec.args.contains(&"--goto".into()));
        assert!(spec.args.iter().any(|a| a.ends_with("src/main.rs:8:2")));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_build_command_for_terminal_sets_parent_dir() {
        let req = resolve_request("/repo/root", Some("src/main.rs"), None, None)
            .expect("resolve should succeed");
        let spec = build_command_linux("alacritty", &req).expect("build should succeed");
        assert_eq!(spec.program, "alacritty");
        assert_eq!(
            spec.args,
            vec![
                "--working-directory".to_string(),
                "/repo/root/src".to_string()
            ]
        );
    }
}

#[cfg(target_os = "macos")]
fn intellij_app_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    push_bundle_variants(&mut candidates, std::path::PathBuf::from("/Applications"));

    if let Some(home) = dirs::home_dir() {
        push_bundle_variants(&mut candidates, home.join("Applications"));
        push_bundle_variants(&mut candidates, home.join("Applications/JetBrains Toolbox"));

        let toolbox_root = home.join("Library/Application Support/JetBrains/Toolbox/apps");
        for channel in ["IDEA-U", "IDEA-C"] {
            let channel_dir = toolbox_root.join(channel);
            push_bundle_variants(&mut candidates, channel_dir.clone());
            collect_intellij_apps_in_dir(&channel_dir, &mut candidates, 0);
        }
    }

    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|p| !p.as_os_str().is_empty())
        .filter(|p| seen.insert(p.clone()))
        .collect()
}

#[cfg(target_os = "macos")]
fn push_bundle_variants(candidates: &mut Vec<std::path::PathBuf>, base_dir: std::path::PathBuf) {
    if base_dir.as_os_str().is_empty() {
        return;
    }
    for name in [
        "IntelliJ IDEA.app",
        "IntelliJ IDEA CE.app",
        "IntelliJ IDEA Ultimate.app",
    ] {
        candidates.push(base_dir.join(name));
    }
}

#[cfg(target_os = "macos")]
fn collect_intellij_apps_in_dir(
    dir: &Path,
    candidates: &mut Vec<std::path::PathBuf>,
    depth: usize,
) {
    if depth > 4 {
        return;
    }

    if !dir.exists() {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if looks_like_intellij_app(&path) {
                    candidates.push(path);
                } else {
                    collect_intellij_apps_in_dir(&path, candidates, depth + 1);
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn looks_like_intellij_app(path: &Path) -> bool {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("app"))
        != Some(true)
    {
        return false;
    }

    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase().contains("intellij idea"))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn list_available_open_apps() -> Result<Vec<OpenApp>, String> {
    Ok(detect_available_apps())
}

pub fn get_default_open_app_from_db(
    db: &crate::schaltwerk_core::Database,
) -> anyhow::Result<String> {
    db.get_default_open_app()
}

pub fn set_default_open_app_in_db(
    db: &crate::schaltwerk_core::Database,
    app_id: &str,
) -> anyhow::Result<()> {
    db.set_default_open_app(app_id)
}

#[tauri::command]
pub async fn open_in_app(
    app_id: String,
    worktree_root: Option<String>,
    worktree_path: Option<String>, // backward compatibility
    target_path: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<(), String> {
    // Run in a blocking task to avoid UI freezing
    tokio::task::spawn_blocking(move || {
        let root = worktree_root
            .or(worktree_path)
            .ok_or_else(|| "worktree_root is required".to_string())?;
        open_path_in(&app_id, &root, target_path.as_deref(), line, column)
    })
    .await
    .map_err(|e| format!("Failed to spawn task: {e}"))?
}
