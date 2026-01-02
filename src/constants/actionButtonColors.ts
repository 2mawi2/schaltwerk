export const ACTION_BUTTON_COLORS = {
  slate: 'bg-elevated/60 hover:bg-hover/70 text-secondary border border-default/50 hover:border-subtle/60',
  blue: 'bg-accent-blue/40 hover:bg-accent-blue/50 text-accent-blue border border-accent-blue/50 hover:border-accent-blue/60 shadow-sm shadow-accent-blue/20 hover:shadow-accent-blue/30',
  green: 'bg-accent-green/40 hover:bg-accent-green/50 text-accent-green border border-accent-green/50 hover:border-accent-green/60 shadow-sm shadow-accent-green/20 hover:shadow-accent-green/30',
  amber: 'bg-accent-amber/40 hover:bg-accent-amber/50 text-accent-amber border border-accent-amber/50 hover:border-accent-amber/60 shadow-sm shadow-accent-amber/20 hover:shadow-accent-amber/30',
} as const

export type ActionButtonColor = keyof typeof ACTION_BUTTON_COLORS

export function getActionButtonColorClasses(color?: string): string {
  return ACTION_BUTTON_COLORS[color as ActionButtonColor] || ACTION_BUTTON_COLORS.slate
}
