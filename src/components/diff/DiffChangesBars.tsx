import { useMemo } from 'react'

export interface DiffChangesProps {
  additions: number
  deletions: number
  variant?: 'default' | 'bars'
  className?: string
}

const TOTAL_BLOCKS = 5

function calculateBlockCounts(additions: number, deletions: number) {
  if (additions === 0 && deletions === 0) {
    return { added: 0, deleted: 0, neutral: TOTAL_BLOCKS }
  }

  const total = additions + deletions

  if (total < 5) {
    const added = additions > 0 ? 1 : 0
    const deleted = deletions > 0 ? 1 : 0
    const neutral = TOTAL_BLOCKS - added - deleted
    return { added, deleted, neutral }
  }

  const ratio = additions > deletions ? additions / deletions : deletions / additions
  let blocksForColors = TOTAL_BLOCKS

  if (total < 20) {
    blocksForColors = TOTAL_BLOCKS - 1
  } else if (ratio < 4) {
    blocksForColors = TOTAL_BLOCKS - 1
  }

  const percentAdded = additions / total
  const percentDeleted = deletions / total

  const addedRaw = percentAdded * blocksForColors
  const deletedRaw = percentDeleted * blocksForColors

  let added = additions > 0 ? Math.max(1, Math.round(addedRaw)) : 0
  let deleted = deletions > 0 ? Math.max(1, Math.round(deletedRaw)) : 0

  if (additions > 0 && additions <= 5) added = Math.min(added, 1)
  if (additions > 5 && additions <= 10) added = Math.min(added, 2)
  if (deletions > 0 && deletions <= 5) deleted = Math.min(deleted, 1)
  if (deletions > 5 && deletions <= 10) deleted = Math.min(deleted, 2)

  let totalAllocated = added + deleted
  if (totalAllocated > blocksForColors) {
    if (addedRaw > deletedRaw) {
      added = blocksForColors - deleted
    } else {
      deleted = blocksForColors - added
    }
    totalAllocated = added + deleted
  }

  const neutral = Math.max(0, TOTAL_BLOCKS - totalAllocated)

  return { added, deleted, neutral }
}

export function DiffChangesBars({
  additions,
  deletions,
  variant = 'default',
  className = '',
}: DiffChangesProps) {
  const total = additions + deletions

  const blockCounts = useMemo(
    () => calculateBlockCounts(additions, deletions),
    [additions, deletions]
  )

  const blocks = useMemo(() => {
    const addColor = 'var(--color-diff-added-text)'
    const deleteColor = 'var(--color-diff-removed-text)'
    const neutralColor = 'var(--color-text-muted)'

    return [
      ...Array(blockCounts.added).fill(addColor),
      ...Array(blockCounts.deleted).fill(deleteColor),
      ...Array(blockCounts.neutral).fill(neutralColor),
    ].slice(0, 5)
  }, [blockCounts])

  if (variant === 'default' && total === 0) {
    return null
  }

  if (variant === 'bars') {
    return (
      <div className={`w-[18px] flex-shrink-0 ${className}`}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 18 12"
          fill="none"
          className="block w-full h-auto"
        >
          <g>
            {blocks.map((color, i) => (
              <rect
                key={i}
                x={i * 4}
                width="2"
                height="12"
                rx="1"
                fill={color}
              />
            ))}
          </g>
        </svg>
      </div>
    )
  }

  return (
    <div className={`flex gap-2 justify-end items-center font-mono text-xs ${className}`}>
      <span style={{ color: 'var(--color-diff-added-text)' }}>+{additions}</span>
      <span style={{ color: 'var(--color-diff-removed-text)' }}>-{deletions}</span>
    </div>
  )
}
