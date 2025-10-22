import clsx from 'clsx'

type BadgeLayout = 'row' | 'column'
type BadgeSize = 'default' | 'compact'

interface DiffChangeBadgesProps {
  additions: number
  deletions: number
  changes?: number
  isBinary?: boolean
  className?: string
  layout?: BadgeLayout
  size?: BadgeSize
}

const baseNumberClass = 'font-semibold tracking-tight tabular-nums'
const additionClass = 'text-green-400'
const deletionClass = 'text-red-400'
const binaryClass = 'text-purple-300 font-medium'

const textSizeFor = (layout: BadgeLayout, size: BadgeSize) => {
  if (layout === 'column') {
    return size === 'compact' ? 'text-[10px]' : 'text-[11px]'
  }
  return size === 'compact' ? 'text-[11px]' : 'text-[12px]'
}

const gapFor = (layout: BadgeLayout) =>
  layout === 'column' ? 'flex-col items-end gap-0.5' : 'items-center gap-2'

export function DiffChangeBadges({
  additions,
  deletions,
  changes,
  isBinary,
  className,
  layout = 'column',
  size = 'default',
}: DiffChangeBadgesProps) {
  void changes

  const containerClasses = clsx(
    'flex justify-end',
    gapFor(layout),
    textSizeFor(layout, size),
    className
  )

  if (isBinary) {
    return (
      <div className={containerClasses}>
        <span className={clsx(baseNumberClass, binaryClass)}>Binary</span>
      </div>
    )
  }

  const itemClass = layout === 'column'
    ? 'flex items-baseline gap-0.5'
    : 'flex items-baseline gap-1'

  return (
    <div className={containerClasses}>
      <span className={itemClass}>
        <span className={clsx(baseNumberClass, additionClass)}>+{additions}</span>
      </span>
      <span className={itemClass}>
        <span className={clsx(baseNumberClass, deletionClass)}>-{deletions}</span>
      </span>
    </div>
  )
}
