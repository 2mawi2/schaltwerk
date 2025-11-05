export function buildTerminalFontFamily(custom?: string | null): string {
  const base = [
    'SFMono-Regular',
    'Menlo',
    'Monaco',
    'Consolas',
    'DejaVu Sans Mono',
    'Liberation Mono',
    'Noto Sans Mono',
    'Ubuntu Mono',
    'Fira Code',
    'Source Code Pro',
    'MesloLGS NF',
    'Hack Nerd Font Mono',
    'Symbols Nerd Font Mono',
    'Symbols Nerd Font',
    'Noto Color Emoji',
    'Apple Color Emoji',
    'ui-monospace',
    'monospace',
  ]

  const parts: string[] = []
  if (custom && custom.trim().length > 0) {
    parts.push(custom)
  }
  parts.push(...base)

  return parts
    .map(p => (p.includes(' ') || p.includes(',') ? `"${p}"` : p))
    .join(', ')
}
