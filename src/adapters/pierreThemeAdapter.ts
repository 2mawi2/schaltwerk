import type { DiffsThemeNames, ThemesType } from '@pierre/diffs'

export type SchaltwerkThemeId =
  | 'dark'
  | 'light'
  | 'tokyonight'
  | 'catppuccin'
  | 'catppuccin-macchiato'
  | 'gruvbox'
  | 'everforest'
  | 'kanagawa'
  | 'ayu'

const SCHALTWERK_TO_SHIKI_THEME: Record<SchaltwerkThemeId, DiffsThemeNames> = {
  dark: 'github-dark',
  light: 'github-light',
  tokyonight: 'tokyo-night',
  catppuccin: 'catppuccin-mocha',
  'catppuccin-macchiato': 'catppuccin-macchiato',
  gruvbox: 'vitesse-dark',
  everforest: 'everforest-dark',
  kanagawa: 'slack-dark',
  ayu: 'ayu-dark',
}

const THEME_TYPE_MAP: Record<SchaltwerkThemeId, 'dark' | 'light'> = {
  dark: 'dark',
  light: 'light',
  tokyonight: 'dark',
  catppuccin: 'dark',
  'catppuccin-macchiato': 'dark',
  gruvbox: 'dark',
  everforest: 'dark',
  kanagawa: 'dark',
  ayu: 'dark',
}

export function getShikiThemeForSchaltwerk(themeId: SchaltwerkThemeId): DiffsThemeNames {
  return SCHALTWERK_TO_SHIKI_THEME[themeId] ?? 'github-dark'
}

export function getThemeType(themeId: SchaltwerkThemeId): 'dark' | 'light' {
  return THEME_TYPE_MAP[themeId] ?? 'dark'
}

export function getPierreThemes(themeId: SchaltwerkThemeId): ThemesType {
  const shikiTheme = getShikiThemeForSchaltwerk(themeId)
  const isLight = getThemeType(themeId) === 'light'

  return {
    dark: isLight ? 'github-dark' : shikiTheme,
    light: isLight ? shikiTheme : 'github-light',
  }
}

export function getPierreUnsafeCSS(themeId: SchaltwerkThemeId): string {
  const isDark = getThemeType(themeId) === 'dark'

  return `
    :host {
      color-scheme: ${isDark ? 'dark' : 'light'};
    }

    [data-diffs] {
      content-visibility: auto;

      --diffs-bg: var(--color-bg-primary);
      --diffs-fg: var(--color-text-primary);
      --diffs-fg-number: var(--color-text-tertiary);

      --diffs-deletion-base: var(--color-diff-removed-text);
      --diffs-addition-base: var(--color-diff-added-text);
      --diffs-modified-base: var(--color-diff-modified-text);

      --diffs-mixer: white;
      --diffs-bg-buffer: color-mix(in lab, var(--diffs-bg) 92%, var(--diffs-mixer));
      --diffs-bg-hover: color-mix(in lab, var(--diffs-bg) 91%, var(--diffs-mixer));
      --diffs-bg-context: color-mix(in lab, var(--diffs-bg) 92.5%, var(--diffs-mixer));
      --diffs-bg-separator: color-mix(in lab, var(--diffs-bg) 85%, var(--diffs-mixer));

      --diffs-bg-deletion: color-mix(in lab, var(--diffs-bg) 80%, var(--diffs-deletion-base));
      --diffs-bg-deletion-number: color-mix(in lab, var(--diffs-bg) 85%, var(--diffs-deletion-base));
      --diffs-bg-deletion-hover: color-mix(in lab, var(--diffs-bg) 75%, var(--diffs-deletion-base));
      --diffs-bg-deletion-emphasis: rgb(from var(--diffs-deletion-base) r g b / 0.2);

      --diffs-bg-addition: color-mix(in lab, var(--diffs-bg) 80%, var(--diffs-addition-base));
      --diffs-bg-addition-number: color-mix(in lab, var(--diffs-bg) 85%, var(--diffs-addition-base));
      --diffs-bg-addition-hover: color-mix(in lab, var(--diffs-bg) 70%, var(--diffs-addition-base));
      --diffs-bg-addition-emphasis: rgb(from var(--diffs-addition-base) r g b / 0.2);

      --diffs-selection-base: var(--diffs-modified-base);
      --diffs-selection-number-fg: color-mix(in lab, var(--diffs-selection-base) 75%, var(--diffs-mixer));
      --diffs-bg-selection: color-mix(in lab, var(--diffs-bg) 75%, var(--diffs-selection-base));
      --diffs-bg-selection-number: color-mix(in lab, var(--diffs-bg) 60%, var(--diffs-selection-base));

      --diffs-font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace);
      --diffs-tab-size: 4;
      --diffs-gap-block: 0;
      --diffs-min-number-column-width: 2ch;
    }

    .shiki {
      background-color: transparent !important;
    }

    pre {
      background-color: transparent !important;
      margin: 0;
    }

    code {
      background-color: transparent !important;
    }

    [data-column-content] {
      user-select: text;
      -webkit-user-select: text;
    }

    [data-code] {
      user-select: text;
      -webkit-user-select: text;
    }

    [data-column-content] span,
    [data-code] span {
      user-select: text;
      -webkit-user-select: text;
    }

    [data-line] {
      grid-template-columns: 5ch 1fr !important;
    }

    [data-column-number] {
      position: sticky;
      left: 0;
      z-index: 1;
      text-align: right;
      padding-right: 1.5ch;
    }

    [data-column-number]::after {
      content: '+';
      position: absolute;
      left: 4px;
      top: 50%;
      transform: translateY(-50%);
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--diffs-font-size);
      font-weight: 700;
      color: var(--diffs-fg);
      opacity: 0;
      transition: opacity 0.15s ease;
      pointer-events: none;
      border-radius: 6px;
      background-color: var(--diffs-bg);
      box-shadow: 0 0 0 1px var(--diffs-bg-separator);
    }

    [data-line]:hover [data-column-number]::after {
      opacity: 1;
    }

    [data-selected-line] [data-column-number]::after,
    [data-line][data-selected-line] [data-column-number]::after {
      opacity: 0;
    }

    [data-slot="diff-hunk-separator-line-number"] {
      position: sticky;
      left: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    [data-slot="diff-hunk-separator-content"] {
      position: sticky;
      left: var(--diffs-column-number-width, 4ch);
      user-select: none;
      cursor: default;
      text-align: left;
    }

    [data-separator-wrapper] {
      margin: 0 !important;
      border-radius: 0 !important;
    }

    [data-expand-button] {
      width: 6.5ch !important;
      height: 24px !important;
      justify-content: end !important;
      padding-left: 3ch !important;
      padding-inline: 1ch !important;
    }

    [data-separator-multi-button] {
      grid-template-rows: 10px 10px !important;
    }

    [data-separator-multi-button] [data-expand-button] {
      height: 12px !important;
    }

    [data-separator-content] {
      height: 24px !important;
    }

    [data-code] {
      overflow-x: auto !important;
    }
  `
}

export function isValidSchaltwerkTheme(themeId: string): themeId is SchaltwerkThemeId {
  return themeId in SCHALTWERK_TO_SHIKI_THEME
}
