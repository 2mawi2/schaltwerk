export interface HistoryItemRef {
  id: string
  name: string
  revision?: string
  color?: string
  icon?: 'branch' | 'remote' | 'tag' | 'base'
}

export interface HistoryItem {
  id: string
  parentIds: string[]
  subject: string
  author: string
  timestamp: number
  references?: HistoryItemRef[]
  summary?: string
}

export interface HistoryGraphNode {
  id: string
  color: string
}

export interface HistoryItemViewModel {
  historyItem: HistoryItem
  isCurrent: boolean
  inputSwimlanes: HistoryGraphNode[]
  outputSwimlanes: HistoryGraphNode[]
}

export interface HistoryProviderSnapshot {
  items: HistoryItem[]
  currentRef?: HistoryItemRef
  currentRemoteRef?: HistoryItemRef
  currentBaseRef?: HistoryItemRef
}
