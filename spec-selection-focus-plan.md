# Plan: Preserve Sidebar Focus Across Filters

## Objective
Maintain user focus on the most relevant session when specs (and other sessions) are created, started, or removed, across all filter modes. Selection should stay on the closest surviving session in the active filter and only fall back to orchestrator when the filter no longer contains any sessions.

## TODO
- [x] Add regression tests that encode the desired selection persistence for filter changes and spec lifecycle events.
- [x] Implement per-filter selection memory helper and wire it into Sidebar selection handling.
- [x] Update auto-selection and lifecycle paths (filter changes, removals, conversions) to reuse the helper and keep orchestrator fallback semantics.
- [x] Verify coverage, tidy documentation, and run `just test`.

## Key Findings
- `Sidebar.tsx` currently runs an effect that selects `sessions[0]` whenever the previously selected session disappears from the filtered list, which causes focus to jump to the top of the list after spec lifecycle changes.
- Filter navigation handlers (`handleNavigateToPrevFilter`/`NextFilter`) also hardcode "first item" logic when the current selection is not visible after switching filters.
- `computeNextSelectedSessionId` already implements "neighbour" semantics for explicit removals, but the logic is only used for `SchaltEvent.SessionRemoved`.
- Selection state is not remembered per filter mode; switching away from a filter and back always relies on whatever the generic fallback picks.

## Work Breakdown
1. **Selection Memory Infrastructure**
   - Introduce a lightweight utility (hook or helper module) that tracks the last intentional `session_id` per `FilterMode`, plus the previous ordered list for neighbour calculations.
   - Update `Sidebar` to register selections through this utility whenever the user (or intentional auto-selection) changes focus.
   - Ensure memory survives filter switches and is reset when a filter becomes empty.

2. **Auto-Selection Logic Rewrite**
   - Replace the existing "select the first visible session" effect with logic that:
     - Checks the remembered selection for the active filter and re-selects it if the item still exists.
     - Uses the previous sorted list + `computeNextSelectedSessionId` (extended if necessary) to pick the closest neighbour when the remembered item vanished.
     - Falls back to the orchestrator only when the filter yields zero sessions.
   - Apply the same logic inside filter navigation handlers instead of the current first-item fallback.

3. **Session Lifecycle Event Integration**
   - Reuse the new helper inside the `SessionRemoved` listener so all auto-selection paths go through a single code path.
   - Handle "session migrated out of filter" cases (e.g., spec → running) by re-evaluating the remembered selection as soon as the filter contents change.
   - Keep orchestrator focus untouched for events unrelated to the active filter (e.g., specs created while viewing Running filter).

4. **Refine Supporting Utilities**
   - Extend `computeNextSelectedSessionId` or add an adjacent helper that accepts the previous & next filtered lists so we can pick the neighbour consistently for both deletions and state transitions.
   - Consider persisting the selection memory in `SelectionContext` if other components will benefit; keep the API narrow for now (only Sidebar uses it).

5. **Testing & Validation**
   - Add focused tests (likely in `Sidebar.selection.test.tsx` or a new suite) covering:
     - Starting a spec while viewing the Spec filter keeps focus on the next spec (or orchestrator when none remain).
     - Deleting/marking reviewed specs respects neighbour selection.
     - Creating a spec while a different spec is selected leaves focus unchanged.
     - Per-filter memory: switch filters, select different sessions, switch back, and ensure the prior selection is restored if still present.
     - Edge case where the remembered session is renamed or filtered out of "All".
   - Update any existing tests that assumed first-item fallback behaviour.

6. **Regression Checks**
   - Run the full `just test` suite.
   - Spot-check manual flows (spec start, delete, create) if time permits to confirm focus remains stable.

## Open Questions / Assumptions
- Persisting selection memory in-memory is acceptable so long as it survives intra-session filter changes and project switches; no requirement to store per-filter focus across application restarts.
- "Next best" means neighbours within the current sort order (using the filtered list order).
- Orchestrator remains the universal fallback when a filter empties out.

## Risks & Mitigations
- **Stale references when sessions update rapidly:** mitigate by cloning lists before computing neighbours and guarding against missing ids.
- **Accidental infinite loop between selection setter and effect:** ensure the rewritten effect only runs when the derived target differs from the current selection.
- **Complexity creep in Sidebar:** encapsulate the new logic in dedicated helpers/hooks to keep the component manageable.
