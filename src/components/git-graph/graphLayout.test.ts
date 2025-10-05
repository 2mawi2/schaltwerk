import { describe, it, expect } from 'vitest'
import { toViewModel } from './graphLayout'
import type { HistoryProviderSnapshot, HistoryItem } from './types'

const SWIMLANE_COLORS = [
  '#FFB000',
  '#DC267F',
  '#994F00',
  '#40B0A6',
  '#B66DFF',
]

function createSnapshot(items: HistoryItem[]): HistoryProviderSnapshot {
  return {
    items,
    currentRef: undefined,
    currentRemoteRef: undefined,
    currentBaseRef: undefined
  }
}

describe('graphLayout - toViewModel', () => {
  describe('Edge Cases', () => {
    it('should handle empty history', () => {
      const snapshot = createSnapshot([])
      const viewModels = toViewModel(snapshot)

      expect(viewModels).toHaveLength(0)
    })

    it('should handle single commit with no parents', () => {
      const snapshot = createSnapshot([
        { id: 'a', parentIds: [], subject: 'Initial commit', author: 'Test', timestamp: 0 }
      ])
      const viewModels = toViewModel(snapshot)

      expect(viewModels).toHaveLength(1)
      expect(viewModels[0].inputSwimlanes).toHaveLength(0)
      expect(viewModels[0].outputSwimlanes).toHaveLength(0)
    })
  })

  describe('Linear History', () => {
    it('should create single swimlane with consistent color', () => {
      const snapshot = createSnapshot([
        { id: 'a', parentIds: ['b'], subject: 'Commit A', author: 'Test', timestamp: 4000 },
        { id: 'b', parentIds: ['c'], subject: 'Commit B', author: 'Test', timestamp: 3000 },
        { id: 'c', parentIds: ['d'], subject: 'Commit C', author: 'Test', timestamp: 2000 },
        { id: 'd', parentIds: ['e'], subject: 'Commit D', author: 'Test', timestamp: 1000 },
        { id: 'e', parentIds: [], subject: 'Commit E', author: 'Test', timestamp: 0 }
      ])
      const viewModels = toViewModel(snapshot)

      expect(viewModels).toHaveLength(5)

      // Commit 'a' - start of chain
      expect(viewModels[0].inputSwimlanes).toHaveLength(0)
      expect(viewModels[0].outputSwimlanes).toHaveLength(1)
      expect(viewModels[0].outputSwimlanes[0].id).toBe('b')
      expect(viewModels[0].outputSwimlanes[0].color).toBe(SWIMLANE_COLORS[0])

      // Commit 'b' - middle of chain
      expect(viewModels[1].inputSwimlanes).toHaveLength(1)
      expect(viewModels[1].inputSwimlanes[0].id).toBe('b')
      expect(viewModels[1].inputSwimlanes[0].color).toBe(SWIMLANE_COLORS[0])
      expect(viewModels[1].outputSwimlanes).toHaveLength(1)
      expect(viewModels[1].outputSwimlanes[0].id).toBe('c')
      expect(viewModels[1].outputSwimlanes[0].color).toBe(SWIMLANE_COLORS[0])

      // All commits should use same color
      viewModels.forEach((vm) => {
        if (vm.outputSwimlanes.length > 0) {
          expect(vm.outputSwimlanes[0].color).toBe(SWIMLANE_COLORS[0])
        }
      })

      // Last commit has no output
      expect(viewModels[4].outputSwimlanes).toHaveLength(0)
    })

    it('should maintain swimlane continuity (input matches previous output)', () => {
      const snapshot = createSnapshot([
        { id: 'a', parentIds: ['b'], subject: 'A', author: 'Test', timestamp: 2000 },
        { id: 'b', parentIds: ['c'], subject: 'B', author: 'Test', timestamp: 1000 },
        { id: 'c', parentIds: [], subject: 'C', author: 'Test', timestamp: 0 }
      ])
      const viewModels = toViewModel(snapshot)

      // Each commit's input should match previous commit's output
      for (let i = 1; i < viewModels.length; i++) {
        expect(viewModels[i].inputSwimlanes).toEqual(viewModels[i - 1].outputSwimlanes)
      }
    })
  })

  describe('Merge Commits', () => {
    it('should handle simple merge (single commit in topic branch)', () => {
      const snapshot = createSnapshot([
        { id: 'a', parentIds: ['b'], subject: 'A', author: 'Test', timestamp: 4000 },
        { id: 'b', parentIds: ['c', 'd'], subject: 'Merge', author: 'Test', timestamp: 3000 },
        { id: 'd', parentIds: ['c'], subject: 'Topic', author: 'Test', timestamp: 2000 },
        { id: 'c', parentIds: ['e'], subject: 'C', author: 'Test', timestamp: 1000 },
        { id: 'e', parentIds: [], subject: 'E', author: 'Test', timestamp: 0 }
      ])
      const viewModels = toViewModel(snapshot)

      // Commit 'b' - merge commit
      expect(viewModels[1].historyItem.id).toBe('b')
      expect(viewModels[1].inputSwimlanes).toHaveLength(1)
      expect(viewModels[1].inputSwimlanes[0].id).toBe('b')
      expect(viewModels[1].outputSwimlanes).toHaveLength(2)
      expect(viewModels[1].outputSwimlanes[0].id).toBe('c') // First parent
      expect(viewModels[1].outputSwimlanes[0].color).toBe(SWIMLANE_COLORS[0])
      expect(viewModels[1].outputSwimlanes[1].id).toBe('d') // Second parent (branch)
      expect(viewModels[1].outputSwimlanes[1].color).toBe(SWIMLANE_COLORS[1])

      // Commit 'd' - on topic branch
      expect(viewModels[2].historyItem.id).toBe('d')
      expect(viewModels[2].inputSwimlanes).toHaveLength(2)
      expect(viewModels[2].outputSwimlanes).toHaveLength(2)
      expect(viewModels[2].outputSwimlanes[0].id).toBe('c')
      expect(viewModels[2].outputSwimlanes[1].id).toBe('c') // Both converge to 'c'

      // Commit 'c' - merge point
      expect(viewModels[3].historyItem.id).toBe('c')
      expect(viewModels[3].inputSwimlanes).toHaveLength(2)
      expect(viewModels[3].inputSwimlanes[0].id).toBe('c')
      expect(viewModels[3].inputSwimlanes[1].id).toBe('c')
      expect(viewModels[3].outputSwimlanes).toHaveLength(1)
      expect(viewModels[3].outputSwimlanes[0].id).toBe('e')
    })

    it('should handle merge with multiple commits in topic branch', () => {
      const snapshot = createSnapshot([
        { id: 'a', parentIds: ['b', 'c'], subject: 'Merge', author: 'Test', timestamp: 6000 },
        { id: 'c', parentIds: ['d'], subject: 'C', author: 'Test', timestamp: 5000 },
        { id: 'b', parentIds: ['e'], subject: 'B', author: 'Test', timestamp: 4000 },
        { id: 'e', parentIds: ['f'], subject: 'E', author: 'Test', timestamp: 3000 },
        { id: 'f', parentIds: ['d'], subject: 'F', author: 'Test', timestamp: 2000 },
        { id: 'd', parentIds: ['g'], subject: 'D', author: 'Test', timestamp: 1000 },
        { id: 'g', parentIds: [], subject: 'G', author: 'Test', timestamp: 0 }
      ])
      const viewModels = toViewModel(snapshot)

      // Commit 'a' - top merge
      expect(viewModels[0].outputSwimlanes).toHaveLength(2)
      expect(viewModels[0].outputSwimlanes[0].id).toBe('b')
      expect(viewModels[0].outputSwimlanes[0].color).toBe(SWIMLANE_COLORS[0])
      expect(viewModels[0].outputSwimlanes[1].id).toBe('c')
      expect(viewModels[0].outputSwimlanes[1].color).toBe(SWIMLANE_COLORS[1])

      // Commit 'c' - on branch
      expect(viewModels[1].inputSwimlanes).toHaveLength(2)
      expect(viewModels[1].outputSwimlanes).toHaveLength(2)
      expect(viewModels[1].outputSwimlanes[0].id).toBe('b') // Main passes through
      expect(viewModels[1].outputSwimlanes[1].id).toBe('d') // Branch continues

      // Main branch continues while branch passes through
      expect(viewModels[2].inputSwimlanes[0].id).toBe('b')
      expect(viewModels[2].inputSwimlanes[1].id).toBe('d')

      // Eventually both merge at 'd'
      const dCommit = viewModels.find(vm => vm.historyItem.id === 'd')!
      expect(dCommit.inputSwimlanes).toHaveLength(2)
      expect(dCommit.inputSwimlanes[0].id).toBe('d')
      expect(dCommit.inputSwimlanes[1].id).toBe('d')
      expect(dCommit.outputSwimlanes).toHaveLength(1)
    })
  })

  describe('Branch Creation', () => {
    it('should create branch from merge commit', () => {
      const snapshot = createSnapshot([
        { id: 'a', parentIds: ['b', 'c'], subject: 'A', author: 'Test', timestamp: 7000 },
        { id: 'c', parentIds: ['b'], subject: 'C', author: 'Test', timestamp: 6000 },
        { id: 'b', parentIds: ['d', 'e'], subject: 'B', author: 'Test', timestamp: 5000 },
        { id: 'e', parentIds: ['f'], subject: 'E', author: 'Test', timestamp: 4000 },
        { id: 'f', parentIds: ['g'], subject: 'F', author: 'Test', timestamp: 3000 },
        { id: 'd', parentIds: ['h'], subject: 'D', author: 'Test', timestamp: 2000 },
        { id: 'g', parentIds: [], subject: 'G', author: 'Test', timestamp: 1000 },
        { id: 'h', parentIds: [], subject: 'H', author: 'Test', timestamp: 0 }
      ])
      const viewModels = toViewModel(snapshot)

      // Commit 'b' - merge commit that creates new branch
      const bCommit = viewModels.find(vm => vm.historyItem.id === 'b')!
      expect(bCommit.inputSwimlanes).toHaveLength(2)
      expect(bCommit.inputSwimlanes[0].id).toBe('b')
      expect(bCommit.inputSwimlanes[1].id).toBe('b')
      expect(bCommit.outputSwimlanes).toHaveLength(2)
      expect(bCommit.outputSwimlanes[0].id).toBe('d')
      expect(bCommit.outputSwimlanes[1].id).toBe('e')

      // New branch should get next available color (cycling past 0 and 1)
      expect(bCommit.outputSwimlanes[1].color).toBe(SWIMLANE_COLORS[2])
    })

    it('should handle multiple branches from a commit (three-way fork)', () => {
      const snapshot = createSnapshot([
        { id: 'a', parentIds: ['b', 'c'], subject: 'A', author: 'Test', timestamp: 7000 },
        { id: 'c', parentIds: ['d'], subject: 'C', author: 'Test', timestamp: 6000 },
        { id: 'b', parentIds: ['e', 'f'], subject: 'B', author: 'Test', timestamp: 5000 },
        { id: 'f', parentIds: ['g'], subject: 'F', author: 'Test', timestamp: 4000 },
        { id: 'e', parentIds: ['g'], subject: 'E', author: 'Test', timestamp: 3000 },
        { id: 'd', parentIds: ['g'], subject: 'D', author: 'Test', timestamp: 2000 },
        { id: 'g', parentIds: ['h'], subject: 'G', author: 'Test', timestamp: 1000 },
        { id: 'h', parentIds: [], subject: 'H', author: 'Test', timestamp: 0 }
      ])
      const viewModels = toViewModel(snapshot)

      // Commit 'b' - creates third branch
      const bCommit = viewModels.find(vm => vm.historyItem.id === 'b')!
      expect(bCommit.outputSwimlanes).toHaveLength(3)
      expect(bCommit.outputSwimlanes[0].id).toBe('e')
      expect(bCommit.outputSwimlanes[1].id).toBe('d') // Passes through
      expect(bCommit.outputSwimlanes[2].id).toBe('f') // Third branch
      expect(bCommit.outputSwimlanes[2].color).toBe(SWIMLANE_COLORS[2])

      // Commit 'g' - three-way merge
      const gCommit = viewModels.find(vm => vm.historyItem.id === 'g')!
      expect(gCommit.inputSwimlanes).toHaveLength(3)
      expect(gCommit.inputSwimlanes[0].id).toBe('g')
      expect(gCommit.inputSwimlanes[1].id).toBe('g')
      expect(gCommit.inputSwimlanes[2].id).toBe('g')
      expect(gCommit.outputSwimlanes).toHaveLength(1)
      expect(gCommit.outputSwimlanes[0].id).toBe('h')
    })
  })

  describe('Color Assignment with References', () => {
    it('should use custom colors from references', () => {
      const customRefColor = '#81b88b'
      const customRemoteRefColor = '#b180d7'
      const customBaseRefColor = '#ea5c00'

      const snapshot = createSnapshot([
        {
          id: 'a',
          parentIds: ['b'],
          subject: 'A',
          author: 'Test',
          timestamp: 5000,
          references: [{ id: 'topic', name: 'topic', color: customRefColor, icon: 'branch' }]
        },
        { id: 'b', parentIds: ['c'], subject: 'B', author: 'Test', timestamp: 4000 },
        {
          id: 'c',
          parentIds: ['d'],
          subject: 'C',
          author: 'Test',
          timestamp: 3000,
          references: [{ id: 'origin/topic', name: 'origin/topic', color: customRemoteRefColor, icon: 'remote' }]
        },
        { id: 'd', parentIds: ['e'], subject: 'D', author: 'Test', timestamp: 2000 },
        {
          id: 'e',
          parentIds: ['f', 'g'],
          subject: 'E',
          author: 'Test',
          timestamp: 1000
        },
        {
          id: 'g',
          parentIds: ['h'],
          subject: 'G',
          author: 'Test',
          timestamp: 500,
          references: [{ id: 'origin/main', name: 'origin/main', color: customBaseRefColor, icon: 'base' }]
        },
        { id: 'h', parentIds: [], subject: 'H', author: 'Test', timestamp: 0 }
      ])

      const viewModels = toViewModel(snapshot)

      // Commit 'a' - has 'topic' reference with custom color
      expect(viewModels[0].outputSwimlanes[0].color).toBe(customRefColor)

      // Commit 'b' - inherits color from parent
      expect(viewModels[1].outputSwimlanes[0].color).toBe(customRefColor)

      // Commit 'c' - has 'origin/topic' reference, color changes
      expect(viewModels[2].outputSwimlanes[0].color).toBe(customRemoteRefColor)

      // Commit 'e' - creates branch to 'g' which has origin/main
      const eCommit = viewModels.find(vm => vm.historyItem.id === 'e')!
      expect(eCommit.outputSwimlanes[1].color).toBe(customBaseRefColor)
    })
  })

  describe('isCurrent Flag', () => {
    it('should mark current commit correctly', () => {
      const snapshot: HistoryProviderSnapshot = {
        items: [
          { id: 'a', parentIds: ['b'], subject: 'A', author: 'Test', timestamp: 2000 },
          { id: 'b', parentIds: ['c'], subject: 'B', author: 'Test', timestamp: 1000 },
          { id: 'c', parentIds: [], subject: 'C', author: 'Test', timestamp: 0 }
        ],
        currentRef: { id: 'HEAD', name: 'HEAD', revision: 'b' },
        currentRemoteRef: undefined,
        currentBaseRef: undefined
      }

      const viewModels = toViewModel(snapshot)

      expect(viewModels[0].isCurrent).toBe(false) // 'a'
      expect(viewModels[1].isCurrent).toBe(true)  // 'b' - matches currentRef.revision
      expect(viewModels[2].isCurrent).toBe(false) // 'c'
    })
  })

  describe('Reference Sorting', () => {
    it('should sort references with current, remote, base, then others', () => {
      const snapshot: HistoryProviderSnapshot = {
        items: [
          {
            id: 'a',
            parentIds: [],
            subject: 'A',
            author: 'Test',
            timestamp: 0,
            references: [
              { id: 'feature', name: 'feature', icon: 'branch' },
              { id: 'origin/main', name: 'origin/main', icon: 'base' },
              { id: 'origin/feature', name: 'origin/feature', icon: 'remote' },
              { id: 'main', name: 'main', icon: 'branch' }
            ]
          }
        ],
        currentRef: { id: 'main', name: 'main', revision: 'a' },
        currentRemoteRef: { id: 'origin/feature', name: 'origin/feature', revision: 'a' },
        currentBaseRef: { id: 'origin/main', name: 'origin/main', revision: 'a' }
      }

      const viewModels = toViewModel(snapshot)
      const refs = viewModels[0].historyItem.references!

      expect(refs[0].id).toBe('main')           // Current
      expect(refs[1].id).toBe('origin/feature') // Remote
      expect(refs[2].id).toBe('origin/main')    // Base
      expect(refs[3].id).toBe('feature')        // Other
    })
  })
})
