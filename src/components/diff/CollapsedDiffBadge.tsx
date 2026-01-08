import { VscChevronRight } from 'react-icons/vsc'
import { DiffFilterResult, formatDiffSize } from '../../domains/diff/diffFilters'
import { useTranslation } from '../../common/i18n'

interface CollapsedDiffBadgeProps {
  filterResult: DiffFilterResult
  onClick: () => void
}

export function CollapsedDiffBadge({ filterResult, onClick }: CollapsedDiffBadgeProps) {
  const { t } = useTranslation()
  const { reason, lineCount, sizeBytes } = filterResult

  let badgeText = ''
  if (reason === 'generated') {
    badgeText = t.collapsedDiffBadge.generatedFile
  } else if (reason === 'large' && lineCount && sizeBytes) {
    badgeText = t.collapsedDiffBadge.largeDiff
      .replace('{lines}', lineCount.toLocaleString())
      .replace('{size}', formatDiffSize(sizeBytes))
  } else if (reason === 'both' && lineCount && sizeBytes) {
    badgeText = t.collapsedDiffBadge.generatedLargeDiff
      .replace('{lines}', lineCount.toLocaleString())
      .replace('{size}', formatDiffSize(sizeBytes))
  } else if (reason === 'deleted') {
    badgeText = t.collapsedDiffBadge.deletedFile
  }

  return (
    <div className="px-4 py-8">
      <button
        onClick={onClick}
        className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-lg border transition-colors"
        style={{
          backgroundColor: 'var(--color-bg-secondary)',
          borderColor: 'var(--color-border-subtle)',
          color: 'var(--color-text-secondary)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'
          e.currentTarget.style.borderColor = 'var(--color-accent-blue)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'
          e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
        }}
      >
        <VscChevronRight className="text-lg" />
        <div className="flex flex-col items-center gap-1">
          <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {badgeText}
          </div>
          <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {t.collapsedDiffBadge.clickToExpand}
          </div>
        </div>
      </button>
    </div>
  )
}
