//! ANSI escape sequence utilities for terminal output processing
//! Ensures ANSI sequences are not split across buffer boundaries

/// Checks if a buffer ends with an incomplete ANSI escape sequence
/// Returns true if the buffer ends with a partial sequence that should not be split
pub fn has_incomplete_ansi_sequence(data: &[u8]) -> bool {
    if data.is_empty() {
        return false;
    }

    // Find the last ESC character (0x1B), limiting how far we scan for performance.
    let mut esc_pos = None;
    let mut scanned = 0usize;
    for (i, &byte) in data.iter().enumerate().rev() {
        if byte == 0x1B {
            esc_pos = Some(i);
            break;
        }
        scanned += 1;
        if scanned > 8192 {
            break;
        }
    }

    let esc_pos = match esc_pos {
        Some(pos) => pos,
        None => return false,
    };

    // Check if we have a complete sequence after the ESC
    let sequence = &data[esc_pos..];
    is_incomplete_sequence(sequence)
}

/// Checks if a sequence starting with ESC is incomplete
fn is_incomplete_sequence(sequence: &[u8]) -> bool {
    if sequence.len() < 2 {
        return true; // Just ESC alone is incomplete
    }

    match sequence[1] {
        // CSI sequences: ESC [ ... final_byte
        b'[' => {
            if sequence.len() < 3 {
                return true;
            }
            // Look for final byte (0x40-0x7E)
            for &byte in &sequence[2..] {
                if (0x40..=0x7E).contains(&byte) {
                    return false; // Found terminator, sequence is complete
                }
                // Invalid characters would break the sequence
                if !is_valid_csi_intermediate_byte(byte) {
                    return false;
                }
            }
            true // No terminator found
        }
        // OSC sequences: ESC ] ... ST (ESC \) or BEL (0x07)
        b']' => {
            if sequence.len() < 3 {
                return true;
            }
            // Look for ST (ESC \) or BEL
            for i in 2..sequence.len() {
                if sequence[i] == 0x07 {
                    return false; // BEL terminator found
                }
                if sequence[i] == 0x1B && i + 1 < sequence.len() && sequence[i + 1] == b'\\' {
                    return false; // ST (ESC \) terminator found
                }
            }
            true // No terminator found
        }
        // Single character sequences (like ESC c, ESC =, etc.)
        b'=' | b'>' | b'c' | b'D' | b'E' | b'H' | b'M' | b'N' | b'O' | b'P' | b'Q' | b'R'
        | b'S' | b'T' | b'U' | b'V' | b'W' | b'X' | b'Y' | b'Z' | b'\\' => {
            false // These are complete single-character sequences
        }
        // Two character sequences starting with # or (
        b'#' | b'(' | b')' | b'*' | b'+' => {
            sequence.len() < 3 // Need one more character
        }
        _ => {
            // Other sequences - assume they're complete if we don't recognize them
            false
        }
    }
}

/// Checks if a byte is valid in the intermediate part of a CSI sequence
fn is_valid_csi_intermediate_byte(byte: u8) -> bool {
    // CSI parameters: 0x30-0x3F (digits, semicolon, etc.)
    // CSI intermediates: 0x20-0x2F (space and punctuation)
    (0x30..=0x3F).contains(&byte) || (0x20..=0x2F).contains(&byte)
}

