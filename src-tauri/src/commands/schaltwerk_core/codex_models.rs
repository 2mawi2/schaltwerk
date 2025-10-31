use anyhow::{Context, Result, bail};
use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexReasoningOption {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelMetadata {
    pub id: String,
    pub label: String,
    pub description: String,
    pub default_reasoning: String,
    pub reasoning_options: Vec<CodexReasoningOption>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelCatalog {
    pub models: Vec<CodexModelMetadata>,
    pub default_model_id: String,
}

fn matches_long_flag(arg: &str, flag: &str) -> (bool, bool) {
    if arg == flag {
        (true, false)
    } else if let Some(rest) = arg.strip_prefix(flag) {
        if rest.starts_with('=') {
            (true, true)
        } else {
            (false, false)
        }
    } else {
        (false, false)
    }
}

fn matches_short_flag(arg: &str, flag: &str) -> (bool, bool) {
    if arg == flag {
        (true, false)
    } else if flag.len() == 2 && arg.starts_with(flag) && arg.len() > flag.len() {
        (true, true)
    } else {
        (false, false)
    }
}

fn sanitize_cli_args(args: &[String]) -> Vec<String> {
    let mut sanitized = Vec::with_capacity(args.len());
    let mut skip_next = false;

    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }

        let (is_model_long, inline_model_long) = matches_long_flag(arg, "--model");
        let (is_model_short, inline_model_short) = matches_short_flag(arg, "-m");
        let (is_effort_long, inline_effort_long) = matches_long_flag(arg, "--reasoning-effort");

        if is_model_long || is_model_short {
            if !(inline_model_long || inline_model_short) {
                skip_next = true;
            }
            continue;
        }

        if is_effort_long {
            if !inline_effort_long {
                skip_next = true;
            }
            continue;
        }

        sanitized.push(arg.clone());
    }

    sanitized
}

fn to_title_case(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }
    let mut chars = input.chars();
    let first = chars
        .next()
        .map(|c| c.to_ascii_uppercase().to_string())
        .unwrap_or_default();
    let rest = chars.as_str().to_ascii_lowercase();
    format!("{first}{rest}")
}

pub fn builtin_codex_model_catalog() -> CodexModelCatalog {
    let models = vec![
        CodexModelMetadata {
            id: "gpt-5-codex".to_string(),
            label: "GPT-5 Codex".to_string(),
            description: "Optimized for coding tasks with many tools.".to_string(),
            default_reasoning: "medium".to_string(),
            reasoning_options: vec![
                CodexReasoningOption {
                    id: "low".to_string(),
                    label: "Low".to_string(),
                    description: "Fastest responses with limited reasoning".to_string(),
                },
                CodexReasoningOption {
                    id: "medium".to_string(),
                    label: "Medium".to_string(),
                    description: "Dynamically adjusts reasoning based on the task".to_string(),
                },
                CodexReasoningOption {
                    id: "high".to_string(),
                    label: "High".to_string(),
                    description: "Maximizes reasoning depth for complex or ambiguous problems"
                        .to_string(),
                },
            ],
            is_default: true,
        },
        CodexModelMetadata {
            id: "gpt-5".to_string(),
            label: "GPT-5".to_string(),
            description: "Broad world knowledge with strong general reasoning.".to_string(),
            default_reasoning: "medium".to_string(),
            reasoning_options: vec![
                CodexReasoningOption {
                    id: "minimal".to_string(),
                    label: "Minimal".to_string(),
                    description: "Fastest responses with little reasoning".to_string(),
                },
                CodexReasoningOption {
                    id: "low".to_string(),
                    label: "Low".to_string(),
                    description:
                        "Balances speed with some reasoning; useful for straightforward queries"
                            .to_string(),
                },
                CodexReasoningOption {
                    id: "medium".to_string(),
                    label: "Medium".to_string(),
                    description:
                        "Provides a solid balance of reasoning depth and latency for general-purpose tasks"
                            .to_string(),
                },
                CodexReasoningOption {
                    id: "high".to_string(),
                    label: "High".to_string(),
                    description: "Maximizes reasoning depth for complex or ambiguous problems"
                        .to_string(),
                },
            ],
            is_default: false,
        },
    ];

    let default_model_id = models
        .iter()
        .find(|model| model.is_default)
        .map(|model| model.id.clone())
        .unwrap_or_else(|| models[0].id.clone());

    CodexModelCatalog {
        models,
        default_model_id,
    }
}

