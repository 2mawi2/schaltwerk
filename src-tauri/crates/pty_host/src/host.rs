use crate::error::{PtyHostError, Result};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use parking_lot::{Condvar, Mutex};
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration};

const CHUNK_SIZE: usize = 64 * 1024;
const HIGH_WATER: usize = 512 * 1024;
const LOW_WATER: usize = 256 * 1024;
const RESIZE_DEBOUNCE_MS: u64 = 50;

pub trait EventSink: Send + Sync {
    fn emit_chunk(&self, term_id: &str, seq: u64, base64: String);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnOptions {
    pub id: String,
    pub cwd: String,
    pub rows: u16,
    pub cols: u16,
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnRequest {
    pub options: SpawnOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnResponse {
    pub term_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteRequest {
    pub term_id: String,
    pub utf8: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizeRequest {
    pub term_id: String,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KillRequest {
    pub term_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AckRequest {
    pub term_id: String,
    pub seq: u64,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscribeRequest {
    pub term_id: String,
    pub last_seen_seq: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SubscribeResponse {
    Snapshot(TerminalSnapshot),
    DeltaReady { term_id: String, seq: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSnapshot {
    pub term_id: String,
    pub seq: u64,
    pub base64: String,
}

const MAX_TRANSCRIPT_BYTES: usize = 4 * 1024 * 1024;

struct TranscriptWriter {
    buffer: Mutex<Vec<u8>>,
}

impl TranscriptWriter {
    fn new(_root: &Path, _term_id: &str) -> Result<Self> {
        Ok(Self {
            buffer: Mutex::new(Vec::new()),
        })
    }

    fn append(&self, _seq: u64, bytes: &[u8]) -> Result<()> {
        let mut buffer = self.buffer.lock();
        buffer.extend_from_slice(bytes);
        if buffer.len() > MAX_TRANSCRIPT_BYTES {
            let excess = buffer.len() - MAX_TRANSCRIPT_BYTES;
            buffer.drain(..excess);
        }
        Ok(())
    }

    fn load_snapshot(&self, limit_bytes: u64) -> Result<Vec<u8>> {
        let buffer = self.buffer.lock();
        if buffer.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit_bytes as usize;
        let start = buffer.len().saturating_sub(limit);
        Ok(buffer[start..].to_vec())
    }
}

struct TerminalEntry {
    term_id: String,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Option<Box<dyn Child + Send>>>,
    seq: AtomicU64,
    outstanding: AtomicUsize,
    paused: AtomicBool,
    resizing: AtomicBool,
    gate: Mutex<()>,
    gate_cv: Condvar,
    transcript: TranscriptWriter,
    reader_handle: Mutex<Option<JoinHandle<()>>>,
}

impl TerminalEntry {
    fn new(
        term_id: String,
        master: Box<dyn MasterPty + Send>,
        child: Box<dyn Child + Send>,
        writer: Box<dyn Write + Send>,
        transcript: TranscriptWriter,
    ) -> Arc<Self> {
        Arc::new(Self {
            term_id,
            writer: Mutex::new(writer),
            master: Mutex::new(master),
            child: Mutex::new(Some(child)),
            seq: AtomicU64::new(0),
            outstanding: AtomicUsize::new(0),
            paused: AtomicBool::new(false),
            resizing: AtomicBool::new(false),
            gate: Mutex::new(()),
            gate_cv: Condvar::new(),
            transcript,
            reader_handle: Mutex::new(None),
        })
    }

    fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::SeqCst);
        if !paused {
            self.gate_cv.notify_all();
        }
    }

    fn wait_for_gate(&self) {
        let mut guard = self.gate.lock();
        while self.paused.load(Ordering::SeqCst) || self.resizing.load(Ordering::SeqCst) {
            self.gate_cv.wait(&mut guard);
        }
    }

    fn spawn_reader(self: &Arc<Self>, sink: Arc<dyn EventSink>) {
        let entry = Arc::clone(self);
        let mut reader = entry
            .master
            .lock()
            .try_clone_reader()
            .expect("clone reader");

        let handle = tokio::task::spawn_blocking(move || {
            let mut buffer = vec![0u8; CHUNK_SIZE];
            loop {
                entry.wait_for_gate();

                let read_bytes = match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(err) => {
                        if err.kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        break;
                    }
                };

                let chunk = &buffer[..read_bytes];
                let seq = entry.seq.fetch_add(1, Ordering::SeqCst) + 1;

                if let Err(err) = entry.transcript.append(seq, chunk) {
                    tracing::warn!(
                        "failed to append transcript for term {}: {err}",
                        entry.term_id
                    );
                }

                entry.outstanding.fetch_add(read_bytes, Ordering::SeqCst);

                let base64 = STANDARD_NO_PAD.encode(chunk);
                sink.emit_chunk(&entry.term_id, seq, base64);

                if entry.outstanding.load(Ordering::SeqCst) > HIGH_WATER {
                    entry.set_paused(true);
                }
            }
        });

        *self.reader_handle.lock() = Some(handle);
    }

    fn write(&self, data: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock();
        writer.write_all(data).map_err(PtyHostError::IoError)
    }

    async fn resize(&self, rows: u16, cols: u16) -> Result<()> {
        self.resizing.store(true, Ordering::SeqCst);
        self.gate_cv.notify_all();

        {
            let master = self.master.lock();
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| PtyHostError::Internal(format!("failed to resize pty: {e}")))?;
        }

        sleep(Duration::from_millis(RESIZE_DEBOUNCE_MS)).await;
        self.resizing.store(false, Ordering::SeqCst);
        self.gate_cv.notify_all();
        Ok(())
    }

    fn ack(&self, bytes: usize) {
        let mut remaining = bytes;
        while remaining > 0 {
            let current = self.outstanding.load(Ordering::SeqCst);
            if current == 0 {
                break;
            }
            let reduce = remaining.min(current);
            match self.outstanding.compare_exchange(
                current,
                current - reduce,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => {
                    remaining -= reduce;
                    if remaining == 0 {
                        break;
                    }
                }
                Err(actual) => {
                    if actual == 0 {
                        break;
                    }
                }
            }
        }

        if self.paused.load(Ordering::SeqCst) && self.outstanding.load(Ordering::SeqCst) < LOW_WATER
        {
            self.set_paused(false);
        }
    }

    fn kill(&self) {
        if let Some(mut child) = self.child.lock().take() {
            if let Err(err) = child.kill() {
                tracing::debug!("failed to kill terminal process {}: {err}", self.term_id);
            }
        }

        if let Some(handle) = self.reader_handle.lock().take() {
            handle.abort();
        }
    }
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

fn default_transcript_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".schaltwerk")
        .join("pty")
}

pub struct PtyHost {
    sink: Arc<dyn EventSink>,
    terminals: Mutex<HashMap<String, Arc<TerminalEntry>>>,
    transcript_root: PathBuf,
}

impl PtyHost {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self::with_transcript_root(sink, default_transcript_root())
    }

    pub fn with_transcript_root(sink: Arc<dyn EventSink>, transcript_root: PathBuf) -> Self {
        Self {
            sink,
            terminals: Mutex::new(HashMap::new()),
            transcript_root,
        }
    }

    fn insert_terminal(&self, entry: Arc<TerminalEntry>) {
        self.terminals.lock().insert(entry.term_id.clone(), entry);
    }

    fn get_terminal(&self, term_id: &str) -> Result<Arc<TerminalEntry>> {
        self.terminals
            .lock()
            .get(term_id)
            .cloned()
            .ok_or_else(|| PtyHostError::TerminalNotFound(term_id.to_string()))
    }

    fn remove_terminal(&self, term_id: &str) -> Option<Arc<TerminalEntry>> {
        self.terminals.lock().remove(term_id)
    }

    fn configure_command(opts: &SpawnOptions) -> CommandBuilder {
        let shell = default_shell();
        let mut cmd = CommandBuilder::new(shell.clone());
        cmd.env("SHELL", shell);
        cmd.env("LANG", "en_US.UTF-8");
        cmd.env("LC_CTYPE", "en_US.UTF-8");
        cmd.env("TERM", "xterm-256color");
        for (key, value) in &opts.env {
            cmd.env(key, value);
        }
        cmd.cwd(Path::new(&opts.cwd));
        cmd.arg("-l");
        cmd.arg("-i");
        cmd
    }

    pub async fn spawn(&self, request: SpawnRequest) -> Result<SpawnResponse> {
        let opts = request.options;
        if self.terminals.lock().contains_key(&opts.id) {
            return Err(PtyHostError::TerminalExists(opts.id));
        }

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyHostError::Internal(format!("failed to open pty: {e}")))?;

        let cmd = Self::configure_command(&opts);
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyHostError::Internal(format!("failed to spawn shell: {e}")))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyHostError::Internal(format!("failed to take writer: {e}")))?;

        let transcript = TranscriptWriter::new(&self.transcript_root, &opts.id)?;
        let entry = TerminalEntry::new(opts.id.clone(), pair.master, child, writer, transcript);
        entry.spawn_reader(Arc::clone(&self.sink));
        self.insert_terminal(entry);

        Ok(SpawnResponse { term_id: opts.id })
    }

    pub async fn write(&self, request: WriteRequest) -> Result<()> {
        let entry = self.get_terminal(&request.term_id)?;
        entry.write(request.utf8.as_bytes())
    }

    pub async fn resize(&self, request: ResizeRequest) -> Result<()> {
        let entry = self.get_terminal(&request.term_id)?;
        entry.resize(request.rows, request.cols).await
    }

    pub async fn kill(&self, request: KillRequest) -> Result<()> {
        if let Some(entry) = self.remove_terminal(&request.term_id) {
            entry.kill();
            Ok(())
        } else {
            Err(PtyHostError::TerminalNotFound(request.term_id))
        }
    }

    pub async fn ack(&self, request: AckRequest) -> Result<()> {
        let entry = self.get_terminal(&request.term_id)?;
        entry.ack(request.bytes);
        Ok(())
    }

    pub async fn subscribe(&self, request: SubscribeRequest) -> Result<SubscribeResponse> {
        let entry = self.get_terminal(&request.term_id)?;
        let seq = entry.seq.load(Ordering::SeqCst);
        let bytes = entry.transcript.load_snapshot(4 * 1024 * 1024)?;
        let base64 = STANDARD_NO_PAD.encode(&bytes);
        Ok(SubscribeResponse::Snapshot(TerminalSnapshot {
            term_id: request.term_id,
            seq,
            base64,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
    #[cfg(unix)]
    use libc;
    use std::io::{Read, Write};
    use std::sync::{atomic::Ordering, Arc};
    use tempfile::TempDir;
    use tokio::sync::Notify;

    #[derive(Debug, Default)]
    struct RecordingSink {
        events: Mutex<Vec<(String, u64, Vec<u8>)>>,
        notify: Notify,
    }

    impl RecordingSink {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
                notify: Notify::new(),
            }
        }

        async fn wait_for_events(&self, expected: usize) -> Vec<(String, u64, Vec<u8>)> {
            let timeout_at = tokio::time::Instant::now() + Duration::from_secs(5);
            loop {
                if self.events.lock().len() >= expected {
                    break;
                }
                if tokio::time::Instant::now() > timeout_at {
                    break;
                }
                self.notify.notified().await;
            }
            self.events.lock().clone()
        }
    }

    impl EventSink for RecordingSink {
        fn emit_chunk(&self, term_id: &str, seq: u64, base64: String) {
            let bytes = STANDARD_NO_PAD
                .decode(base64)
                .expect("base64 decode in test sink");
            self.events.lock().push((term_id.to_string(), seq, bytes));
            self.notify.notify_waiters();
        }
    }

    fn make_host(temp_dir: &TempDir, sink: Arc<RecordingSink>) -> PtyHost {
        let dyn_sink: Arc<dyn EventSink> = sink;
        PtyHost::with_transcript_root(dyn_sink, temp_dir.path().to_path_buf())
    }

    #[tokio::test]
    async fn spawn_and_write_emits_output() -> Result<()> {
        let sink = Arc::new(RecordingSink::new());
        let temp_dir = tempfile::tempdir()?;
        let host = make_host(&temp_dir, sink.clone());

        let spawn = host
            .spawn(SpawnRequest {
                options: SpawnOptions {
                    id: "term-test".to_string(),
                    cwd: temp_dir.path().to_string_lossy().to_string(),
                    rows: 24,
                    cols: 80,
                    env: vec![],
                },
            })
            .await?;

        host.write(WriteRequest {
            term_id: spawn.term_id.clone(),
            utf8: "printf 'hello world'\nexit\n".to_string(),
        })
        .await?;

        let events = sink.wait_for_events(1).await;
        assert!(!events.is_empty());
        let combined: Vec<u8> = events
            .iter()
            .flat_map(|(_, _, bytes)| bytes.clone())
            .collect();
        let text = String::from_utf8_lossy(&combined);
        assert!(text.contains("hello world"));

        Ok(())
    }

    #[test]
    fn transcript_writer_limits_history_in_memory() -> Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let writer = TranscriptWriter::new(temp_dir.path(), "limit-test")?;

        let half = MAX_TRANSCRIPT_BYTES / 2;
        let first = vec![b'a'; half];
        let second = vec![b'b'; MAX_TRANSCRIPT_BYTES];

        writer.append(1, &first)?;
        writer.append(2, &second)?;

        let snapshot = writer.load_snapshot(MAX_TRANSCRIPT_BYTES as u64)?;
        assert_eq!(snapshot.len(), MAX_TRANSCRIPT_BYTES);
        assert!(snapshot.iter().all(|byte| *byte == b'b'));

        Ok(())
    }

    #[test]
    fn transcript_writer_avoids_creating_files() -> Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let writer = TranscriptWriter::new(temp_dir.path(), "fs-test")?;
        writer.append(1, b"hello world")?;

        let entries: Vec<_> = std::fs::read_dir(temp_dir.path())?.collect();
        assert!(entries.is_empty());

        let snapshot = writer.load_snapshot(1024)?;
        assert_eq!(snapshot, b"hello world".to_vec());

        Ok(())
    }

    #[derive(Debug, Default)]
    struct StubMaster;

    impl MasterPty for StubMaster {
        fn resize(&self, _size: PtySize) -> std::result::Result<(), anyhow::Error> {
            Ok(())
        }

        fn get_size(&self) -> std::result::Result<PtySize, anyhow::Error> {
            Ok(PtySize::default())
        }

        fn try_clone_reader(&self) -> std::result::Result<Box<dyn Read + Send>, anyhow::Error> {
            Ok(Box::new(std::io::Cursor::new(Vec::new())))
        }

        fn take_writer(&self) -> std::result::Result<Box<dyn Write + Send>, anyhow::Error> {
            Ok(Box::new(std::io::sink()))
        }

        #[cfg(unix)]
        fn process_group_leader(&self) -> Option<libc::pid_t> {
            None
        }

        #[cfg(unix)]
        fn as_raw_fd(&self) -> Option<portable_pty::unix::RawFd> {
            None
        }

        #[cfg(unix)]
        fn tty_name(&self) -> Option<std::path::PathBuf> {
            None
        }
    }

    #[derive(Debug, Default)]
    struct StubChild;

    impl portable_pty::ChildKiller for StubChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
            Box::new(StubChild)
        }
    }