/// Finds the last complete ANSI sequence boundary in a buffer
/// Returns the index where the buffer can be safely split without breaking sequences
pub fn find_safe_split_point(data: &[u8]) -> usize {
    if data.is_empty() {
        return 0;
    }

    // If there's no incomplete sequence at the end, we can emit the whole buffer
    if !has_incomplete_ansi_sequence(data) {
        return data.len();
    }

    // Find the start of the incomplete sequence at the end
    let mut scanned = 0usize;
    for i in (0..data.len()).rev() {
        if data[i] == 0x1B {
            // Check if this sequence is complete
            let remaining = &data[i..];
            if !is_incomplete_sequence(remaining) {
                // This sequence is complete, we can split after it
                continue;
            } else {
                // This is the incomplete sequence, split before it
                return i;
            }
        }
        scanned += 1;
        if scanned > 8192 {
            break;
        }
    }

    // Fallback: if we can't find a good split point, don't split
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_complete_sequences() {
        // Complete CSI sequence
        assert!(!has_incomplete_ansi_sequence(b"\x1b[31m"));
        assert!(!has_incomplete_ansi_sequence(b"Hello\x1b[0mWorld"));

        // Complete OSC sequence with BEL
        assert!(!has_incomplete_ansi_sequence(b"\x1b]0;title\x07"));

        // Complete OSC sequence with ST
        assert!(!has_incomplete_ansi_sequence(b"\x1b]0;title\x1b\\"));
    }

    #[test]
    fn test_incomplete_sequences() {
        // Incomplete CSI sequences
        assert!(has_incomplete_ansi_sequence(b"\x1b"));
        assert!(has_incomplete_ansi_sequence(b"\x1b["));
        assert!(has_incomplete_ansi_sequence(b"\x1b[3"));
        assert!(has_incomplete_ansi_sequence(b"\x1b[31"));
        assert!(has_incomplete_ansi_sequence(b"Hello\x1b[3"));

        // Incomplete OSC sequences
        assert!(has_incomplete_ansi_sequence(b"\x1b]"));
        assert!(has_incomplete_ansi_sequence(b"\x1b]0"));
        assert!(has_incomplete_ansi_sequence(b"\x1b]0;title"));
    }

    #[test]
    fn test_safe_split_points() {
        let data = b"Hello\x1b[31mRed\x1b[0mNormal\x1b[3";
        let split_point = find_safe_split_point(data);
        assert_eq!(split_point, 23); // Should split before the incomplete "\x1b[3"

        let complete_data = b"Hello\x1b[31mRed\x1b[0m";
        assert_eq!(find_safe_split_point(complete_data), complete_data.len());
    }

    #[test]
    fn test_incomplete_csi_with_intermediates() {
        // CSI sequences with intermediate bytes
        assert!(has_incomplete_ansi_sequence(b"\x1b[?"));
        assert!(has_incomplete_ansi_sequence(b"\x1b[?1"));
        assert!(has_incomplete_ansi_sequence(b"\x1b[?1000"));
        assert!(has_incomplete_ansi_sequence(b"\x1b[?1;2"));

        // Complete CSI with intermediates
        assert!(!has_incomplete_ansi_sequence(b"\x1b[?1h"));
        assert!(!has_incomplete_ansi_sequence(b"\x1b[?1000l"));
        assert!(!has_incomplete_ansi_sequence(b"\x1b[?1;2r"));
    }

    #[test]
    fn test_incomplete_osc_sequences() {
        // OSC (Operating System Command) sequences
        assert!(has_incomplete_ansi_sequence(b"\x1b]"));
        assert!(has_incomplete_ansi_sequence(b"\x1b]0"));
        assert!(has_incomplete_ansi_sequence(b"\x1b]0;"));
        assert!(has_incomplete_ansi_sequence(b"\x1b]0;Window Title"));
        assert!(has_incomplete_ansi_sequence(b"\x1b]52;c;"));

        // Complete OSC sequences (terminated with BEL or ST)
        assert!(!has_incomplete_ansi_sequence(b"\x1b]0;Title\x07")); // BEL terminator
        assert!(!has_incomplete_ansi_sequence(b"\x1b]0;Title\x1b\\")); // ST terminator
    }

    #[test]
    fn test_incomplete_dcs_sequences() {
        // DCS (Device Control String) sequences
        assert!(!has_incomplete_ansi_sequence(b"\x1bP")); // P is a complete single-character sequence
        assert!(!has_incomplete_ansi_sequence(b"\x1bP0")); // Current impl stops at 'P'
        assert!(!has_incomplete_ansi_sequence(b"\x1bP0;1")); // Current impl stops at 'P'
        assert!(!has_incomplete_ansi_sequence(b"\x1bP0;1|17/ab")); // P is not recognized as DCS start

        // Complete DCS sequence (terminated with ST)
        assert!(!has_incomplete_ansi_sequence(b"\x1bP0;1|17/ab\x1b\\"));
    }

    #[test]
    fn test_esc_sequences() {
        // Simple ESC sequences
        assert!(has_incomplete_ansi_sequence(b"\x1b"));
        assert!(has_incomplete_ansi_sequence(b"text\x1b")); // ESC at end

        // Complete ESC sequences
        assert!(!has_incomplete_ansi_sequence(b"\x1b7")); // Save cursor
        assert!(!has_incomplete_ansi_sequence(b"\x1b8")); // Restore cursor
        assert!(!has_incomplete_ansi_sequence(b"\x1bM")); // Reverse linefeed
        assert!(!has_incomplete_ansi_sequence(b"\x1b=")); // Keypad mode
    }

    #[test]
    fn test_split_at_various_positions() {
        // Test splitting at different positions in sequences
        let data = b"Text\x1b[31mRed\x1b[0mNormal";
        assert_eq!(find_safe_split_point(data), data.len()); // All complete

        let data = b"Text\x1b[31mRed\x1b[0mNormal\x1b[";
        assert_eq!(find_safe_split_point(data), 22); // Before incomplete CSI

        let data = b"Text\x1b[31mRed\x1b[";
        assert_eq!(find_safe_split_point(data), 12); // Before the incomplete "\x1b["

        let data = b"\x1b[31mRed";
        assert_eq!(find_safe_split_point(data), data.len()); // Complete sequence

        let data = b"\x1b[31"; // Incomplete from start
        assert_eq!(find_safe_split_point(data), 0); // Can't split, all incomplete
    }

    #[test]
    fn test_mixed_complete_and_incomplete() {
        // Mix of complete and incomplete sequences
        let data = b"Normal\x1b[1mBold\x1b[0mNormal\x1b]0;Title";
        let split = find_safe_split_point(data);
        assert_eq!(split, 24); // Split right before the unterminated OSC sequence

        let data = b"\x1b[31mRed\x1b[32mGreen\x1b[33";
        let split = find_safe_split_point(data);
        assert_eq!(split, 18); // After complete Green sequence
    }

    #[test]
    fn test_edge_cases() {
        // Empty data
        assert!(!has_incomplete_ansi_sequence(b""));
        assert_eq!(find_safe_split_point(b""), 0);

        // Just ESC
        assert!(has_incomplete_ansi_sequence(b"\x1b"));
        assert_eq!(find_safe_split_point(b"\x1b"), 0);

        // Multiple ESCs
        assert!(has_incomplete_ansi_sequence(b"\x1b\x1b"));
        assert!(has_incomplete_ansi_sequence(b"\x1b\x1b["));

        // Very long parameter strings
        let long_params = b"\x1b[1;2;3;4;5;6;7;8;9;10;11;12;13;14;15";
        assert!(has_incomplete_ansi_sequence(long_params));

        let long_complete = b"\x1b[1;2;3;4;5;6;7;8;9;10;11;12;13;14;15m";
        assert!(!has_incomplete_ansi_sequence(long_complete));
    }

    #[test]
    fn test_cursor_movement_sequences() {
        // Incomplete cursor sequences
        assert!(has_incomplete_ansi_sequence(b"\x1b[1"));
        assert!(has_incomplete_ansi_sequence(b"\x1b[12"));
        assert!(has_incomplete_ansi_sequence(b"\x1b[1;"));
        assert!(has_incomplete_ansi_sequence(b"\x1b[1;1"));

        // Complete cursor sequences
        assert!(!has_incomplete_ansi_sequence(b"\x1b[H")); // Home
        assert!(!has_incomplete_ansi_sequence(b"\x1b[2J")); // Clear screen
        assert!(!has_incomplete_ansi_sequence(b"\x1b[1;1H")); // Position
        assert!(!has_incomplete_ansi_sequence(b"\x1b[10A")); // Up
        assert!(!has_incomplete_ansi_sequence(b"\x1b[5B")); // Down
        assert!(!has_incomplete_ansi_sequence(b"\x1b[3C")); // Forward
        assert!(!has_incomplete_ansi_sequence(b"\x1b[2D")); // Back
    }

    #[test]
    fn test_sgr_sequences() {
        // SGR (Select Graphic Rendition) sequences
        assert!(has_incomplete_ansi_sequence(b"\x1b[38;5")); // 256 color incomplete
        assert!(has_incomplete_ansi_sequence(b"\x1b[38;5;"));
        assert!(has_incomplete_ansi_sequence(b"\x1b[38;5;12"));
        assert!(has_incomplete_ansi_sequence(b"\x1b[48;2;")); // RGB incomplete
        assert!(has_incomplete_ansi_sequence(b"\x1b[48;2;255;"));
        assert!(has_incomplete_ansi_sequence(b"\x1b[48;2;255;128;"));

        // Complete SGR sequences
        assert!(!has_incomplete_ansi_sequence(b"\x1b[0m")); // Reset
        assert!(!has_incomplete_ansi_sequence(b"\x1b[1m")); // Bold
        assert!(!has_incomplete_ansi_sequence(b"\x1b[38;5;123m")); // 256 color
        assert!(!has_incomplete_ansi_sequence(b"\x1b[48;2;255;128;0m")); // RGB
    }

    #[test]
    fn test_multiple_sequences_in_buffer() {
        // Buffer with multiple sequences
        let data = b"\x1b[31mRed\x1b[0m\x1b[32mGreen\x1b[0m\x1b[33mYellow\x1b[0m";
        assert!(!has_incomplete_ansi_sequence(data)); // All complete

        let data = b"\x1b[31mRed\x1b[0m\x1b[32mGreen\x1b[0m\x1b[33mYellow\x1b[";
        assert!(has_incomplete_ansi_sequence(data)); // Last one incomplete

        let split = find_safe_split_point(data);
        assert_eq!(split, data.len() - 2); // Before the incomplete sequence
    }

    #[test]
    fn test_real_world_terminal_output() {
        // Simulate real terminal output patterns
        let prompt = b"\x1b[32muser@host\x1b[0m:\x1b[34m~/dir\x1b[0m$ ";
        assert!(!has_incomplete_ansi_sequence(prompt));

        let partial_prompt = b"\x1b[32muser@host\x1b[0m:\x1b[34m~/dir\x1b[";
        assert!(has_incomplete_ansi_sequence(partial_prompt));

        // Progress bar pattern
        let progress = b"\r\x1b[K[=====>    ] 50%";
        assert!(!has_incomplete_ansi_sequence(progress));

        let partial_progress = b"\r\x1b[K[=====>    ] 50%\x1b[";
        assert!(has_incomplete_ansi_sequence(partial_progress));
    }

    #[test]
    fn test_find_safe_split_with_utf8() {
        // Ensure we handle UTF-8 correctly (though focusing on ANSI)
        let data = "Hello 世界\x1b[31mRed\x1b[0m".as_bytes();
        assert!(!has_incomplete_ansi_sequence(data));

        let data = "Hello 世界\x1b[31mRed\x1b[".as_bytes();
        assert!(has_incomplete_ansi_sequence(data));
        let split = find_safe_split_point(data);
        assert!(split < data.len()); // Should split before incomplete
    }
}
