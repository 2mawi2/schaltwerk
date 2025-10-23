#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SequenceResponse {
    Immediate(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanitizedOutput {
    pub data: Vec<u8>,
    pub remainder: Option<Vec<u8>>,
    pub cursor_query_offsets: Vec<usize>,
    pub responses: Vec<SequenceResponse>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ControlSequenceAction {
    Respond(&'static [u8]),
    RespondCursorPosition,
    Drop,
    Pass,
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
            Some(b'>') => ControlSequenceAction::Respond(b"\x1b[>0;95;0c"),
            Some(b'?') => ControlSequenceAction::Respond(b"\x1b[?1;2c"),
            None => ControlSequenceAction::Respond(b"\x1b[?1;2c"),
            _ => ControlSequenceAction::Pass,
        },
        b'R' => ControlSequenceAction::Drop,
        _ => ControlSequenceAction::Pass,
    }
}

pub fn sanitize_control_sequences(input: &[u8]) -> SanitizedOutput {
    let mut data = Vec::with_capacity(input.len());
    let mut remainder = None;
    let mut cursor_query_offsets = Vec::new();
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
                let prefix =
                    if cursor < input.len() && (input[cursor] == b'?' || input[cursor] == b'>') {
                        let p = input[cursor];
                        cursor += 1;
                        Some(p)
                    } else {
                        None
                    };

                let params_start = cursor;
                while cursor < input.len()
                    && (input[cursor].is_ascii_digit() || input[cursor] == b';')
                {
                    cursor += 1;
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
                        log::debug!("Handled terminal query {:?}", &input[i..=cursor]);
                        responses.push(SequenceResponse::Immediate(reply.to_vec()));
                        i = cursor + 1;
                    }
                    ControlSequenceAction::RespondCursorPosition => {
                        log::debug!("Captured cursor position query {:?}", &input[i..=cursor]);
                        cursor_query_offsets.push(data.len());
                        i = cursor + 1;
                    }
                    ControlSequenceAction::Drop => {
                        log::debug!("Dropped terminal handshake {:?}", &input[i..=cursor]);
                        i = cursor + 1;
                    }
                    ControlSequenceAction::Pass => {
                        data.extend_from_slice(&input[i..=cursor]);
                        i = cursor + 1;
                    }
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
                            log::debug!("Responding to OSC foreground query {text:?}");
                            responses.push(SequenceResponse::Immediate(
                                b"\x1b]10;rgb:ef/ef/ef\x07".to_vec(),
                            ));
                            i = term_idx + terminator_len;
                        } else if text.starts_with("11;?") {
                            log::debug!("Responding to OSC background query {text:?}");
                            responses.push(SequenceResponse::Immediate(
                                b"\x1b]11;rgb:1e/1e/1e\x07".to_vec(),
                            ));
                            i = term_idx + terminator_len;
                        } else if text.starts_with("8;") {
                            data.extend_from_slice(&input[i..=term_idx + terminator_len - 1]);
                            i = term_idx + terminator_len;
                        } else {
                            log::trace!("Passing through OSC sequence {text:?}");
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
        responses,
    }
}

#[cfg(test)]
mod tests {
    use super::{sanitize_control_sequences, SanitizedOutput, SequenceResponse};

    #[test]
    fn handles_cursor_position_queries() {
        let result = sanitize_control_sequences(b"pre\x1b[6npost");
        assert_eq!(
            result,
            SanitizedOutput {
                data: b"prepost".to_vec(),
                remainder: None,
                cursor_query_offsets: vec![3],
                responses: Vec::new(),
            }
        );
    }

    #[test]
    fn handles_device_attributes_queries() {
        let result = sanitize_control_sequences(b"pre\x1b[?1;2cpost");
        assert_eq!(result.data, b"prepost");
        assert_eq!(result.remainder, None);
        assert!(result.cursor_query_offsets.is_empty());
        assert_eq!(result.responses.len(), 1);
        assert_eq!(
            result.responses[0],
            SequenceResponse::Immediate(b"\x1b[?1;2c".to_vec())
        );
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
}
