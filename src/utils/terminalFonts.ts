export function buildTerminalFontFamily(custom?: string | null): string {
  const base = [
    'Menlo',
    'Monaco',
    'ui-monospace',
    'SFMono-Regular',
    'DejaVu Sans Mono',
    'Liberation Mono',
    'Noto Sans Mono',
    'Ubuntu Mono',
    'JetBrains Mono',
    'Fira Code',
    'Source Code Pro',
    'MesloLGS NF',
    'Hack Nerd Font Mono',
    'Symbols Nerd Font Mono',
    'Symbols Nerd Font',
    'Noto Color Emoji',
    'Apple Color Emoji',
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
