import { theme } from '../../common/theme'

export function GitlabLabelChip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        fontSize: theme.fontSize.caption,
        fontWeight: 500,
        color: 'var(--color-text-secondary)',
        backgroundColor: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 9999,
        padding: '1px 8px',
        lineHeight: theme.lineHeight.badge,
      }}
    >
      {label}
    </span>
  )
}
