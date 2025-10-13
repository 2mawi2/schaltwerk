import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { useReview } from '../../contexts/ReviewContext'
import { TestProviders } from '../../tests/test-utils'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))

function SeedOrchestratorReview() {
  const { currentReview, startReview, addComment } = useReview()
  React.useEffect(() => {
    if (!currentReview || currentReview.sessionName !== 'orchestrator') {
      startReview('orchestrator')
      return
    }
    if (currentReview.comments.length === 0) {
      addComment({
        filePath: 'main.rs',
        lineRange: { start: 1, end: 1 },
        side: 'new',
        selectedText: 'fn main() {}',
        comment: 'Please improve logging.'
      })
    }
  }, [currentReview, startReview, addComment])
  return null
}

describe('UnifiedDiffModal orchestrator review submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pastes review into orchestrator terminal when finishing review', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, _args?: unknown) => {
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
        case TauriCommands.GetDiffViewPreferences:
          return { continuous_scroll: false, compact_diffs: true }
        case TauriCommands.GetFileDiffFromMain:
          return ['fn main() {}\n', 'fn main() {}\n']
        case TauriCommands.PasteAndSubmitTerminal:
          return undefined
        default:
          return undefined
      }
    })

    render(
      <TestProviders>
        <SeedOrchestratorReview />
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    // Wait for modal header with increased timeout
    await waitFor(() => {
      expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument()
    }, { timeout: 10000 })

    // Button should display the comment count
    const finishBtn = await screen.findByText(/Finish Review \(1 comment\)/, undefined, { timeout: 10000 })
    fireEvent.click(finishBtn)

    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        TauriCommands.PasteAndSubmitTerminal,
        expect.objectContaining({ id: expect.stringMatching(/orchestrator-.*-top/) })
      )
    }, { timeout: 10000 })
  })
})
