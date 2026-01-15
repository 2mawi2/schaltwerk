#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SequenceResponse {
    Immediate(Vec<u8>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowSizeRequest {
    Cells,
    Pixels,
    CellPixels,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanitizedOutput {
    pub data: Vec<u8>,
    pub remainder: Option<Vec<u8>>,
    pub cursor_query_offsets: Vec<usize>,
    pub window_size_requests: Vec<WindowSizeRequest>,
    pub responses: Vec<SequenceResponse>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ControlSequenceAction {
    Respond(&'static [u8]),
    RespondDynamic(Vec<u8>),
    RespondCursorPosition,
    RespondWindowSize(WindowSizeRequest),
    Drop,
    Pass,
}

fn build_decrqm_response(params: &[u8]) -> Option<Vec<u8>> {
    let trimmed = params.strip_suffix(b"$")?;
    if trimmed.is_empty() {
        return None;
    }
    if trimmed
        .iter()
        .all(|byte| byte.is_ascii_digit() || *byte == b';')
    {
        Some(format!("\x1b[?{};2$y", String::from_utf8_lossy(trimmed)).into_bytes())
    } else {
        None
    }
}

fn analyze_control_sequence(
    prefix: Option<u8>,
    params: &[u8],
    terminator: u8,
) -> ControlSequenceAction {
    match terminator {
        b'n' => {
            if params == b"5" && prefix.is_none() {
                ControlSequenceAction::Respond(b"\x1b[0n")
            } else if params == b"6" && (prefix.is_none() || prefix == Some(b'?')) {
                ControlSequenceAction::RespondCursorPosition
            } else {
                ControlSequenceAction::Pass
            }
        }
        b'c' => match prefix {
            // Secondary DA: \x1b[>c or \x1b[>0c is a query, \x1b[>0;95;0c is a response
            Some(b'>') => {
                if params.is_empty() || params == b"0" {
                    ControlSequenceAction::Respond(b"\x1b[>0;95;0c")
                } else {
                    // It's a response (has params) - drop to prevent loops
                    ControlSequenceAction::Drop
                }
            }
            // Primary DA response \x1b[?...c - always drop (queries don't have ? prefix)
            Some(b'?') => ControlSequenceAction::Drop,
            // Primary DA query \x1b[c or \x1b[0c - respond
            None => ControlSequenceAction::Respond(b"\x1b[?1;2c"),
            _ => ControlSequenceAction::Pass,
        },
        b'R' => ControlSequenceAction::Drop,
        b'M' | b'm' => {
            if prefix == Some(b'<') {
                ControlSequenceAction::Drop
            } else {
                ControlSequenceAction::Pass
            }
        }
        b't' => {
            if prefix.is_none() && params == b"18" {
                ControlSequenceAction::RespondWindowSize(WindowSizeRequest::Cells)
            } else if prefix.is_none() && params == b"14" {
                ControlSequenceAction::RespondWindowSize(WindowSizeRequest::Pixels)
            } else if prefix.is_none() && params == b"16" {
                ControlSequenceAction::RespondWindowSize(WindowSizeRequest::CellPixels)
            } else {
                ControlSequenceAction::Pass
            }
        }
        b'p' => {
            if prefix == Some(b'?') {
                if let Some(response) = build_decrqm_response(params) {
                    ControlSequenceAction::RespondDynamic(response)
                } else {
                    ControlSequenceAction::Pass
                }
            } else {
                ControlSequenceAction::Pass
            }
        }
        _ => ControlSequenceAction::Pass,
    }
}

pub fn sanitize_control_sequences(input: &[u8]) -> SanitizedOutput {
    let mut data = Vec::with_capacity(input.len());
    let mut remainder = None;
    let mut cursor_query_offsets = Vec::new();
    let mut window_size_requests = Vec::new();
    let mut responses = Vec::new();

    let mut i = 0;
    while i < input.len() {
        if input[i] != 0x1b {
            data.push(input[i]);
            i += 1;
            continue;
        }

        if i + 1 >= input.len() {
            remainder = Some(input[i..].to_vec());
            break;
        }

        let kind = input[i + 1];
        match kind {
            b'[' => {
                let mut cursor = i + 2;
                let prefix = if cursor < input.len()
                    && (input[cursor] == b'?' || input[cursor] == b'>' || input[cursor] == b'<')
                {
                    let p = input[cursor];
                    cursor += 1;
                    Some(p)
                } else {
                    None
                };

                let params_start = cursor;
                while cursor < input.len() {
                    let byte = input[cursor];
                    // Parameter bytes per ANSI spec: 0x30-0x3F (includes 0-9:;<=>?)
                    if (0x30..=0x3F).contains(&byte) {
                        cursor += 1;
                        continue;
                    }
                    // Intermediate bytes: 0x20-0x2F (spaces/punctuation)
                    if (0x20..=0x2F).contains(&byte) {
                        cursor += 1;
                        continue;
                    }
                    break;
                }

                if cursor >= input.len() {
                    remainder = Some(input[i..].to_vec());
                    break;
                }

                let terminator = input[cursor];
                let params = &input[params_start..cursor];
                let action = analyze_control_sequence(prefix, params, terminator);

                match action {
                    ControlSequenceAction::Respond(reply) => {
                        log::trace!("Handled terminal query {:?}", &input[i..=cursor]);
                        responses.push(SequenceResponse::Immediate(reply.to_vec()));
                        i = cursor + 1;
                    }
                    ControlSequenceAction::RespondDynamic(reply) => {
                        log::trace!("Handled terminal query {:?}", &input[i..=cursor]);
                        responses.push(SequenceResponse::Immediate(reply));
                        i = cursor + 1;
                    }
                    ControlSequenceAction::RespondCursorPosition => {
                        log::trace!("Captured cursor position query {:?}", &input[i..=cursor]);
                        cursor_query_offsets.push(data.len());
                        i = cursor + 1;
                    }
                    ControlSequenceAction::RespondWindowSize(request) => {
                        log::trace!("Captured window size query {:?}", &input[i..=cursor]);
                        window_size_requests.push(request);
                        i = cursor + 1;
                    }
                    ControlSequenceAction::Drop => {
                        log::trace!("Dropped terminal handshake {:?}", &input[i..=cursor]);
                        i = cursor + 1;
                    }
                    ControlSequenceAction::Pass => {
                        const KNOWN_TERMINATORS: &[u8] = b"mHJKABCDrhls@PLMGdfSTtupXZq";
                        if !KNOWN_TERMINATORS.contains(&terminator) {
                            log::debug!(
                                "Unknown CSI sequence passing through: prefix={:?} params={:?} terminator={:?}",
                                prefix.map(|b| b as char),
                                std::str::from_utf8(params).unwrap_or("<invalid utf8>"),
                                terminator as char
                            );
                        }
                        data.extend_from_slice(&input[i..=cursor]);
                        i = cursor + 1;
                    }
                }
                continue;
            }
            b'P' => {
                let mut cursor = i + 2;
                let mut terminator_index = None;
                while cursor < input.len() {
                    if input[cursor] == 0x1b && cursor + 1 < input.len() && input[cursor + 1] == b'\\'
                    {
                        terminator_index = Some(cursor);
                        break;
                    }
                    cursor += 1;
                }

                if let Some(term_idx) = terminator_index {
                    data.extend_from_slice(&input[i..=term_idx + 1]);
                    i = term_idx + 2;
                } else {
                    remainder = Some(input[i..].to_vec());
                    break;
                }
                continue;
            }
            b']' => {
                let mut cursor = i + 2;
                let mut terminator_index = None;
                let mut terminator_len = 0usize;
                while cursor < input.len() {
                    if input[cursor] == 0x07 {
                        terminator_index = Some(cursor);
                        terminator_len = 1;
                        break;
                    }
                    if input[cursor] == 0x1b
                        && cursor + 1 < input.len()
                        && input[cursor + 1] == b'\\'
                    {
                        terminator_index = Some(cursor);
                        terminator_len = 2;
                        break;
                    }
                    cursor += 1;
                }

                if let Some(term_idx) = terminator_index {
                    if let Ok(text) = std::str::from_utf8(&input[i + 2..term_idx]) {
                        if text.starts_with("10;?") {
                            log::trace!("Responding to OSC foreground query {text:?}");
                            responses.push(SequenceResponse::Immediate(
                                b"\x1b]10;rgb:ef/ef/ef\x07".to_vec(),
                            ));
                            i = term_idx + terminator_len;
                        } else if text.starts_with("11;?") {
                            log::trace!("Responding to OSC background query {text:?}");
                            responses.push(SequenceResponse::Immediate(
                                b"\x1b]11;rgb:1e/1e/1e\x07".to_vec(),
                            ));
                            i = term_idx + terminator_len;
                        } else if text.starts_with("8;") {
                            data.extend_from_slice(&input[i..=term_idx + terminator_len - 1]);
                            i = term_idx + terminator_len;
                        } else {
                            let osc_code = text.split(';').next().and_then(|s| s.parse::<u32>().ok());
                            const KNOWN_OSC_CODES: &[u32] = &[0, 1, 2, 4, 7, 9, 52, 133, 1337];
                            if !osc_code.map(|c| KNOWN_OSC_CODES.contains(&c)).unwrap_or(false) {
                                log::debug!("Unknown OSC sequence passing through: {text:?}");
                            }
                            data.extend_from_slice(&input[i..=term_idx + terminator_len - 1]);
                            i = term_idx + terminator_len;
                        }
                    } else {
                        data.extend_from_slice(&input[i..=term_idx + terminator_len - 1]);
                        i = term_idx + terminator_len;
                    }
                } else {
                    remainder = Some(input[i..].to_vec());
                    break;
                }
                continue;
            }
            _ => {
                const KNOWN_ESC_KINDS: &[u8] = b"78MDEc=>()\\";
                if !KNOWN_ESC_KINDS.contains(&kind) {
                    log::debug!(
                        "Unknown escape sequence passing through: ESC {:?}",
                        kind as char
                    );
                }
                data.push(input[i]);
                i += 1;
                continue;
            }
        }
    }

    SanitizedOutput {
        data,
        remainder,
        cursor_query_offsets,
        window_size_requests,
        responses,
    }
}

#[cfg(test)]
mod tests {
    use super::{SanitizedOutput, SequenceResponse, WindowSizeRequest, sanitize_control_sequences};

    #[test]
    fn handles_cursor_position_queries() {
        let result = sanitize_control_sequences(b"pre\x1b[6npost");
        assert_eq!(
            result,
            SanitizedOutput {
                data: b"prepost".to_vec(),
                remainder: None,
                cursor_query_offsets: vec![3],
                window_size_requests: Vec::new(),
                responses: Vec::new(),
            }
        );
    }

    #[test]
    fn captures_window_size_queries() {
        let result = sanitize_control_sequences(b"pre\x1b[18t\x1b[14t\x1b[16tpost");
        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
        assert_eq!(
            result.window_size_requests,
            vec![
                WindowSizeRequest::Cells,
                WindowSizeRequest::Pixels,
                WindowSizeRequest::CellPixels,
            ]
        );
    }

    #[test]
    fn responds_to_dec_private_mode_query() {
        let result = sanitize_control_sequences(b"pre\x1b[?12$ppost");
        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.window_size_requests.is_empty());
        assert_eq!(result.responses.len(), 1);
        assert_eq!(
            result.responses[0],
            SequenceResponse::Immediate(b"\x1b[?12;2$y".to_vec())
        );
    }

    #[test]
    fn responds_to_dec_private_mode_query_with_other_param() {
        let result = sanitize_control_sequences(b"pre\x1b[?2004$ppost");
        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.window_size_requests.is_empty());
        assert_eq!(result.responses.len(), 1);
        assert_eq!(
            result.responses[0],
            SequenceResponse::Immediate(b"\x1b[?2004;2$y".to_vec())
        );
    }

    #[test]
    fn passes_through_dcs_sequences() {
        let sequence = b"pre\x1bP1;2|abcd\x1b\\post";
        let result = sanitize_control_sequences(sequence);
        assert_eq!(result.data, sequence);
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.window_size_requests.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn passes_through_unknown_sequences() {
        let result = sanitize_control_sequences(b"pre\x1b[123Xpost");
        assert_eq!(result.data, b"pre\x1b[123Xpost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn drops_sgr_mouse_sequences() {
        let sequence = b"\x1b[<35;85;40M";
        let result = sanitize_control_sequences(sequence);

        assert!(result.data.is_empty());
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn drops_sgr_mouse_release_sequences() {
        let sequence = b"\x1b[<0;12;24m";
        let result = sanitize_control_sequences(sequence);

        assert!(result.data.is_empty());
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn preserves_partial_sequences_as_remainder() {
        let result = sanitize_control_sequences(b"partial\x1b[");
        assert_eq!(result.data, b"partial");
        assert_eq!(result.remainder, Some(b"\x1b[".to_vec()));
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn responds_to_foreground_query() {
        let result = sanitize_control_sequences(b"pre\x1b]10;?\x07post");

        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());

        assert_eq!(result.responses.len(), 1);
        assert_eq!(
            result.responses[0],
            SequenceResponse::Immediate(b"\x1b]10;rgb:ef/ef/ef\x07".to_vec()),
        );
    }

    #[test]
    fn responds_to_background_query() {
        let result = sanitize_control_sequences(b"pre\x1b]11;?\x1b\\post");

        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());

        assert_eq!(result.responses.len(), 1);
        assert_eq!(
            result.responses[0],
            SequenceResponse::Immediate(b"\x1b]11;rgb:1e/1e/1e\x07".to_vec()),
        );
    }

    #[test]
    fn passes_through_osc_8_hyperlinks() {
        let result =
            sanitize_control_sequences(b"pre\x1b]8;;https://example.com\x07link\x1b]8;;\x07post");

        assert_eq!(
            result.data,
            b"pre\x1b]8;;https://example.com\x07link\x1b]8;;\x07post"
        );
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn passes_through_osc_8_hyperlinks_with_bel_terminator() {
        let result = sanitize_control_sequences(
            b"pre\x1b]8;;https://example.com\x07linktext\x1b]8;;\x07post",
        );

        assert_eq!(
            result.data,
            b"pre\x1b]8;;https://example.com\x07linktext\x1b]8;;\x07post"
        );
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn passes_through_osc_8_hyperlinks_with_st_terminator() {
        let result = sanitize_control_sequences(
            b"pre\x1b]8;id=123;https://example.com\x1b\\linktext\x1b]8;;\x1b\\post",
        );

        assert_eq!(
            result.data,
            b"pre\x1b]8;id=123;https://example.com\x1b\\linktext\x1b]8;;\x1b\\post"
        );
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn passes_through_osc_9_4_progress() {
        let result = sanitize_control_sequences(b"pre\x1b]9;4;3;50\x07post");

        assert_eq!(result.data, b"pre\x1b]9;4;3;50\x07post");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn passes_through_unknown_osc_sequences() {
        let result = sanitize_control_sequences(b"pre\x1b]133;A\x07post");

        assert_eq!(result.data, b"pre\x1b]133;A\x07post");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn responds_to_primary_da_query() {
        // \x1b[c is a primary DA query - we should respond
        let result = sanitize_control_sequences(b"pre\x1b[cpost");
        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert_eq!(result.responses.len(), 1);
        assert_eq!(
            result.responses[0],
            SequenceResponse::Immediate(b"\x1b[?1;2c".to_vec())
        );
    }

    #[test]
    fn responds_to_primary_da_query_with_zero_param() {
        // \x1b[0c is also a primary DA query - we should respond
        let result = sanitize_control_sequences(b"pre\x1b[0cpost");
        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert_eq!(result.responses.len(), 1);
        assert_eq!(
            result.responses[0],
            SequenceResponse::Immediate(b"\x1b[?1;2c".to_vec())
        );
    }

    #[test]
    fn drops_da_response_to_prevent_loop() {
        // \x1b[?1;2c is a DA RESPONSE, not a query
        // We must drop it to prevent infinite response loops
        let result = sanitize_control_sequences(b"pre\x1b[?1;2cpost");
        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        // Should NOT generate a response - that would cause a loop!
        assert!(result.responses.is_empty());
    }

    #[test]
    fn drops_secondary_da_response() {
        // \x1b[>0;95;0c is a secondary DA response - drop it
        let result = sanitize_control_sequences(b"pre\x1b[>0;95;0cpost");
        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn responds_to_secondary_da_query() {
        // \x1b[>c is a secondary DA query - we should respond
        let result = sanitize_control_sequences(b"pre\x1b[>cpost");
        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert_eq!(result.responses.len(), 1);
        assert_eq!(
            result.responses[0],
            SequenceResponse::Immediate(b"\x1b[>0;95;0c".to_vec())
        );
    }

    #[test]
    fn responds_to_secondary_da_query_with_zero_param() {
        // \x1b[>0c is also a secondary DA query - we should respond
        let result = sanitize_control_sequences(b"pre\x1b[>0cpost");
        assert_eq!(result.data, b"prepost");
        assert!(result.remainder.is_none());
        assert!(result.cursor_query_offsets.is_empty());
        assert_eq!(result.responses.len(), 1);
        assert_eq!(
            result.responses[0],
            SequenceResponse::Immediate(b"\x1b[>0;95;0c".to_vec())
        );
    }
}
