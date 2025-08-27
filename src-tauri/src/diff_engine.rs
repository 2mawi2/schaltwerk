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

    // ===== compute_unified_diff Tests =====

    #[test]
    fn test_compute_unified_diff_empty_files() {
        let result = compute_unified_diff("", "");
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_compute_unified_diff_identical_files() {
        let content = "line 1\nline 2\nline 3";
        let result = compute_unified_diff(content, content);

        assert_eq!(result.len(), 3);
        for line in result {
            assert!(matches!(line.line_type, LineType::Unchanged));
            assert!(line.old_line_number.is_some());
            assert!(line.new_line_number.is_some());
        }
    }

    #[test]
    fn test_compute_unified_diff_single_line_addition() {
        let old = "line 1\nline 2";
        let new = "line 1\nline 2\nline 3";

        let result = compute_unified_diff(old, new);

        assert_eq!(result.len(), 3);
        assert!(matches!(result[0].line_type, LineType::Unchanged));
        assert!(matches!(result[1].line_type, LineType::Unchanged));
        assert!(matches!(result[2].line_type, LineType::Added));
        assert_eq!(result[2].content, "line 3");
    }

    #[test]
    fn test_compute_unified_diff_single_line_deletion() {
        let old = "line 1\nline 2\nline 3";
        let new = "line 1\nline 2";

        let result = compute_unified_diff(old, new);

        assert_eq!(result.len(), 3);
        assert!(matches!(result[0].line_type, LineType::Unchanged));
        assert!(matches!(result[1].line_type, LineType::Unchanged));
        assert!(matches!(result[2].line_type, LineType::Removed));
        assert_eq!(result[2].content, "line 3");
    }

    #[test]
    fn test_compute_unified_diff_single_line_modification() {
        let old = "line 1\nline 2\nline 3";
        let new = "line 1\nline 2 modified\nline 3";

        let result = compute_unified_diff(old, new);

        assert_eq!(result.len(), 4);
        assert!(matches!(result[0].line_type, LineType::Unchanged));
        assert!(matches!(result[1].line_type, LineType::Removed));
        assert!(matches!(result[2].line_type, LineType::Added));
        assert!(matches!(result[3].line_type, LineType::Unchanged));
        assert_eq!(result[1].content, "line 2");
        assert_eq!(result[2].content, "line 2 modified");
    }

    #[test]
    fn test_compute_unified_diff_multiple_changes() {
        let old = "line 1\nline 2\nline 3\nline 4\nline 5";
        let new = "line 1\nline 2 modified\nline 3\nline 4 modified\nline 5";

        let result = compute_unified_diff(old, new);

        assert_eq!(result.len(), 7);
        // Check pattern: unchanged, removed, added, unchanged, removed, added, unchanged
        assert!(matches!(result[0].line_type, LineType::Unchanged)); // line 1
        assert!(matches!(result[1].line_type, LineType::Removed));   // line 2
        assert!(matches!(result[2].line_type, LineType::Added));     // line 2 modified
        assert!(matches!(result[3].line_type, LineType::Unchanged)); // line 3
        assert!(matches!(result[4].line_type, LineType::Removed));   // line 4
        assert!(matches!(result[5].line_type, LineType::Added));     // line 4 modified
        assert!(matches!(result[6].line_type, LineType::Unchanged)); // line 5
    }

    #[test]
    fn test_compute_unified_diff_add_at_beginning() {
        let old = "line 1\nline 2";
        let new = "line 0\nline 1\nline 2";

        let result = compute_unified_diff(old, new);

        assert_eq!(result.len(), 3);
        assert!(matches!(result[0].line_type, LineType::Added));
        assert!(matches!(result[1].line_type, LineType::Unchanged));
        assert!(matches!(result[2].line_type, LineType::Unchanged));
        assert_eq!(result[0].content, "line 0");
    }

    #[test]
    fn test_compute_unified_diff_delete_at_beginning() {
        let old = "line 0\nline 1\nline 2";
        let new = "line 1\nline 2";

        let result = compute_unified_diff(old, new);

        assert_eq!(result.len(), 3);
        assert!(matches!(result[0].line_type, LineType::Removed));
        assert!(matches!(result[1].line_type, LineType::Unchanged));
        assert!(matches!(result[2].line_type, LineType::Unchanged));
        assert_eq!(result[0].content, "line 0");
    }

    #[test]
    fn test_compute_unified_diff_add_at_end() {
        let old = "line 1\nline 2";
        let new = "line 1\nline 2\nline 3";

        let result = compute_unified_diff(old, new);

        assert_eq!(result.len(), 3);
        assert!(matches!(result[0].line_type, LineType::Unchanged));
        assert!(matches!(result[1].line_type, LineType::Unchanged));
        assert!(matches!(result[2].line_type, LineType::Added));
        assert_eq!(result[2].content, "line 3");
    }

    #[test]
    fn test_compute_unified_diff_delete_at_end() {
        let old = "line 1\nline 2\nline 3";
        let new = "line 1\nline 2";

        let result = compute_unified_diff(old, new);

        assert_eq!(result.len(), 3);
        assert!(matches!(result[0].line_type, LineType::Unchanged));
        assert!(matches!(result[1].line_type, LineType::Unchanged));
        assert!(matches!(result[2].line_type, LineType::Removed));
        assert_eq!(result[2].content, "line 3");
    }

    #[test]
    fn test_compute_unified_diff_trailing_newline_handling() {
        let old = "line 1\nline 2";
        let new = "line 1\nline 2\n";

        let result = compute_unified_diff(old, new);

        // The ensure_trailing_newline function should handle this
        // The result should show the trailing newline as an addition
        assert!(result.len() >= 2);
        let last_line = &result[result.len() - 1];
        assert!(matches!(last_line.line_type, LineType::Added) || matches!(last_line.line_type, LineType::Unchanged));
    }

    #[test]
    fn test_compute_unified_diff_unicode_content() {
        let old = "hello\nworld";
        let new = "hello\n🌍 world\n🚀";

        let result = compute_unified_diff(old, new);

        assert!(result.len() >= 3);
        // Check that unicode characters are preserved
        let added_lines: Vec<&DiffLine> = result.iter().filter(|l| matches!(l.line_type, LineType::Added)).collect();
        assert!(added_lines.len() >= 1);
        assert!(added_lines[0].content.contains("🌍") || added_lines[0].content.contains("🚀"));
    }

    #[test]
    fn test_compute_unified_diff_large_content() {
        let old_lines: Vec<String> = (0..1000).map(|i| format!("line {}", i)).collect();
        let mut new_lines = old_lines.clone();
        new_lines[500] = "modified line 500".to_string();
        new_lines.insert(250, "inserted line".to_string());

        let old_content = old_lines.join("\n");
        let new_content = new_lines.join("\n");

        let result = compute_unified_diff(&old_content, &new_content);

        // Should have at least the original lines plus the insertion
        assert!(result.len() >= 1000);
        // Should have one deletion and two additions (modify = delete + insert)
        let deletions: Vec<&DiffLine> = result.iter().filter(|l| matches!(l.line_type, LineType::Removed)).collect();
        let additions: Vec<&DiffLine> = result.iter().filter(|l| matches!(l.line_type, LineType::Added)).collect();
        assert_eq!(deletions.len(), 1);
        assert_eq!(additions.len(), 2);
    }

    // ===== add_collapsible_sections Tests =====

    #[test]
    fn test_add_collapsible_sections_empty_input() {
        let result = add_collapsible_sections(Vec::new());
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_add_collapsible_sections_no_collapsible() {
        let mut lines = Vec::new();

        // Create fewer than COLLAPSE_THRESHOLD + 2 * CONTEXT_LINES unchanged lines
        for i in 1..=(COLLAPSE_THRESHOLD + 2 * CONTEXT_LINES - 1) {
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

        let result = add_collapsible_sections(lines.clone());
        assert_eq!(result.len(), lines.len());

        // No collapsible sections should be created
        let collapsible_count = result.iter()
            .filter(|line| line.is_collapsible.unwrap_or(false))
            .count();
        assert_eq!(collapsible_count, 0);
    }

    #[test]
    fn test_add_collapsible_sections_single_collapsible() {
        let mut lines = Vec::new();

        // Create enough unchanged lines to trigger collapsible section
        for i in 1..=(COLLAPSE_THRESHOLD + 2 * CONTEXT_LINES + 5) {
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

        // Should have context lines + 1 collapsible + context lines
        let collapsible_count = result.iter()
            .filter(|line| line.is_collapsible.unwrap_or(false))
            .count();
        assert_eq!(collapsible_count, 1);

        // Find the collapsible line
        let collapsible_line = result.iter().find(|line| line.is_collapsible.unwrap_or(false)).unwrap();
        assert!(collapsible_line.collapsed_count.is_some());
        assert!(collapsible_line.collapsed_lines.is_some());
        assert!(collapsible_line.collapsed_count.unwrap() > 0);
    }

    #[test]
    fn test_add_collapsible_sections_multiple_collapsible() {
        let mut lines = Vec::new();

        // Create pattern: changed, unchanged block, changed, unchanged block, changed
        for i in 1..=3 {
            // Add a changed line
            lines.push(DiffLine {
                content: format!("changed {}", i),
                line_type: LineType::Added,
                old_line_number: None,
                new_line_number: Some(i),
                is_collapsible: None,
                collapsed_count: None,
                collapsed_lines: None,
            });

            // Add enough unchanged lines for collapsible section
            for j in 1..=(COLLAPSE_THRESHOLD + 2 * CONTEXT_LINES + 5) {
                lines.push(DiffLine {
                    content: format!("unchanged {}-{}", i, j),
                    line_type: LineType::Unchanged,
                    old_line_number: Some((i-1) * 100 + j),
                    new_line_number: Some((i-1) * 100 + j),
                    is_collapsible: None,
                    collapsed_count: None,
                    collapsed_lines: None,
                });
            }
        }

        let result = add_collapsible_sections(lines);

        let collapsible_count = result.iter()
            .filter(|line| line.is_collapsible.unwrap_or(false))
            .count();
        assert_eq!(collapsible_count, 3); // One for each unchanged block
    }

    #[test]
    fn test_add_collapsible_sections_mixed_changes() {
        let mut lines = Vec::new();

        // Pattern: unchanged (small), changed, unchanged (large), changed, unchanged (small)
        for i in 1..=5 {
            lines.push(DiffLine {
                content: format!("unchanged small {}", i),
                line_type: LineType::Unchanged,
                old_line_number: Some(i),
                new_line_number: Some(i),
                is_collapsible: None,
                collapsed_count: None,
                collapsed_lines: None,
            });
        }

        lines.push(DiffLine {
            content: "changed line".to_string(),
            line_type: LineType::Added,
            old_line_number: None,
            new_line_number: Some(6),
            is_collapsible: None,
            collapsed_count: None,
            collapsed_lines: None,
        });

        // Large unchanged block
        for i in 7..=(COLLAPSE_THRESHOLD + 2 * CONTEXT_LINES + 10) {
            lines.push(DiffLine {
                content: format!("unchanged large {}", i),
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
        assert_eq!(collapsible_count, 1); // Only the large block should be collapsible
    }

    #[test]
    fn test_add_collapsible_sections_all_unchanged() {
        let mut lines = Vec::new();

        // Create all unchanged lines
        for i in 1..=(COLLAPSE_THRESHOLD + 2 * CONTEXT_LINES + 10) {
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
    fn test_add_collapsible_sections_all_changed() {
        let mut lines = Vec::new();

        // Create all changed lines
        for i in 1..=10 {
            lines.push(DiffLine {
                content: format!("changed {}", i),
                line_type: LineType::Added,
                old_line_number: None,
                new_line_number: Some(i),
                is_collapsible: None,
                collapsed_count: None,
                collapsed_lines: None,
            });
        }

        let result = add_collapsible_sections(lines.clone());

        // Should be identical to input
        assert_eq!(result.len(), lines.len());
        let collapsible_count = result.iter()
            .filter(|line| line.is_collapsible.unwrap_or(false))
            .count();
        assert_eq!(collapsible_count, 0);
    }

    // ===== compute_split_diff Tests =====

    #[test]
    fn test_compute_split_diff_empty_files() {
        let result = compute_split_diff("", "");
        assert_eq!(result.left_lines.len(), 0);
        assert_eq!(result.right_lines.len(), 0);
    }

    #[test]
    fn test_compute_split_diff_identical_files() {
        let content = "line 1\nline 2\nline 3";
        let result = compute_split_diff(content, content);

        assert_eq!(result.left_lines.len(), 3);
        assert_eq!(result.right_lines.len(), 3);

        for i in 0..3 {
            assert!(matches!(result.left_lines[i].line_type, LineType::Unchanged));
            assert!(matches!(result.right_lines[i].line_type, LineType::Unchanged));
            assert_eq!(result.left_lines[i].content, format!("line {}", i + 1));
            assert_eq!(result.right_lines[i].content, format!("line {}", i + 1));
        }
    }

    #[test]
    fn test_compute_split_diff_single_modification() {
        let old = "line 1\nline 2\nline 3";
        let new = "line 1\nline 2 modified\nline 3";

        let result = compute_split_diff(old, new);

        assert_eq!(result.left_lines.len(), 4);
        assert_eq!(result.right_lines.len(), 4);

        // Line 1: unchanged on both sides
        assert!(matches!(result.left_lines[0].line_type, LineType::Unchanged));
        assert!(matches!(result.right_lines[0].line_type, LineType::Unchanged));
        assert_eq!(result.left_lines[0].content, "line 1");
        assert_eq!(result.right_lines[0].content, "line 1");

        // Line 2: removed on left, empty on right
        assert!(matches!(result.left_lines[1].line_type, LineType::Removed));
        assert!(matches!(result.right_lines[1].line_type, LineType::Unchanged));
        assert_eq!(result.left_lines[1].content, "line 2");
        assert_eq!(result.right_lines[1].content, "");

        // Empty line on left, added on right
        assert!(matches!(result.left_lines[2].line_type, LineType::Unchanged));
        assert!(matches!(result.right_lines[2].line_type, LineType::Added));
        assert_eq!(result.left_lines[2].content, "");
        assert_eq!(result.right_lines[2].content, "line 2 modified");

        // Line 3: unchanged on both sides
        assert!(matches!(result.left_lines[3].line_type, LineType::Unchanged));
        assert!(matches!(result.right_lines[3].line_type, LineType::Unchanged));
        assert_eq!(result.left_lines[3].content, "line 3");
        assert_eq!(result.right_lines[3].content, "line 3");
    }

    #[test]
    fn test_compute_split_diff_addition() {
        let old = "line 1\nline 2";
        let new = "line 1\nline 2\nline 3";

        let result = compute_split_diff(old, new);

        assert_eq!(result.left_lines.len(), 3);
        assert_eq!(result.right_lines.len(), 3);

        // Line 1: unchanged
        assert!(matches!(result.left_lines[0].line_type, LineType::Unchanged));
        assert!(matches!(result.right_lines[0].line_type, LineType::Unchanged));

        // Line 2: unchanged
        assert!(matches!(result.left_lines[1].line_type, LineType::Unchanged));
        assert!(matches!(result.right_lines[1].line_type, LineType::Unchanged));

        // Line 3: empty on left, added on right
        assert!(matches!(result.left_lines[2].line_type, LineType::Unchanged));
        assert!(matches!(result.right_lines[2].line_type, LineType::Added));
        assert_eq!(result.left_lines[2].content, "");
        assert_eq!(result.right_lines[2].content, "line 3");
    }

    #[test]
    fn test_compute_split_diff_deletion() {
        let old = "line 1\nline 2\nline 3";
        let new = "line 1\nline 2";

        let result = compute_split_diff(old, new);

        assert_eq!(result.left_lines.len(), 3);
        assert_eq!(result.right_lines.len(), 3);

        // Line 1: unchanged
        assert!(matches!(result.left_lines[0].line_type, LineType::Unchanged));
        assert!(matches!(result.right_lines[0].line_type, LineType::Unchanged));

        // Line 2: unchanged
        assert!(matches!(result.left_lines[1].line_type, LineType::Unchanged));
        assert!(matches!(result.right_lines[1].line_type, LineType::Unchanged));

        // Line 3: removed on left, empty on right
        assert!(matches!(result.left_lines[2].line_type, LineType::Removed));
        assert!(matches!(result.right_lines[2].line_type, LineType::Unchanged));
        assert_eq!(result.left_lines[2].content, "line 3");
        assert_eq!(result.right_lines[2].content, "");
    }

    #[test]
    fn test_compute_split_diff_line_numbers() {
        let old = "line 1\nline 2\nline 3";
        let new = "line 1\nline 2 modified\nline 3";

        let result = compute_split_diff(old, new);

        // Check line numbers for the first unchanged line
        assert_eq!(result.left_lines[0].old_line_number, Some(1));
        assert_eq!(result.left_lines[0].new_line_number, None);
        assert_eq!(result.right_lines[0].old_line_number, None);
        assert_eq!(result.right_lines[0].new_line_number, Some(1));

        // Check line numbers for the removed line
        assert_eq!(result.left_lines[1].old_line_number, Some(2));
        assert_eq!(result.left_lines[1].new_line_number, None);
        assert_eq!(result.right_lines[1].old_line_number, None);
        assert_eq!(result.right_lines[1].new_line_number, None); // Empty line

        // Check line numbers for the added line
        assert_eq!(result.left_lines[2].old_line_number, None); // Empty line
        assert_eq!(result.left_lines[2].new_line_number, None);
        assert_eq!(result.right_lines[2].old_line_number, None);
        assert_eq!(result.right_lines[2].new_line_number, Some(2));

        // Check line numbers for the last unchanged line
        assert_eq!(result.left_lines[3].old_line_number, Some(3));
        assert_eq!(result.left_lines[3].new_line_number, None);
        assert_eq!(result.right_lines[3].old_line_number, None);
        assert_eq!(result.right_lines[3].new_line_number, Some(3));
    }

    // ===== calculate_diff_stats Tests =====

    #[test]
    fn test_calculate_diff_stats_empty() {
        let lines = Vec::new();
        let stats = calculate_diff_stats(&lines);
        assert_eq!(stats.additions, 0);
        assert_eq!(stats.deletions, 0);
    }

    #[test]
    fn test_calculate_diff_stats_basic() {
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
    fn test_calculate_diff_stats_multiple_changes() {
        let lines = vec![
            DiffLine { content: "added 1".to_string(), line_type: LineType::Added, old_line_number: None, new_line_number: Some(1), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "added 2".to_string(), line_type: LineType::Added, old_line_number: None, new_line_number: Some(2), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "removed 1".to_string(), line_type: LineType::Removed, old_line_number: Some(3), new_line_number: None, is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "removed 2".to_string(), line_type: LineType::Removed, old_line_number: Some(4), new_line_number: None, is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "removed 3".to_string(), line_type: LineType::Removed, old_line_number: Some(5), new_line_number: None, is_collapsible: None, collapsed_count: None, collapsed_lines: None },
        ];

        let stats = calculate_diff_stats(&lines);
        assert_eq!(stats.additions, 2);
        assert_eq!(stats.deletions, 3);
    }

    #[test]
    fn test_calculate_diff_stats_with_collapsible() {
        let collapsed_lines = vec![
            DiffLine { content: "collapsed added".to_string(), line_type: LineType::Added, old_line_number: None, new_line_number: Some(1), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "collapsed removed".to_string(), line_type: LineType::Removed, old_line_number: Some(2), new_line_number: None, is_collapsible: None, collapsed_count: None, collapsed_lines: None },
        ];

        let lines = vec![
            DiffLine {
                content: "unchanged".to_string(),
                line_type: LineType::Unchanged,
                old_line_number: Some(1),
                new_line_number: Some(1),
                is_collapsible: Some(true),
                collapsed_count: Some(2),
                collapsed_lines: Some(collapsed_lines),
            },
        ];

        let stats = calculate_diff_stats(&lines);
        assert_eq!(stats.additions, 1); // From collapsed lines
        assert_eq!(stats.deletions, 1); // From collapsed lines
    }

    #[test]
    fn test_calculate_diff_stats_only_unchanged() {
        let lines = vec![
            DiffLine { content: "line 1".to_string(), line_type: LineType::Unchanged, old_line_number: Some(1), new_line_number: Some(1), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "line 2".to_string(), line_type: LineType::Unchanged, old_line_number: Some(2), new_line_number: Some(2), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
        ];

        let stats = calculate_diff_stats(&lines);
        assert_eq!(stats.additions, 0);
        assert_eq!(stats.deletions, 0);
    }

    // ===== calculate_split_diff_stats Tests =====

    #[test]
    fn test_calculate_split_diff_stats_empty() {
        let split = SplitDiffResult {
            left_lines: Vec::new(),
            right_lines: Vec::new(),
        };
        let stats = calculate_split_diff_stats(&split);
        assert_eq!(stats.additions, 0);
        assert_eq!(stats.deletions, 0);
    }

    #[test]
    fn test_calculate_split_diff_stats_basic() {
        let left_lines = vec![
            DiffLine { content: "line 1".to_string(), line_type: LineType::Unchanged, old_line_number: Some(1), new_line_number: None, is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "line 2".to_string(), line_type: LineType::Removed, old_line_number: Some(2), new_line_number: None, is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "".to_string(), line_type: LineType::Unchanged, old_line_number: None, new_line_number: None, is_collapsible: None, collapsed_count: None, collapsed_lines: None },
        ];

        let right_lines = vec![
            DiffLine { content: "line 1".to_string(), line_type: LineType::Unchanged, old_line_number: None, new_line_number: Some(1), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "line 2 modified".to_string(), line_type: LineType::Added, old_line_number: None, new_line_number: Some(2), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "line 3".to_string(), line_type: LineType::Added, old_line_number: None, new_line_number: Some(3), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
        ];

        let split = SplitDiffResult {
            left_lines,
            right_lines,
        };

        let stats = calculate_split_diff_stats(&split);
        assert_eq!(stats.additions, 2); // Two added lines on right
        assert_eq!(stats.deletions, 1); // One removed line on left
    }

    #[test]
    fn test_calculate_split_diff_stats_unequal_lengths() {
        let left_lines = vec![
            DiffLine { content: "line 1".to_string(), line_type: LineType::Unchanged, old_line_number: Some(1), new_line_number: None, is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "line 2".to_string(), line_type: LineType::Removed, old_line_number: Some(2), new_line_number: None, is_collapsible: None, collapsed_count: None, collapsed_lines: None },
        ];

        let right_lines = vec![
            DiffLine { content: "line 1".to_string(), line_type: LineType::Unchanged, old_line_number: None, new_line_number: Some(1), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "line 2 modified".to_string(), line_type: LineType::Added, old_line_number: None, new_line_number: Some(2), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
            DiffLine { content: "line 3".to_string(), line_type: LineType::Added, old_line_number: None, new_line_number: Some(3), is_collapsible: None, collapsed_count: None, collapsed_lines: None },
        ];

        let split = SplitDiffResult {
            left_lines,
            right_lines,
        };

        let stats = calculate_split_diff_stats(&split);
        assert_eq!(stats.additions, 2);
        assert_eq!(stats.deletions, 1);
    }

    // ===== get_file_language Tests =====

    #[test]
    fn test_get_file_language_empty_string() {
        assert_eq!(get_file_language(""), None);
    }

    #[test]
    fn test_get_file_language_no_extension() {
        assert_eq!(get_file_language("README"), None);
        assert_eq!(get_file_language("Makefile"), None);
    }

    #[test]
    fn test_get_file_language_unknown_extension() {
        assert_eq!(get_file_language("file.unknown"), None);
        assert_eq!(get_file_language("file.xyz"), None);
    }

    #[test]
    fn test_get_file_language_rust() {
        assert_eq!(get_file_language("main.rs"), Some("rust".to_string()));
        assert_eq!(get_file_language("lib.rs"), Some("rust".to_string()));
        assert_eq!(get_file_language("mod.rs"), Some("rust".to_string()));
    }

    #[test]
    fn test_get_file_language_typescript() {
        assert_eq!(get_file_language("app.ts"), Some("typescript".to_string()));
        assert_eq!(get_file_language("component.tsx"), Some("typescript".to_string()));
    }

    #[test]
    fn test_get_file_language_javascript() {
        assert_eq!(get_file_language("script.js"), Some("javascript".to_string()));
        assert_eq!(get_file_language("app.jsx"), Some("javascript".to_string()));
    }

    #[test]
    fn test_get_file_language_python() {
        assert_eq!(get_file_language("script.py"), Some("python".to_string()));
        assert_eq!(get_file_language("app.py"), Some("python".to_string()));
    }

    #[test]
    fn test_get_file_language_go() {
        assert_eq!(get_file_language("main.go"), Some("go".to_string()));
        assert_eq!(get_file_language("server.go"), Some("go".to_string()));
    }

    #[test]
    fn test_get_file_language_java() {
        assert_eq!(get_file_language("Main.java"), Some("java".to_string()));
        assert_eq!(get_file_language("App.java"), Some("java".to_string()));
    }

    #[test]
    fn test_get_file_language_kotlin() {
        assert_eq!(get_file_language("Main.kt"), Some("kotlin".to_string()));
        assert_eq!(get_file_language("App.kt"), Some("kotlin".to_string()));
    }

    #[test]
    fn test_get_file_language_swift() {
        assert_eq!(get_file_language("ViewController.swift"), Some("swift".to_string()));
        assert_eq!(get_file_language("App.swift"), Some("swift".to_string()));
    }

    #[test]
    fn test_get_file_language_c_cpp() {
        assert_eq!(get_file_language("main.c"), Some("c".to_string()));
        assert_eq!(get_file_language("header.h"), Some("c".to_string()));
        assert_eq!(get_file_language("main.cpp"), Some("cpp".to_string()));
        assert_eq!(get_file_language("main.cc"), Some("cpp".to_string()));
        assert_eq!(get_file_language("main.cxx"), Some("cpp".to_string()));
    }

    #[test]
    fn test_get_file_language_csharp() {
        assert_eq!(get_file_language("Program.cs"), Some("csharp".to_string()));
        assert_eq!(get_file_language("App.cs"), Some("csharp".to_string()));
    }

    #[test]
    fn test_get_file_language_ruby() {
        assert_eq!(get_file_language("script.rb"), Some("ruby".to_string()));
        assert_eq!(get_file_language("app.rb"), Some("ruby".to_string()));
    }

    #[test]
    fn test_get_file_language_php() {
        assert_eq!(get_file_language("index.php"), Some("php".to_string()));
        assert_eq!(get_file_language("app.php"), Some("php".to_string()));
    }

    #[test]
    fn test_get_file_language_shell() {
        assert_eq!(get_file_language("script.sh"), Some("bash".to_string()));
        assert_eq!(get_file_language("script.bash"), Some("bash".to_string()));
        assert_eq!(get_file_language("script.zsh"), Some("bash".to_string()));
    }

    #[test]
    fn test_get_file_language_json() {
        assert_eq!(get_file_language("package.json"), Some("json".to_string()));
        assert_eq!(get_file_language("config.json"), Some("json".to_string()));
    }

    #[test]
    fn test_get_file_language_yaml() {
        assert_eq!(get_file_language("config.yml"), Some("yaml".to_string()));
        assert_eq!(get_file_language("config.yaml"), Some("yaml".to_string()));
    }

    #[test]
    fn test_get_file_language_toml() {
        assert_eq!(get_file_language("Cargo.toml"), Some("toml".to_string()));
        assert_eq!(get_file_language("config.toml"), Some("toml".to_string()));
    }

    #[test]
    fn test_get_file_language_markdown() {
        assert_eq!(get_file_language("README.md"), Some("markdown".to_string()));
        assert_eq!(get_file_language("doc.md"), Some("markdown".to_string()));
    }

    #[test]
    fn test_get_file_language_css() {
        assert_eq!(get_file_language("styles.css"), Some("css".to_string()));
        assert_eq!(get_file_language("app.scss"), Some("scss".to_string()));
        assert_eq!(get_file_language("styles.less"), Some("less".to_string()));
    }

    #[test]
    fn test_get_file_language_case_insensitive() {
        assert_eq!(get_file_language("MAIN.RS"), Some("rust".to_string()));
        assert_eq!(get_file_language("Script.JS"), Some("javascript".to_string()));
        assert_eq!(get_file_language("readme.MD"), Some("markdown".to_string()));
    }

    #[test]
    fn test_get_file_language_multiple_dots() {
        assert_eq!(get_file_language("test.min.js"), Some("javascript".to_string()));
        assert_eq!(get_file_language("component.d.ts"), Some("typescript".to_string()));
        assert_eq!(get_file_language("archive.tar.gz"), None);
    }

    // ===== ensure_trailing_newline Tests =====

    #[test]
    fn test_ensure_trailing_newline_empty() {
        let result = ensure_trailing_newline("");
        assert_eq!(result, "");
    }

    #[test]
    fn test_ensure_trailing_newline_with_newline() {
        let input = "line 1\nline 2\n";
        let result = ensure_trailing_newline(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_ensure_trailing_newline_without_newline() {
        let input = "line 1\nline 2";
        let result = ensure_trailing_newline(input);
        assert_eq!(result, "line 1\nline 2\n");
    }

    #[test]
    fn test_ensure_trailing_newline_single_line() {
        let input = "single line";
        let result = ensure_trailing_newline(input);
        assert_eq!(result, "single line\n");
    }

    // ===== Integration Tests =====

    #[test]
    fn test_unified_diff_with_collapsible_integration() {
        let old = "line 1\n".to_string() +
                  &(2..=(COLLAPSE_THRESHOLD + 2 * CONTEXT_LINES + 10))
                      .map(|i| format!("line {}\n", i))
                      .collect::<String>() +
                  "line final\n";

        let new = "line 1\n".to_string() +
                  &(2..=(COLLAPSE_THRESHOLD + 2 * CONTEXT_LINES + 10))
                      .map(|i| format!("line {}\n", i))
                      .collect::<String>() +
                  "line final modified\n";

        let diff_lines = compute_unified_diff(&old, &new);
        let with_collapsible = add_collapsible_sections(diff_lines);

        // Should have collapsible sections in the middle unchanged block
        let collapsible_count = with_collapsible.iter()
            .filter(|line| line.is_collapsible.unwrap_or(false))
            .count();
        assert!(collapsible_count > 0);

        // Stats should still be correct
        let stats = calculate_diff_stats(&with_collapsible);
        assert_eq!(stats.additions, 1);
        assert_eq!(stats.deletions, 1);
    }

    #[test]
    fn test_split_diff_stats_consistency() {
        let old = "line 1\nline 2\nline 3\nline 4";
        let new = "line 1\nline 2 modified\nline 3\nline 4\nline 5";

        let unified_lines = compute_unified_diff(old, new);
        let split_result = compute_split_diff(old, new);

        let unified_stats = calculate_diff_stats(&unified_lines);
        let split_stats = calculate_split_diff_stats(&split_result);

        // Both should report the same stats
        assert_eq!(unified_stats.additions, split_stats.additions);
        assert_eq!(unified_stats.deletions, split_stats.deletions);
    }

    // ===== Performance Tests =====

    #[test]
    fn test_large_diff_performance() {
        // Generate large files for performance testing
        let old_lines = 5000;
        let new_lines = 5000;

        let old_content = (0..old_lines)
            .map(|i| format!("line {}\n", i))
            .collect::<String>();

        let new_content = (0..new_lines)
            .map(|i| {
                if i % 100 == 50 {
                    format!("modified line {}\n", i)
                } else {
                    format!("line {}\n", i)
                }
            })
            .collect::<String>();

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

    #[test]
    fn test_memory_efficiency_large_files() {
        // Test that we don't use excessive memory for large files
        let large_content = "x".repeat(100_000);
        let slightly_modified = "x".repeat(99_000) + &"y".repeat(1_000);

        let start = std::time::Instant::now();
        let result = compute_unified_diff(&large_content, &slightly_modified);
        let duration = start.elapsed();

        // Should complete quickly and not use excessive memory
        assert!(duration.as_millis() < 1000, "Large diff took too long: {}ms", duration.as_millis());
        assert!(result.len() > 0, "Should produce diff lines");
    }

    // ===== Edge Case Tests =====

    #[test]
    fn test_extreme_edge_cases() {
        // Test with very long lines
        let long_line = "x".repeat(10000);
        let old = format!("{}\nshort", long_line);
        let new = format!("{}\nmodified", long_line);

        let result = compute_unified_diff(&old, &new);
        assert_eq!(result.len(), 3);
        assert!(matches!(result[0].line_type, LineType::Unchanged));
        assert!(matches!(result[1].line_type, LineType::Removed));
        assert!(matches!(result[2].line_type, LineType::Added));

        // Test with many small changes
        let old_many = (0..100).map(|i| format!("line {}\n", i)).collect::<String>();
        let new_many = (0..100).map(|i| {
            if i % 2 == 0 {
                format!("line {} even\n", i)
            } else {
                format!("line {}\n", i)
            }
        }).collect::<String>();

        let result_many = compute_unified_diff(&old_many, &new_many);
        // Should have 50 unchanged + 50 removed + 50 added = 150 lines
        assert_eq!(result_many.len(), 150);
    }

    #[test]
    fn test_binary_like_content() {
        // Test with content that looks like binary data
        let old = "line 1\n\x00\x01\x02\nline 3";
        let new = "line 1\n\x00\x01\x03\nline 3";

        let result = compute_unified_diff(old, new);
        assert_eq!(result.len(), 4);
        // Should handle binary-like content gracefully
    }

    #[test]
    fn test_windows_line_endings() {
        let old = "line 1\r\nline 2\r\n";
        let new = "line 1\r\nline 2 modified\r\n";

        let result = compute_unified_diff(old, new);
        // Should handle CRLF line endings
        assert!(result.len() >= 3);
    }

    #[test]
    fn test_mixed_line_endings() {
        let old = "line 1\nline 2\r\nline 3\n";
        let new = "line 1\nline 2 modified\r\nline 3\n";

        let result = compute_unified_diff(old, new);
        // Should handle mixed line endings
        assert!(result.len() >= 3);
    }
}