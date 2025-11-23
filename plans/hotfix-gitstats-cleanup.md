# Hotfix: git stats refresh & terminal cleanup reliability

- Background git stats refresh: serve cached stats immediately, enqueue stale stats to a background spawn_blocking job, and slow-log when refresh exceeds 250ms.
- Debounce per call: only one refresh attempt per session per list_enriched_sessions invocation (avoids synchronous blocking).
- Cleanup guard: during Drop, perform blocking cleanup via current tokio handle when available; otherwise build a temp current-thread runtime; fall back to spawn-only as a last resort.
- No changes to terminal reader channel as requested.

Status: implemented.
