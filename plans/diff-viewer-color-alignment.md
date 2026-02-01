# Diff Viewer Color Alignment Plan

## Objective
Align schaltwerk's diff viewer UI colors with superset's implementation to achieve cleaner, more consistent diff rendering with proper visual hierarchy.

## Analysis Summary

### Superset's Approach (Monaco Editor)
- **Library**: Monaco Editor's `DiffEditor` component
- **Color source**: Terminal ANSI palette (16-color standard)
- **Key colors**:
  - Additions: `#5af78e` (terminal green)
  - Deletions: `#ff5f56` (terminal red)
- **Opacity layering** (creates visual hierarchy):
  - Line background: **8%** opacity
  - Word/text highlight: **13%** opacity
  - Gutter background: **20%** opacity
- **Color mixing**: Uses alpha transparency on base terminal colors

### Schaltwerk's Current Approach (@pierre/diffs)
- **Library**: `@pierre/diffs` with Shiki syntax highlighting
- **Color source**: Theme-specific colors defined per-theme
- **Current colors** (dark theme example):
  - Added text: `#57a64a`, bg: `rgba(87, 166, 74, 0.15)`
  - Removed text: `#f48771`, bg: `rgba(244, 135, 113, 0.15)`
- **Opacity**: Single level (15%) for backgrounds
- **Color mixing**: CSS `color-mix()` in lab color space

## Plan: UI Color Layer Changes Only

### 1. Update Theme CSS Variables

Each theme file needs updated diff color definitions following superset's pattern:

**Before** (current - single opacity):
```css
--color-diff-added-bg: rgba(87, 166, 74, 0.15);
--color-diff-added-text: #57a64a;
```

**After** (superset-style - multiple opacities):
```css
/* Base terminal colors */
--color-diff-added-base: #5af78e;
--color-diff-removed-base: #ff5f56;
--color-diff-modified-base: #e0af68;

/* Line backgrounds (8% - subtle) */
--color-diff-added-bg: rgba(90, 247, 142, 0.08);
--color-diff-removed-bg: rgba(255, 95, 86, 0.08);
--color-diff-modified-bg: rgba(224, 175, 104, 0.08);

/* Word highlights (13% - medium) */
--color-diff-added-text-bg: rgba(90, 247, 142, 0.13);
--color-diff-removed-text-bg: rgba(255, 95, 86, 0.13);

/* Gutter highlights (20% - prominent) */
--color-diff-added-gutter: rgba(90, 247, 142, 0.2);
--color-diff-removed-gutter: rgba(255, 95, 86, 0.2);

/* Text colors (full opacity for line indicators) */
--color-diff-added-text: #5af78e;
--color-diff-removed-text: #ff5f56;
--color-diff-modified-text: #e0af68;
```

### 2. Files to Modify

#### Theme CSS Files (9 files)
- `src/styles/themes/dark.css`
- `src/styles/themes/light.css`
- `src/styles/themes/tokyonight.css`
- `src/styles/themes/catppuccin.css`
- `src/styles/themes/catppuccin-macchiato.css`
- `src/styles/themes/gruvbox.css`
- `src/styles/themes/everforest.css`
- `src/styles/themes/kanagawa.css`
- `src/styles/themes/ayu.css`

#### Pierre Theme Adapter
- `src/adapters/pierreThemeAdapter.ts` - Update CSS variable references in `getPierreUnsafeCSS()`

#### Theme TypeScript (optional)
- `src/common/theme.ts` - Update `diff` object if TypeScript references are used

### 3. Theme-Specific Base Colors

Each theme should use its own terminal-style colors that match its palette:

| Theme | Added (Green) | Removed (Red) | Modified (Yellow) |
|-------|---------------|---------------|-------------------|
| dark | #5af78e | #ff5f56 | #e0af68 |
| light | #1a7f37 | #cf222e | #9a6700 |
| tokyonight | #9ece6a | #f7768e | #e0af68 |
| catppuccin | #a6e3a1 | #f38ba8 | #f9e2af |
| catppuccin-macchiato | #a6da95 | #ed8796 | #eed49f |
| gruvbox | #b8bb26 | #fb4934 | #fabd2f |
| everforest | #a7c080 | #e67e80 | #dbbc7f |
| kanagawa | #98BB6C | #C34043 | #E6C384 |
| ayu | #7FD962 | #F26D78 | #E6B450 |

### 4. Update Pierre CSS Variables

In `pierreThemeAdapter.ts`, update the CSS to use the new variables:

```css
[data-diffs] {
  --diffs-deletion-base: var(--color-diff-removed-base);
  --diffs-addition-base: var(--color-diff-added-base);
  --diffs-modified-base: var(--color-diff-modified-base);

  /* Line backgrounds - 8% */
  --diffs-bg-deletion: var(--color-diff-removed-bg);
  --diffs-bg-addition: var(--color-diff-added-bg);

  /* Word emphasis - 13% */
  --diffs-bg-deletion-emphasis: var(--color-diff-removed-text-bg);
  --diffs-bg-addition-emphasis: var(--color-diff-added-text-bg);

  /* Gutter - 20% */
  --diffs-bg-deletion-number: var(--color-diff-removed-gutter);
  --diffs-bg-addition-number: var(--color-diff-added-gutter);
}
```

### 5. Implementation Order

1. **Update `dark.css`** first as reference implementation
2. **Update `pierreThemeAdapter.ts`** to consume new variables
3. **Verify visually** with `bun run tauri:dev`
4. **Apply pattern to remaining themes** (8 more CSS files)
5. **Update `theme.ts`** if needed for TypeScript consumers
6. **Run full test suite** (`just test`)

### 6. Visual Result

After implementation:
- **Cleaner diff lines**: Subtle 8% tint instead of 15%
- **Better word highlighting**: 13% makes changed words stand out
- **Clear gutter indicators**: 20% provides visible but not overwhelming markers
- **Consistent with superset**: Same visual hierarchy and color approach

## Not In Scope

- Changing from @pierre/diffs to Monaco Editor (library change)
- Backend diff computation changes
- New diff features (side-by-side toggle, etc.)
- Performance optimizations

## Testing

1. Visual inspection of diff viewer in all themes
2. Verify all 10 themes render correctly
3. Check both light and dark mode themes
4. Ensure syntax highlighting still works
5. Run `just test` for full validation suite
