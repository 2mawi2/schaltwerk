use similar::{ChangeTag, TextDiff, Algorithm};
use serde::{Deserialize, Serialize};

const COLLAPSE_THRESHOLD: usize = 4;
const CONTEXT_LINES: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    pub content: String,
    #[serde(rename = "type")]
    pub line_type: LineType,
    #[serde(rename = "oldLineNumber")]
    pub old_line_number: Option<usize>,
    #[serde(rename = "newLineNumber")]
    pub new_line_number: Option<usize>,
    #[serde(rename = "isCollapsible")]
    pub is_collapsible: Option<bool>,
    #[serde(rename = "collapsedCount")]
    pub collapsed_count: Option<usize>,
    #[serde(rename = "collapsedLines")]
    pub collapsed_lines: Option<Vec<DiffLine>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineType {
    Added,
    Removed,
    Unchanged,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SplitDiffResult {
    #[serde(rename = "leftLines")]
    pub left_lines: Vec<DiffLine>,
    #[serde(rename = "rightLines")]
    pub right_lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffStats {
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub language: Option<String>,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffResponse {
    pub lines: Vec<DiffLine>,
    pub stats: DiffStats,
    #[serde(rename = "fileInfo")]
    pub file_info: FileInfo,
    #[serde(rename = "isLargeFile")]
    pub is_large_file: bool,
    #[serde(rename = "isBinary")]
    pub is_binary: Option<bool>,
    #[serde(rename = "unsupportedReason")]
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SplitDiffResponse {
    #[serde(rename = "splitResult")]
    pub split_result: SplitDiffResult,
    pub stats: DiffStats,
    #[serde(rename = "fileInfo")]
    pub file_info: FileInfo,
    #[serde(rename = "isLargeFile")]
    pub is_large_file: bool,
    #[serde(rename = "isBinary")]
    pub is_binary: Option<bool>,
    #[serde(rename = "unsupportedReason")]
    pub unsupported_reason: Option<String>,
}

pub fn compute_unified_diff(old_content: &str, new_content: &str) -> Vec<DiffLine> {
    let old_text = ensure_trailing_newline(old_content);
    let new_text = ensure_trailing_newline(new_content);

    // Use Myers algorithm for better performance on typical code diffs
    // Patience algorithm is better for complex merges, Myers for speed
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&old_text, &new_text);
    
    // Pre-allocate capacity based on rough estimate to avoid reallocations
    let estimated_lines = old_text.lines().count().max(new_text.lines().count());
    let mut lines = Vec::with_capacity(estimated_lines + (estimated_lines / 10));
    let mut old_line_num = 1;
    let mut new_line_num = 1;

    for change in diff.iter_all_changes() {
        let content = change.value();
        let content_str = if let Some(stripped) = content.strip_suffix('\n') {
            stripped.to_string()
        } else {
            content.to_string()
        };

        match change.tag() {
            ChangeTag::Equal => {
                lines.push(DiffLine {
                    content: content_str,
                    line_type: LineType::Unchanged,
                    old_line_number: Some(old_line_num),
                    new_line_number: Some(new_line_num),
                    is_collapsible: None,
                    collapsed_count: None,
                    collapsed_lines: None,
                });
                old_line_num += 1;
                new_line_num += 1;
            }
            ChangeTag::Delete => {
                lines.push(DiffLine {
                    content: content_str,
                    line_type: LineType::Removed,
                    old_line_number: Some(old_line_num),
                    new_line_number: None,
                    is_collapsible: None,
                    collapsed_count: None,
                    collapsed_lines: None,
                });
                old_line_num += 1;
            }
            ChangeTag::Insert => {
                lines.push(DiffLine {
                    content: content_str,
                    line_type: LineType::Added,
                    old_line_number: None,
                    new_line_number: Some(new_line_num),
                    is_collapsible: None,
                    collapsed_count: None,
                    collapsed_lines: None,
                });
                new_line_num += 1;
            }
        }
    }

    lines
}

pub fn add_collapsible_sections(lines: Vec<DiffLine>) -> Vec<DiffLine> {
    if lines.is_empty() {
        return lines;
    }

    // Pre-allocate capacity to avoid reallocations
    let mut processed_lines = Vec::with_capacity(lines.len());
    let mut i = 0;

    while i < lines.len() {
        if matches!(lines[i].line_type, LineType::Unchanged) {
            let mut j = i;
            while j < lines.len() && matches!(lines[j].line_type, LineType::Unchanged) {
                j += 1;
            }

            let unchanged_count = j - i;

            if unchanged_count > COLLAPSE_THRESHOLD + 2 * CONTEXT_LINES {
                // Add context before
                for k in 0..CONTEXT_LINES {
                    if i + k < j {
                        processed_lines.push(lines[i + k].clone());
                    }
                }

                let collapsed_start = i + CONTEXT_LINES;
                let collapsed_end = j - CONTEXT_LINES;
                let collapsed_count = collapsed_end - collapsed_start;

                if collapsed_count > 0 {
                    let mut collapsed_lines = Vec::with_capacity(collapsed_count);
                    for line in lines.iter().take(collapsed_end).skip(collapsed_start) {
                        collapsed_lines.push(line.clone());
                    }

                    processed_lines.push(DiffLine {
                        content: String::new(),
                        line_type: LineType::Unchanged,
                        is_collapsible: Some(true),
                        collapsed_count: Some(collapsed_count),
                        collapsed_lines: Some(collapsed_lines),
                        old_line_number: lines[collapsed_start].old_line_number,
                        new_line_number: lines[collapsed_start].new_line_number,
                    });
                }

                // Add context after
                for line in lines.iter().take(j).skip(collapsed_end) {
                    processed_lines.push(line.clone());
                }
            } else {
                // Add all unchanged lines
                for line in lines.iter().take(j).skip(i) {
                    processed_lines.push(line.clone());
                }
            }

            i = j;
        } else {
            processed_lines.push(lines[i].clone());
            i += 1;
        }
    }

    processed_lines
}

pub fn compute_split_diff(old_content: &str, new_content: &str) -> SplitDiffResult {
    let old_text = ensure_trailing_newline(old_content);
    let new_text = ensure_trailing_newline(new_content);

    // Use Myers algorithm for better performance
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&old_text, &new_text);
    
    // Pre-allocate capacity based on estimated line counts
    let estimated_lines = old_text.lines().count().max(new_text.lines().count());
    let mut left_lines = Vec::with_capacity(estimated_lines + (estimated_lines / 10));
    let mut right_lines = Vec::with_capacity(estimated_lines + (estimated_lines / 10));
    let mut old_idx = 0;
    let mut new_idx = 0;

    for change in diff.iter_all_changes() {
        let content = change.value();
        let content_str = if let Some(stripped) = content.strip_suffix('\n') {
            stripped.to_string()
        } else {
            content.to_string()
        };

        match change.tag() {
            ChangeTag::Equal => {
                left_lines.push(DiffLine {
                    content: content_str.clone(),
                    line_type: LineType::Unchanged,
                    old_line_number: Some(old_idx + 1),
                    new_line_number: None,
                    is_collapsible: None,
                    collapsed_count: None,
                    collapsed_lines: None,
                });
                right_lines.push(DiffLine {
                    content: content_str,
                    line_type: LineType::Unchanged,
                    old_line_number: None,
                    new_line_number: Some(new_idx + 1),
                    is_collapsible: None,
                    collapsed_count: None,
                    collapsed_lines: None,
                });
                old_idx += 1;
                new_idx += 1;
            }
            ChangeTag::Delete => {
                left_lines.push(DiffLine {
                    content: content_str,
                    line_type: LineType::Removed,
                    old_line_number: Some(old_idx + 1),
                    new_line_number: None,
                    is_collapsible: None,
                    collapsed_count: None,
                    collapsed_lines: None,
                });
                right_lines.push(DiffLine {
                    content: String::new(),
                    line_type: LineType::Unchanged,
                    old_line_number: None,
                    new_line_number: None,
                    is_collapsible: None,
                    collapsed_count: None,
                    collapsed_lines: None,
                });
                old_idx += 1;
            }
            ChangeTag::Insert => {
                left_lines.push(DiffLine {
                    content: String::new(),
                    line_type: LineType::Unchanged,
                    old_line_number: None,
                    new_line_number: None,
                    is_collapsible: None,
                    collapsed_count: None,
                    collapsed_lines: None,
                });
                right_lines.push(DiffLine {
                    content: content_str,
                    line_type: LineType::Added,
                    old_line_number: None,
                    new_line_number: Some(new_idx + 1),
                    is_collapsible: None,
                    collapsed_count: None,
                    collapsed_lines: None,
                });
                new_idx += 1;
            }
        }
    }

    SplitDiffResult {
        left_lines,
        right_lines,
    }
}

pub fn calculate_diff_stats(lines: &[DiffLine]) -> DiffStats {
    let mut additions = 0;
    let mut deletions = 0;

    for line in lines {
        match line.line_type {
            LineType::Added => additions += 1,
            LineType::Removed => deletions += 1,
            LineType::Unchanged => {
                if let Some(collapsed_lines) = &line.collapsed_lines {
                    let collapsed_stats = calculate_diff_stats(collapsed_lines);
                    additions += collapsed_stats.additions;
                    deletions += collapsed_stats.deletions;
                }
            }
        }
    }

    DiffStats {
        additions,
        deletions,
    }
}

pub fn calculate_split_diff_stats(split: &SplitDiffResult) -> DiffStats {
    let mut additions = 0;
    let mut deletions = 0;

    for i in 0..split.left_lines.len().max(split.right_lines.len()) {
        if let Some(left) = split.left_lines.get(i) {
            if matches!(left.line_type, LineType::Removed) {
                deletions += 1;
            }
        }
        if let Some(right) = split.right_lines.get(i) {
            if matches!(right.line_type, LineType::Added) {
                additions += 1;
            }
        }
    }

    DiffStats {
        additions,
        deletions,
    }
}

pub fn get_file_language(file_path: &str) -> Option<String> {
    if file_path.is_empty() {
        return None;
    }

    let ext = file_path.split('.').next_back()?.to_lowercase();
    
    match ext.as_str() {
        "ts" | "tsx" => Some("typescript".to_string()),
        "js" | "jsx" => Some("javascript".to_string()),
        "rs" => Some("rust".to_string()),
        "py" => Some("python".to_string()),
        "go" => Some("go".to_string()),
        "java" => Some("java".to_string()),
        "kt" => Some("kotlin".to_string()),
        "swift" => Some("swift".to_string()),
        "c" | "h" => Some("c".to_string()),
        "cpp" | "cc" | "cxx" => Some("cpp".to_string()),
        "cs" => Some("csharp".to_string()),
        "rb" => Some("ruby".to_string()),
        "php" => Some("php".to_string()),
        "sh" | "bash" | "zsh" => Some("bash".to_string()),
        "json" => Some("json".to_string()),
        "yml" | "yaml" => Some("yaml".to_string()),
        "toml" => Some("toml".to_string()),
        "md" => Some("markdown".to_string()),
        "css" => Some("css".to_string()),
        "scss" => Some("scss".to_string()),
        "less" => Some("less".to_string()),
        _ => None,
    }
}


fn ensure_trailing_newline(content: &str) -> String {
    if content.is_empty() {
        String::new()
    } else if content.ends_with('\n') {
        content.to_string()
    } else {
        format!("{content}\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_unified_diff_basic() {
        let old = "line 1\nline 2\nline 3";
        let new = "line 1\nline 2 modified\nline 3";
        
        let result = compute_unified_diff(old, new);
        
        // Expected: line 1 (unchanged), line 2 (removed), line 2 modified (added), line 3 (unchanged)
        assert_eq!(result.len(), 4);
        assert!(matches!(result[0].line_type, LineType::Unchanged));
        assert!(matches!(result[1].line_type, LineType::Removed));
        assert!(matches!(result[2].line_type, LineType::Added));
        assert!(matches!(result[3].line_type, LineType::Unchanged));
    }

    #[test]
    fn test_add_collapsible_sections() {
        let mut lines = Vec::new();
        
        for i in 1..=20 {
            lines.push(DiffLine {
                content: format!("line {}", i),
                line_type: LineType::Unchanged,
                old_line_number: Some(i),
                new_line_number: Some(i),
                is_collapsible: None,
                collapsed_count: None,
                collapsed_lines: None,
            });
        }
        
        let result = add_collapsible_sections(lines);
        
        let collapsible_count = result.iter()
            .filter(|line| line.is_collapsible.unwrap_or(false))
            .count();
        assert_eq!(collapsible_count, 1);
    }

    #[test]
    fn test_compute_split_diff_basic() {
        let old = "line 1\nline 2\nline 3";
        let new = "line 1\nline 2 modified\nline 3";
        
        let result = compute_split_diff(old, new);
        
        // Expected: line 1 (unchanged), line 2 (removed/added), line 3 (unchanged)
        // Plus empty line for the added content on the left
        assert_eq!(result.left_lines.len(), 4);
        assert_eq!(result.right_lines.len(), 4);
    }

    #[test]
    fn test_calculate_diff_stats() {
        let lines = vec![
            DiffLine {
                content: "unchanged".to_string(),
                line_type: LineType::Unchanged,
                old_line_number: Some(1),
                new_line_number: Some(1),
                is_collapsible: None,
                collapsed_count: None,
                collapsed_lines: None,
            },
            DiffLine {
                content: "removed".to_string(),
                line_type: LineType::Removed,
                old_line_number: Some(2),
                new_line_number: None,
                is_collapsible: None,
                collapsed_count: None,
                collapsed_lines: None,
            },
            DiffLine {
                content: "added".to_string(),
                line_type: LineType::Added,
                old_line_number: None,
                new_line_number: Some(2),
                is_collapsible: None,
                collapsed_count: None,
                collapsed_lines: None,
            },
        ];
        
        let stats = calculate_diff_stats(&lines);
        assert_eq!(stats.additions, 1);
        assert_eq!(stats.deletions, 1);
    }

    #[test]
    fn test_get_file_language() {
        assert_eq!(get_file_language("test.rs"), Some("rust".to_string()));
        assert_eq!(get_file_language("test.ts"), Some("typescript".to_string()));
        assert_eq!(get_file_language("test.js"), Some("javascript".to_string()));
        assert_eq!(get_file_language("test.unknown"), None);
    }

    // Performance benchmark tests
    #[test]
    fn bench_large_diff_performance() {
        // Generate large files for performance testing
        let old_lines = 5000;
        let new_lines = 5000;
        
        let old_content = (0..old_lines)
            .map(|i| format!("line {}", i))
            .collect::<Vec<_>>()
            .join("\n");
        
        let new_content = (0..new_lines)
            .map(|i| {
                if i % 100 == 50 {
                    format!("modified line {}", i)
                } else {
                    format!("line {}", i)
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        
        let start = std::time::Instant::now();
        let result = compute_unified_diff(&old_content, &new_content);
        let diff_duration = start.elapsed();
        
        let start = std::time::Instant::now();
        let _with_collapsible = add_collapsible_sections(result);
        let collapse_duration = start.elapsed();
        
        println!(
            "Performance: diff={}ms, collapse={}ms for {}K chars",
            diff_duration.as_millis(),
            collapse_duration.as_millis(),
            (old_content.len() + new_content.len()) / 1024
        );
        
        // Performance assertions - should be fast
        assert!(diff_duration.as_millis() < 500, "Diff took too long: {}ms", diff_duration.as_millis());
        assert!(collapse_duration.as_millis() < 100, "Collapse took too long: {}ms", collapse_duration.as_millis());
    }
}