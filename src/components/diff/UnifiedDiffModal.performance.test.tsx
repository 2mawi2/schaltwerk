import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { ReviewProvider } from '../../contexts/ReviewContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ProjectProvider } from '../../contexts/ProjectContext'
import { FontSizeProvider } from '../../contexts/FontSizeContext'
import { SessionsProvider } from '../../contexts/SessionsContext'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))

function wrap(children: React.ReactNode) {
  return (
    <ProjectProvider>
      <FontSizeProvider>
        <SessionsProvider>
          <SelectionProvider>
            <FocusProvider>
              <ReviewProvider>
                {children}
              </ReviewProvider>
            </FocusProvider>
          </SelectionProvider>
        </SessionsProvider>
      </FontSizeProvider>
    </ProjectProvider>
  )
}

describe('UnifiedDiffModal performance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initial render loads only selected file quickly', async () => {
    const files = Array.from({ length: 40 }, (_, i) => ({ path: `file-${i}.ts`, change_type: 'modified' as const }))

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetChangedFilesFromMain) return files
      if (cmd === TauriCommands.GetCurrentBranchName) return 'feature/x'
      if (cmd === TauriCommands.GetBaseBranchName) return 'main'
      if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc1234', 'def5678']
      if (cmd === TauriCommands.GetDiffViewPreferences) return { continuous_scroll: false, compact_diffs: true }
      if (cmd === TauriCommands.GetFileDiffFromMain) {
        const base = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n') + '\n'
        const head = base
        return [base, head]
      }
      return undefined
    })

    const start = performance.now()
    render(wrap(<UnifiedDiffModal filePath={files[10].path} isOpen={true} onClose={() => {}} />))

    await waitFor(() => {
      expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument()
    })

    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(800)
  })
})
