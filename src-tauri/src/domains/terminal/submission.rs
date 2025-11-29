/// Build a terminal input payload that mirrors our review comment submission path.
/// When `use_bracketed_paste` is true we wrap the content in the standard OSC 200
/// delimiters before appending a carriage return so the command executes immediately.
///
/// When `needs_delayed_submit` is true, the carriage return is omitted from the payload
/// because the caller will send it separately after a small delay. This is needed for
/// Claude Code which interprets `\r` in pasted content as a newline rather than submit.
pub fn build_submission_payload(
    data: &[u8],
    use_bracketed_paste: bool,
    needs_delayed_submit: bool,
) -> Vec<u8> {
    let bracket_overhead = if use_bracketed_paste { 6 } else { 0 };
    let needs_cr = !needs_delayed_submit;
    let cr_overhead = if needs_cr { 1 } else { 0 };
    let mut payload = Vec::with_capacity(data.len() + bracket_overhead + cr_overhead);

    if use_bracketed_paste {
        payload.extend_from_slice(b"\x1b[200~");
    }

    payload.extend_from_slice(data);

    if use_bracketed_paste {
        payload.extend_from_slice(b"\x1b[201~");
    }

    if needs_cr {
        payload.push(b'\r');
    }

    payload
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_submission_payload_without_bracketed_paste_appends_cr() {
        let data = b"hello";
        let payload = build_submission_payload(data, false, false);
        assert_eq!(payload, b"hello\r");
    }

    #[test]
    fn build_submission_payload_with_bracketed_paste_wraps_and_appends_cr() {
        let data = b"hello";
        let payload = build_submission_payload(data, true, false);
        assert_eq!(payload, b"\x1b[200~hello\x1b[201~\r");
    }

    #[test]
    fn build_submission_payload_delayed_submit_omits_cr() {
        let data = b"hello";
        let payload = build_submission_payload(data, false, true);
        assert_eq!(payload, b"hello");
    }

    #[test]
    fn build_submission_payload_bracketed_with_delayed_submit_omits_cr() {
        let data = b"hello";
        let payload = build_submission_payload(data, true, true);
        assert_eq!(payload, b"\x1b[200~hello\x1b[201~");
    }

    #[test]
    fn build_submission_payload_empty_data() {
        let payload = build_submission_payload(b"", false, false);
        assert_eq!(payload, b"\r");
    }

    #[test]
    fn build_submission_payload_empty_data_delayed_submit() {
        let payload = build_submission_payload(b"", false, true);
        assert_eq!(payload, b"");
    }
}
