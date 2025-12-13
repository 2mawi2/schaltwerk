# Plan: Remove "All" Filter

Remove the "All" filter button from the sidebar. Default to "Running" filter on first app launch.

## Files to Modify

### Frontend (TypeScript)

**1. `src/types/sessionFilters.ts`**
- Remove `All = 'all'` from `FilterMode` enum
- Update `FILTER_MODES` array to exclude `All`

**2. `src/store/atoms/sessions.ts`**
- Change default filter mode from `FilterMode.All` to `FilterMode.Running`
- Update `getDefaultFilterMode()` to return `FilterMode.Running`

**3. `src/utils/sessionFilters.ts`**
- Remove `FilterMode.All` case from `filterSessions()` switch
- Update `calculateFilterCounts()` to remove `allCount`

**4. `src/components/sidebar/Sidebar.tsx`**
- Remove "All" filter button from UI
- Remove `allCount` display
- Update any references to `FilterMode.All`

**5. `src/hooks/useSessions.ts`**
- Remove any `FilterMode.All` references if present

### Backend (Rust) - if filter mode is persisted

**6. Check if `filter_mode` is stored in backend**
- Handle migration: if stored value is "all", convert to "running"

## Implementation Details

### Filter Mode Enum Update
```typescript
export enum FilterMode {
    Spec = 'spec',
    Running = 'running',
    Reviewed = 'reviewed'
}

export const FILTER_MODES = Object.values(FilterMode) as FilterMode[]
```

### Default Filter Change
```typescript
function getDefaultFilterMode(): FilterMode {
    return FilterMode.Running  // Changed from FilterMode.All
}
```

### Sidebar UI
Remove the "All" button, keep only:
- Specs (count)
- Running (count)
- Reviewed (count)

### Migration for Existing Users
If a user has `filter_mode: 'all'` persisted:
- On load, detect invalid value and default to `FilterMode.Running`

## Test Updates

**7. `src/components/sidebar/Sidebar.filter.test.tsx`**
- Remove tests for "All" filter
- Update tests to expect "Running" as default
- Update any filter count assertions

**8. `src/utils/sessionFilters.test.ts`** (if exists)
- Remove `FilterMode.All` test cases

## Implementation Order

1. Update `FilterMode` enum and `FILTER_MODES`
2. Update default filter mode to `Running`
3. Update `filterSessions()` and `calculateFilterCounts()`
4. Remove "All" button from Sidebar UI
5. Handle migration for persisted "all" values
6. Update tests
7. Run `just test` to verify