    impl portable_pty::Child for StubChild {
        fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
            Ok(None)
        }

        fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
            Ok(portable_pty::ExitStatus::with_exit_code(0))
        }

        fn process_id(&self) -> Option<u32> {
            None
        }

        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    fn test_entry(temp_dir: &TempDir) -> Arc<TerminalEntry> {
        let transcript = TranscriptWriter::new(temp_dir.path(), "term-test").expect("transcript");
        TerminalEntry::new(
            "term-test".to_string(),
            Box::new(StubMaster),
            Box::new(StubChild),
            Box::new(std::io::sink()),
            transcript,
        )
    }

    #[tokio::test]
    async fn ack_clears_pause_when_under_low_water() -> Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let entry = test_entry(&temp_dir);

        entry.outstanding.store(HIGH_WATER + 1, Ordering::SeqCst);
        entry.set_paused(true);

        entry.ack(HIGH_WATER + 1);
        assert_eq!(entry.outstanding.load(Ordering::SeqCst), 0);
        assert!(!entry.paused.load(Ordering::SeqCst));

        entry.outstanding.store(LOW_WATER + 10, Ordering::SeqCst);
        entry.set_paused(true);
        entry.ack(8);
        assert!(entry.paused.load(Ordering::SeqCst));
        entry.ack(LOW_WATER);
        assert!(!entry.paused.load(Ordering::SeqCst));

        Ok(())
    }

    #[tokio::test]
    async fn resize_clears_resizing_flag() -> Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let entry = test_entry(&temp_dir);

        assert!(!entry.resizing.load(Ordering::SeqCst));
        entry.resize(40, 120).await?;
        assert!(!entry.resizing.load(Ordering::SeqCst));

        Ok(())
    }

    #[tokio::test]
    async fn unicode_output_roundtrip() -> Result<()> {
        let sink = Arc::new(RecordingSink::new());
        let temp_dir = tempfile::tempdir()?;
        let host = make_host(&temp_dir, sink.clone());

        let spawn = host
            .spawn(SpawnRequest {
                options: SpawnOptions {
                    id: "unicode-term".to_string(),
                    cwd: temp_dir.path().to_string_lossy().to_string(),
                    rows: 24,
                    cols: 80,
                    env: vec![],
                },
            })
            .await?;

        host.write(WriteRequest {
            term_id: spawn.term_id.clone(),
            utf8: "printf 'こんにちは🌟世界'\nexit\n".to_string(),
        })
        .await?;

        let events = sink.wait_for_events(1).await;
        assert!(!events.is_empty());
        let combined: Vec<u8> = events
            .iter()
            .flat_map(|(_, _, bytes)| bytes.clone())
            .collect();
        let text = String::from_utf8(combined.clone())?;
        assert!(text.contains("こんにちは"));
        assert!(text.contains("世界"));

        if let Some((term_id, seq, _)) = events.last() {
            host.ack(AckRequest {
                term_id: term_id.clone(),
                seq: *seq,
                bytes: combined.len(),
            })
            .await?;
        }

        host.kill(KillRequest {
            term_id: spawn.term_id,
        })
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn subscribe_returns_snapshot_after_history() -> Result<()> {
        let sink = Arc::new(RecordingSink::new());
        let temp_dir = tempfile::tempdir()?;
        let host = make_host(&temp_dir, sink.clone());

        let spawn = host
            .spawn(SpawnRequest {
                options: SpawnOptions {
                    id: "snapshot-term".to_string(),
                    cwd: temp_dir.path().to_string_lossy().to_string(),
                    rows: 24,
                    cols: 80,
                    env: vec![],
                },
            })
            .await?;

        host.write(WriteRequest {
            term_id: spawn.term_id.clone(),
            utf8: "echo ready && exit\n".to_string(),
        })
        .await?;

        let events = sink.wait_for_events(1).await;
        assert!(!events.is_empty());

        let response = host
            .subscribe(SubscribeRequest {
                term_id: spawn.term_id.clone(),
                last_seen_seq: None,
            })
            .await?;

        match response {
            SubscribeResponse::Snapshot(snapshot) => {
                assert_eq!(snapshot.term_id, spawn.term_id);
                let bytes = STANDARD_NO_PAD
                    .decode(snapshot.base64)
                    .expect("snapshot base64");
                let text = String::from_utf8(bytes)?;
                assert!(text.contains("ready"));
            }
            SubscribeResponse::DeltaReady { .. } => panic!("expected snapshot response"),
        }

        host.kill(KillRequest {
            term_id: spawn.term_id,
        })
        .await?;
        Ok(())
    }
}
