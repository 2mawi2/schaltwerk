use crate::error::{PtyHostError, Result};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use parking_lot::{Condvar, Mutex};
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration};

const CHUNK_SIZE: usize = 64 * 1024;
const HIGH_WATER: usize = 512 * 1024;
const LOW_WATER: usize = 256 * 1024;
const INDEX_SPACING: u64 = 1024 * 1024;
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

#[derive(Serialize)]
struct TranscriptIndexEntry {
    seq: u64,
    offset: u64,
}

fn sanitize_id(id: &str) -> String {
    let mut sanitized = String::with_capacity(id.len());
    for ch in id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            sanitized.push(ch);
        } else {
            sanitized.push('_');
        }
    }
    sanitized
}

struct TranscriptWriter {
    data_path: PathBuf,
    data: Mutex<std::fs::File>,
    index: Mutex<std::fs::File>,
    total_bytes: AtomicU64,
    next_threshold: AtomicU64,
}

impl TranscriptWriter {
    fn new(root: &Path, term_id: &str) -> Result<Self> {
        std::fs::create_dir_all(root).map_err(PtyHostError::IoError)?;
        let safe_id = sanitize_id(term_id);

        let data_path = root.join(format!("term_{safe_id}.bin"));
        let data_file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&data_path)
            .map_err(PtyHostError::IoError)?;

        let index_file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join(format!("term_{safe_id}.idx")))
            .map_err(PtyHostError::IoError)?;

        let current_len = data_file.metadata().map_err(PtyHostError::IoError)?.len();
        let mut next_threshold = ((current_len / INDEX_SPACING) + 1) * INDEX_SPACING;
        if next_threshold == 0 {
            next_threshold = INDEX_SPACING;
        }

        Ok(Self {
            data_path,
            data: Mutex::new(data_file),
            index: Mutex::new(index_file),
            total_bytes: AtomicU64::new(current_len),
            next_threshold: AtomicU64::new(next_threshold),
        })
    }

    fn append(&self, seq: u64, bytes: &[u8]) -> Result<()> {
        {
            let mut file = self.data.lock();
            file.write_all(bytes).map_err(PtyHostError::IoError)?;
        }

        let start_offset = self
            .total_bytes
            .fetch_add(bytes.len() as u64, Ordering::SeqCst);
        let end_offset = start_offset + bytes.len() as u64;

        let mut threshold = self.next_threshold.load(Ordering::SeqCst);
        if end_offset >= threshold {
            while threshold <= end_offset {
                if threshold > start_offset {
                    self.write_index(seq, threshold)?;
                }
                threshold += INDEX_SPACING;
            }
            self.next_threshold.store(threshold, Ordering::SeqCst);
        }

        Ok(())
    }

    fn write_index(&self, seq: u64, offset: u64) -> Result<()> {
        let entry = TranscriptIndexEntry { seq, offset };
        let json = serde_json::to_vec(&entry)
            .map_err(|e| PtyHostError::Internal(format!("failed to encode index: {e}")))?;
        let mut file = self.index.lock();
        file.write_all(&json).map_err(PtyHostError::IoError)?;
        file.write_all(b"\n").map_err(PtyHostError::IoError)?;
        Ok(())
    }

    fn load_snapshot(&self, limit_bytes: u64) -> Result<Vec<u8>> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .open(&self.data_path)
            .map_err(PtyHostError::IoError)?;
        let len = file.metadata().map_err(PtyHostError::IoError)?.len();
        let start = len.saturating_sub(limit_bytes);
        let mut reader = file;
        reader
            .seek(SeekFrom::Start(start))
            .map_err(PtyHostError::IoError)?;
        let mut buf = vec![0u8; (len - start) as usize];
        reader.read_exact(&mut buf).map_err(PtyHostError::IoError)?;
        Ok(buf)
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