pub async fn fetch_codex_model_catalog<P: AsRef<Path>>(
    binary_path: P,
    env_vars: &[(String, String)],
    cli_args: &[String],
) -> Result<CodexModelCatalog> {
    let sanitized_args = sanitize_cli_args(cli_args);

    let mut command = Command::new(binary_path.as_ref());
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (key, value) in env_vars {
        command.env(key, value);
    }

    if !sanitized_args.is_empty() {
        command.args(&sanitized_args);
    }
    command.arg("app-server");

    let mut child = command
        .spawn()
        .context("Failed to spawn Codex CLI for model discovery")?;

    let mut stdin = child
        .stdin
        .take()
        .context("Failed to acquire Codex stdin for model discovery")?;

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "model/list",
        "params": { "pageSize": 50 }
    });

    let mut payload = serde_json::to_vec(&request)?;
    payload.push(b'\n');

    stdin
        .write_all(&payload)
        .await
        .context("Failed to send model/list request to Codex")?;
    stdin
        .shutdown()
        .await
        .context("Failed to close Codex stdin after sending request")?;
    drop(stdin);

    let stdout = child
        .stdout
        .take()
        .context("Failed to capture Codex stdout for model discovery")?;

    let response = {
        let mut reader = BufReader::new(stdout).lines();
        let mut captured: Option<serde_json::Value> = None;
        while let Some(line) = reader
            .next_line()
            .await
            .context("Failed to read Codex stdout during model discovery")?
        {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let value: serde_json::Value =
                serde_json::from_str(trimmed).context("Failed to parse Codex stdout as JSON")?;
            if value
                .get("id")
                .and_then(|v| v.as_i64())
                .map(|id| id == 1)
                .unwrap_or(false)
            {
                captured = Some(value);
                break;
            }
        }
        captured
    };

    let status = child
        .wait()
        .await
        .context("Failed to wait for Codex CLI process to exit")?;

    if let Some(value) = response {
        map_models_from_json(&value)
    } else if !status.success() {
        Err(anyhow::anyhow!(
            "Codex CLI exited with status {:?} before returning models",
            status.code()
        ))
    } else {
        Err(anyhow::anyhow!(
            "Codex CLI did not return a model list before exiting"
        ))
    }
}

