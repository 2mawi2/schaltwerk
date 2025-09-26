# Plan: Spec Editor File Reference Autocomplete

## Background
- Creating specs or agents currently uses a plain `<textarea>` for the markdown body (`src/components/modals/NewSessionModal.tsx:599`), so no editor features (syntax highlighting, completions, or consistent styling) are available during creation. We'll verify the CodeMirror wrapper can be reused inside the modal (and research upstream guidance if additional configuration is required) before swapping components.
- Once a spec exists, editing happens inside `SpecEditor` via the shared `MarkdownEditor` CodeMirror wrapper (`src/components/plans/SpecEditor.tsx`, `src/components/plans/MarkdownEditor.tsx`), which still lacks any project-aware autocomplete support.
- Writers need to reference repository files inside specs. The desired behaviour is to type `@` and receive path suggestions from the current project worktree while authoring or editing specs.

## Goals
- Provide deterministic, latency-friendly autocomplete suggestions for repository file paths inside spec markdown when typing `@` prefixes.
- Deliver the same editor capabilities when drafting specs in the New Session modal and when editing existing specs in spec mode.
- Keep implementation event-driven (no polling/timeouts) and respect theme/command conventions.

## Non-goals
- Building a full project search UI or fuzzy finder; autocomplete remains a lightweight deterministic prefix matcher to avoid performance issues in large repositories.
- Modifying how specs are stored, saved, or rendered elsewhere in the app.
- Supporting cross-repo or remote file references; scope is the active project worktree only.

## Proposed Architecture

### Backend (Tauri / Rust)
1. **File index command**
   - Add `list_project_files` function under a new `domains::workspace::file_index` module that walks the active project root (respecting `.gitignore` via `git ls-files` to avoid vendor noise). All path filtering and search preprocessing should stay in Rust for speed.
   - Expose a cached list (e.g., `Arc<RwLock<Vec<String>>>`) refreshed on demand; reuse existing project path resolution from `ProjectManager`.
   - Introduce a Tauri command `schaltwerk_core_list_project_files` wired through `src-tauri/src/schaltwerk_core/mod.rs` and surfaced via `TauriCommands` enum.
   - Hook into existing events: emit a lightweight `SchaltEvent::ProjectFilesUpdated` after refresh so the frontend can invalidate caches when repos change (e.g., after MCP updates or session merges).
2. **Tests**
   - Add Rust unit tests using temp repos to verify git-tracked file discovery (nested directories, ignored files) and ensure responses stay sorted for stable autocomplete ordering.

### Frontend (React / CodeMirror)
1. **Unify editor usage**
   - Replace the modal `<textarea>` with the shared `MarkdownEditor`, adding a mode flag to keep sizing + accessibility aligned with modal layout.
   - Ensure theme tokens replace remaining Tailwind slate utility classes while touching the modal.
2. **Autocomplete extension**
   - Extend `MarkdownEditor` to accept an `extensions` prop or a boolean `enableFileReferenceAutocomplete` that internally composes with `@codemirror/autocomplete` helpers.
   - Implement a custom completion source that activates when the token before the cursor matches `@<partial-path>` and queries a new `useProjectFileIndex` hook.
   - The hook should lazy-load filenames via `invoke(TauriCommands.SchaltwerkCoreListProjectFiles)` and memoize results per-project, invalidated by `SchaltEvent::ProjectFilesUpdated` or project switch events.
   - Use deterministic filtering (case-sensitive prefix match on path segments, limit result count, surface directory hints) and render completions that highlight the basename while showing the full relative path (and optional iconography) so both pieces of information are visible in the picker.
3. **Spec editor integration**
   - Enable the autocomplete flag in both `SpecEditor` and the new-session modal so drafting and editing share the same behaviour.
   - Add keyboard shortcut coverage with existing shortcut context (respect `Esc` to close suggestions, `Enter` to apply).
4. **Tests (Vitest + React Testing Library)**
   - Add unit tests for the hook to ensure it requests files once, caches, and filters deterministically.
   - Add component tests around `MarkdownEditor` ensuring the completion extension registers when the flag is true (e.g., via `EditorState` inspection or mocked completion source invocation).
   - Extend `NewSessionModal` tests to confirm spec creation renders `MarkdownEditor` and passes down the flag.

### Developer Experience
- Share a short usage note with the team (e.g., release notes or internal changelog) so agents know about `@` references; no CLAUDE.md/README edits required.

## Implementation Steps (TDD-first)
1. **Backend tests first**: write failing Rust tests for `list_project_files` behaviour (ignored files, nested paths, stability) before implementing the module + command.
2. **Frontend hook tests**: create Vitest specs for the new `useProjectFileIndex` hook covering fetch/invalidation logic, then implement the hook.
3. **Editor integration tests**: write tests validating that enabling autocomplete adds the completion extension and that `NewSessionModal` switches to `MarkdownEditor`.
4. **Implementation**: code the backend module, expose the Tauri command, build the hook, wire up editor extensions, and update UI components.
5. **Manual QA checklist**: verify autocomplete triggers in modal/spec editor, respects theme, handles large repos without blocking UI, and falls back gracefully if no files are present.
6. **Regression tests**: run `just test` and targeted manual flows for spec creation/editing.

## Risks & Mitigations
- **Large repositories**: mitigate by using `git ls-files` and caching to avoid expensive directory walks; consider chunked loading if repos exceed tens of thousands of files.
- **Stale data after git operations**: leverage existing session refresh events to invalidate caches, and expose a manual refresh fallback if necessary.
- **Editor bundle size**: ensure lazy imports (as already used for `MarkdownEditor`) and tree-shake unused CodeMirror features to keep modal load performant.

## Open Questions
- Confirm the exact insertion formatting (e.g., plain relative path vs. bracketed syntax) so references remain unambiguous once authored.
