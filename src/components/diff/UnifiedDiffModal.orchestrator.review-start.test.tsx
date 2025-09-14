import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TestProviders } from '../../tests/test-utils'
import { useReview } from '../../contexts/ReviewContext'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))

function AddOneComment() {
  const { currentReview, addComment } = useReview()
  React.useEffect(() => {
    if (currentReview && currentReview.sessionName === 'orchestrator' && currentReview.comments.length === 0) {
      addComment({
        filePath: 'main.rs',
        lineRange: { start: 1, end: 1 },
        side: 'new',
        selectedText: 'fn main() {}',
        comment: 'Looks good'
      })
    }
  }, [currentReview, addComment])
  return null
}

describe('UnifiedDiffModal orchestrator auto-start review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('auto-starts review for orchestrator so comments appear in the list', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case TauriCommands.GetOrchestratorWorkingChanges:
          return [{ path: 'main.rs', change_type: 'modified' }]
        case TauriCommands.ComputeUnifiedDiffBackend:
          return { lines: [], stats: { additions: 0, deletions: 0 }, fileInfo: { sizeBytes: 0 }, isLargeFile: false }
        case TauriCommands.GetCurrentBranchName:
          return 'main'
        case TauriCommands.GetBaseBranchName:
          return 'main'
        case TauriCommands.GetCommitComparisonInfo:
          return ['abc1234', 'def5678']
        default:
          return undefined
      }
    })

    render(
      <TestProviders>
        <AddOneComment />
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    // Wait for sidebar to render
    await waitFor(() => {
      expect(screen.getByText('Changed Files')).toBeInTheDocument()
    })

    // The finish review button should reflect one comment now
    await waitFor(() => {
      expect(screen.getByText(/Finish Review \(1 comment\)/)).toBeInTheDocument()
    })
  })
})
