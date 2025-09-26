export const ACTION_BUTTON_COLORS = {
  slate: 'bg-slate-700/60 hover:bg-slate-600/70 text-slate-200 border border-slate-600/50 hover:border-slate-500/60',
  blue: 'bg-blue-600/40 hover:bg-blue-600/50 text-blue-200 border border-blue-500/50 hover:border-blue-400/60 shadow-sm shadow-blue-500/20 hover:shadow-blue-500/30',
  green: 'bg-green-600/40 hover:bg-green-600/50 text-green-200 border border-green-500/50 hover:border-green-400/60 shadow-sm shadow-green-500/20 hover:shadow-green-500/30',
  amber: 'bg-amber-600/40 hover:bg-amber-600/50 text-amber-200 border border-amber-500/50 hover:border-amber-400/60 shadow-sm shadow-amber-500/20 hover:shadow-amber-500/30',
} as const

export type ActionButtonColor = keyof typeof ACTION_BUTTON_COLORS

export function getActionButtonColorClasses(color?: string): string {
  return ACTION_BUTTON_COLORS[color as ActionButtonColor] || ACTION_BUTTON_COLORS.slate
}
