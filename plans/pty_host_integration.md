# Pty Host Integration Plan

## Goals
- Introduce a standalone PTY host crate that handles spawn, read, write, resize, and transcript duties.
- Provide Tauri commands required by `PluginTransport` for spawn, write, resize, kill, subscribe, and ACK.
- Deliver deterministic flow control via ACK high/low watermarks to prevent UI backpressure issues.
- Persist transcripts to disk with resumable replay and efficient random access via sparse index entries.
- Preserve existing `TerminalManager` for fallback while feature flag directs UI to new transport.

## Backend Architecture
- New crate `src-tauri/crates/pty_host` exporting `PtyHost`, `PtyTerminalHandle`, and typed command payload structs.
- Store shared state in `Arc<PtyHost>` inside a OnceCell at `src-tauri/src/infrastructure/pty.rs` (or similar) for reuse.
- Each terminal maintains:
  - `id: u64`, `seq: u64`, `outstanding_bytes: usize`, `paused: bool`, `resizing: bool`.
  - `master: Box<dyn MasterPty + Send>`, `child: Box<dyn Child + Send>`, `writer: tokio::sync::Mutex<Box<dyn Write + Send>>>`.
  - Asynchronous read loop running on Tokio using `tokio::task::spawn_blocking` for blocking reads to avoid starving runtime.
  - `Notify` primitives for pause/resume toggling on flow control and resize.
  - `TranscriptWriter` with file + index writer; index records `(seq, offset)` every 1MB.
- Base64 encoding occurs once per emitted chunk using `base64::engine::general_purpose::STANDARD_NO_PAD`.
- Read loop algorithm:
  1. Wait until `!paused && !resizing` (await `Notify`).
  2. Read up to `CHUNK` bytes from PTY.
  3. Increment `seq`, append bytes to transcript, emit `pty:data` event via `AppHandle::emit_all`.
  4. Increase `outstanding_bytes`; if above `HIGH_WATER`, set `paused = true`.
- ACK handler subtracts `bytes` (saturating) and when below `LOW_WATER` flips `paused = false` and notifies reader.
- Resize handler toggles `resizing` flag and pauses reader until after `TIOCSWINSZ` and debounce delay using `tokio::time::sleep` (bounded, deterministic).
- Transcript storage path: `~/.schaltwerk/pty/term_<id>.bin` with companion `term_<id>.idx` for index entries (supports future snapshots).

## Tauri Command Surface
- Register commands in `src-tauri/src/main.rs` (and `commands/mod.rs`):
  - `pty_spawn(SpawnRequest) -> Result<SpawnResponse, String>`
  - `pty_write(WriteRequest)`
  - `pty_resize(ResizeRequest)`
  - `pty_kill(KillRequest)`
  - `pty_ack(AckRequest)`
  - `pty_subscribe(SubscribeRequest) -> Result<SubscribeResponse, String>`
- `pty_subscribe` response includes either `Snapshot { term_id, seq, base64 }` or `DeltaReady { term_id, seq }` instructing UI to expect stream.
- Event string constant: `SchaltEvent.PtyData = 'schaltwerk:pty-data'` carrying `{ term_id, seq, base64 }`.
- Provide helper `get_pty_host()` returning `Arc<PtyHost>`; registers app handle once for event emission.

## Frontend Integration
- Create `src/terminal/transport/TerminalTransport.ts` interface plus `PluginTransport` implementation in same folder.
- `PluginTransport` responsibilities:
  - Wrap Tauri invokes for new commands through `TauriCommands` enum entries.
  - `subscribe` listens on `SchaltEvent.PtyData`, filters by `term_id`, decodes base64 once using `atob` to `Uint8Array` via `Uint8Array.from(atob)`. (Use `Uint8Array` conversion helper.)
  - Maintain `highestSeq` per terminal to discard stale messages.
  - Track `pendingAckBytes` and send `ack` whenever bytes processed exceed `ACK_EVERY` threshold.
  - Provide callback registration for initial snapshot vs streaming delta (if subscribe returns snapshot, feed to onData before listening).
- Add feature flag resolver `shouldUsePtyPluginTransport()` reading environment variable via new command `get_environment_variable(name)` that uses sanitized allowlist for `SCHALTWERK_TERMINAL_TRANSPORT`.
- Update `Terminal.tsx` to branch: instantiate `PluginTransport` when flag equals `pty_plugin`; otherwise reuse existing transport pipeline.
- Ensure xterm 5 + addons integrated; move addon initialization into plugin path but share existing sizing/scrollback logic where possible to minimize churn.

## Tests

### Rust (`pty_host` crate)
1. `flood_output_respects_flow_control`: spawn fake PTY using shell that prints large data; assert `outstanding_bytes` watermark toggles pause/resume and transcript matches total bytes.
2. `resize_debounce_prevents_read`: simulate sequential resizes while writing output; ensure `resizing` gate prevents reads during window and backlog resumes post-ACK.
3. `resume_snapshot_starts_from_highest_seq`: seed transcript file, call `subscribe` with stale seq to get snapshot, verify returned seq >= high watermark.
4. `unicode_roundtrip`: write multi-byte sequence, ensure transcript stores bytes untouched and event payload base64 decodes to original.
5. `altscreen_apps_emit`: launch `/usr/bin/vi` (or safer stub) to ensure alt-screen toggles do not clear transcript unexpectedly (validate transcripts appended).

### TypeScript (Terminal/xterm)
1. Add integration style test for `PluginTransport` verifying ack cadence and stale seq drop behaviour using mocked event emitter.
2. Extend terminal tests for resize handling via new transport path.

## Feature Flag & Rollout
- Implement helper that caches env lookup result and exposes `usePtyPluginTransport` hook.
- Provide fallback logging when transport disabled.
- Document toggling path in README/CLAUDE if needed.

