import { memo } from 'react'
import type { HistoryItemViewModel, HistoryItem, CommitDetailState } from './types'
import { HistoryItemRow } from './HistoryItemRow'

interface HistoryListProps {
  items: HistoryItemViewModel[]
  selectedCommitId: string | null
  onSelectCommit: (commitId: string) => void
  onContextMenu: (event: React.MouseEvent, commit: HistoryItem) => void
  commitDetails: Record<string, CommitDetailState>
  onToggleCommitDetails: (viewModel: HistoryItemViewModel) => void
  onOpenCommitDiff?: (viewModel: HistoryItemViewModel, filePath?: string) => void
}

const DETAIL_METRICS = {
  topPadding: 0,
  bottomPadding: 0,
  itemHeight: 22,
  messageHeight: 20,
}

export const HistoryList = memo(({ items, selectedCommitId, onSelectCommit, onContextMenu, commitDetails, onToggleCommitDetails, onOpenCommitDiff }: HistoryListProps) => {
  return (
    <div className="flex-1 flex min-h-0 relative overflow-y-auto">
      <div className="flex flex-col w-full">
        {items.map(viewModel => (
          <HistoryItemRow
            key={viewModel.historyItem.id}
            viewModel={viewModel}
            isSelected={viewModel.historyItem.id === selectedCommitId}
            onSelect={onSelectCommit}
            onContextMenu={onContextMenu}
            detailState={commitDetails[viewModel.historyItem.id]}
            onToggleDetails={onToggleCommitDetails}
            detailTopPadding={DETAIL_METRICS.topPadding}
            detailBottomPadding={DETAIL_METRICS.bottomPadding}
            detailItemHeight={DETAIL_METRICS.itemHeight}
            detailMessageHeight={DETAIL_METRICS.messageHeight}
            onOpenCommitDiff={onOpenCommitDiff}
          />
        ))}
      </div>
    </div>
  )
})

HistoryList.displayName = 'HistoryList'
