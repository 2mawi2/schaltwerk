export interface ProjectTab {
  projectPath: string
  projectName: string
}

export function determineNextActiveTab(tabs: ProjectTab[], closingPath: string): ProjectTab | null {
  const closingIndex = tabs.findIndex(tab => tab.projectPath === closingPath)
  if (closingIndex === -1) return null
  if (tabs.length <= 1) return null

  const hasRightNeighbor = closingIndex + 1 < tabs.length
  if (hasRightNeighbor) {
    return tabs[closingIndex + 1]
  }

  const hasLeftNeighbor = closingIndex - 1 >= 0
  if (hasLeftNeighbor) {
    return tabs[closingIndex - 1]
  }

  return null
}
