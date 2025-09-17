# Kanban Removal Plan

1. Inventory current Kanban integrations (App state, `TopBar` props, terminal shortcut handler, settings modal entry, CSS) to ensure we know every touchpoint before deleting code.
2. Remove Kanban-related UI hooks: drop modal state/listeners from `src/App.tsx`, strip `onOpenKanban` plumbing from `src/components/TopBar.tsx`, and eliminate the global shortcut dispatch in `src/components/terminal/Terminal.tsx`.
3. Delete Kanban-specific modules (`src/components/kanban/` directory, tests, styles) and any leftover imports/usages so the build no longer references them.
4. Clean up ancillary references (keyboard hookup docs, settings copy, README mentions, theme CSS comments) so documentation and styling stay accurate.
5. Run `just test` to confirm the project compiles, tests pass, and no residual Kanban assets remain.
