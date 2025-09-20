import { describe, it, expect } from 'vitest'
import { determineNextActiveTab, ProjectTab } from '../common/projectTabs'

describe('determineNextActiveTab', () => {
  const tabs: ProjectTab[] = [
    { projectPath: '/projects/alpha', projectName: 'alpha' },
    { projectPath: '/projects/bravo', projectName: 'bravo' },
    { projectPath: '/projects/charlie', projectName: 'charlie' }
  ]

  it('returns the tab to the right when closing the first tab', () => {
    const result = determineNextActiveTab(tabs, '/projects/alpha')
    expect(result?.projectPath).toBe('/projects/bravo')
  })

  it('returns the tab to the right when closing a middle tab', () => {
    const result = determineNextActiveTab(tabs, '/projects/bravo')
    expect(result?.projectPath).toBe('/projects/charlie')
  })

  it('falls back to the previous tab when closing the last tab', () => {
    const result = determineNextActiveTab(tabs, '/projects/charlie')
    expect(result?.projectPath).toBe('/projects/bravo')
  })

  it('returns null when closing the only tab', () => {
    const singleTab: ProjectTab[] = [{ projectPath: '/projects/solo', projectName: 'solo' }]
    const result = determineNextActiveTab(singleTab, '/projects/solo')
    expect(result).toBeNull()
  })

  it('returns null when closing path is not found', () => {
    const result = determineNextActiveTab(tabs, '/projects/does-not-exist')
    expect(result).toBeNull()
  })
})
