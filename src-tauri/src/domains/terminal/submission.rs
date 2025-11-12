/// Build a terminal input payload that mirrors our review comment submission path.
/// When `use_bracketed_paste` is true we wrap the content in the standard OSC 200
/// delimiters before appending a carriage return so the command executes immediately.
pub fn build_submission_payload(data: &[u8], use_bracketed_paste: bool) -> Vec<u8> {
    let bracket_overhead = if use_bracketed_paste { 6 } else { 0 };
    let mut payload = Vec::with_capacity(data.len() + bracket_overhead + 1);

    if use_bracketed_paste {
        payload.extend_from_slice(b"\x1b[200~");
    }

    payload.extend_from_slice(data);

    if use_bracketed_paste {
        payload.extend_from_slice(b"\x1b[201~");
    }

    payload.push(b'\r');

    payload
}
