import { theme } from '../../common/theme'
import { VscChevronRight } from 'react-icons/vsc'
import { DiffFilterResult, formatDiffSize } from '../../domains/diff/diffFilters'

interface CollapsedDiffBadgeProps {
  filterResult: DiffFilterResult
  onClick: () => void
}

export function CollapsedDiffBadge({ filterResult, onClick }: CollapsedDiffBadgeProps) {
  const { reason, lineCount, sizeBytes } = filterResult

  let badgeText = ''
  if (reason === 'generated') {
    badgeText = 'Generated file'
  } else if (reason === 'large' && lineCount && sizeBytes) {
    badgeText = `Large diff (${lineCount.toLocaleString()} lines, ${formatDiffSize(sizeBytes)})`
  } else if (reason === 'both' && lineCount && sizeBytes) {
    badgeText = `Generated file • Large diff (${lineCount.toLocaleString()} lines, ${formatDiffSize(sizeBytes)})`
  } else if (reason === 'deleted') {
    badgeText = 'Deleted file'
  }

  return (
    <div className="px-4 py-8">
      <button
        onClick={onClick}
        className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-lg border transition-colors"
        style={{
          backgroundColor: theme.colors.background.secondary,
          borderColor: theme.colors.border.subtle,
          color: theme.colors.text.secondary
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = theme.colors.background.hover
          e.currentTarget.style.borderColor = theme.colors.accent.blue.DEFAULT
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = theme.colors.background.secondary
          e.currentTarget.style.borderColor = theme.colors.border.subtle
        }}
      >
        <VscChevronRight className="text-lg" />
        <div className="flex flex-col items-center gap-1">
          <div className="text-sm font-medium" style={{ color: theme.colors.text.primary }}>
            {badgeText}
          </div>
          <div className="text-xs" style={{ color: theme.colors.text.tertiary }}>
            Click to expand
          </div>
        </div>
      </button>
    </div>
  )
}