fn map_models_from_json(value: &serde_json::Value) -> Result<CodexModelCatalog> {
    let result = value
        .get("result")
        .context("Codex response missing result field")?;

    let items = result
        .get("items")
        .context("Codex response missing items field")?
        .as_array()
        .context("Codex items field was not an array")?;

    if items.is_empty() {
        bail!("No Codex models returned from CLI");
    }

    let mut models: Vec<CodexModelMetadata> = Vec::with_capacity(items.len());

    for item in items {
        let id = item
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .context("Codex model missing id")?;

        let display_name = item
            .get("displayName")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(id);

        let description = item
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or_default()
            .to_string();

        let default_reasoning = item
            .get("defaultReasoningEffort")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("medium")
            .to_string();

        let reasoning_options = item
            .get("supportedReasoningEfforts")
            .and_then(|v| v.as_array())
            .map(|options| {
                options
                    .iter()
                    .filter_map(|opt| {
                        let effort = opt
                            .get("reasoningEffort")
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())?;
                        let description = opt
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .unwrap_or_default();
                        Some(CodexReasoningOption {
                            id: effort.to_string(),
                            label: to_title_case(effort),
                            description: if description.is_empty() {
                                format!("{} reasoning effort", to_title_case(effort))
                            } else {
                                description.to_string()
                            },
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let is_default = item
            .get("isDefault")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        models.push(CodexModelMetadata {
            id: id.to_string(),
            label: display_name.to_string(),
            description,
            default_reasoning,
            reasoning_options,
            is_default,
        });
    }

    if models.is_empty() {
        bail!("No Codex models returned from CLI");
    }

    let has_default = models.iter().any(|model| model.is_default);
    let default_model_id = if has_default {
        models
            .iter()
            .find(|model| model.is_default)
            .map(|model| model.id.clone())
            .unwrap_or_else(|| models[0].id.clone())
    } else if let Some(first) = models.get_mut(0) {
        first.is_default = true;
        first.id.clone()
    } else {
        bail!("No Codex models returned from CLI");
    };

    Ok(CodexModelCatalog {
        models,
        default_model_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_response() -> serde_json::Value {
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "items": [
                    {
                        "id": "gpt-5-codex",
                        "model": "gpt-5-codex",
                        "displayName": "GPT-5 Codex",
                        "description": "Optimized for coding tasks with many tools.",
                        "supportedReasoningEfforts": [
                            { "reasoningEffort": "low", "description": "Fastest responses with limited reasoning" },
                            { "reasoningEffort": "medium", "description": "Dynamically adjusts reasoning based on the task" },
                            { "reasoningEffort": "high", "description": "Maximizes reasoning depth for complex or ambiguous problems" }
                        ],
                        "defaultReasoningEffort": "medium",
                        "isDefault": true
                    },
                    {
                        "id": "gpt-5",
                        "model": "gpt-5",
                        "displayName": "GPT-5",
                        "description": "Broad world knowledge with strong general reasoning.",
                        "supportedReasoningEfforts": [
                            { "reasoningEffort": "minimal", "description": "Fastest responses with little reasoning" },
                            { "reasoningEffort": "low", "description": "Balances speed with some reasoning; great for straightforward queries" },
                            { "reasoningEffort": "medium", "description": "Solid balance of reasoning depth and latency for general-purpose tasks" },
                            { "reasoningEffort": "high", "description": "Maximizes reasoning depth for complex or ambiguous problems" }
                        ],
                        "defaultReasoningEffort": "medium",
                        "isDefault": false
                    }
                ],
                "nextCursor": null
            }
        })
    }

    #[test]
    fn maps_codex_models_from_json() {
        let value = sample_response();
        let catalog = map_models_from_json(&value).expect("expected mapping to succeed");
        assert_eq!(catalog.models.len(), 2);
        assert_eq!(catalog.default_model_id, "gpt-5-codex");
        let first = &catalog.models[0];
        assert_eq!(first.id, "gpt-5-codex");
        assert_eq!(first.reasoning_options.len(), 3);
        assert_eq!(first.reasoning_options[0].id, "low");
        assert_eq!(first.reasoning_options[0].label, "Low");
    }

    #[test]
    fn fails_when_missing_items() {
        let value = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "items": [] }
        });
        let err = map_models_from_json(&value).unwrap_err();
        assert!(err.to_string().contains("No Codex models"));
    }

    #[test]
    fn picks_first_model_when_no_default_flag_present() {
        let value = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "items": [
                    {
                        "id": "gpt-5",
                        "model": "gpt-5",
                        "displayName": "GPT-5",
                        "description": "General model",
                        "supportedReasoningEfforts": [],
                        "defaultReasoningEffort": "medium",
                        "isDefault": false
                    }
                ],
                "nextCursor": null
            }
        });
        let catalog = map_models_from_json(&value).expect("expected mapping to succeed");
        assert_eq!(catalog.default_model_id, "gpt-5");
    }
}
