import type { HistoryGraphNode, HistoryItem, HistoryItemRef, HistoryItemViewModel, HistoryProviderSnapshot } from './types'

const SWIMLANE_COLORS = [
  '#FFB000',
  '#DC267F',
  '#994F00',
  '#40B0A6',
  '#B66DFF',
]

const DEFAULT_REF_COLOR = '#81b88b'
const DEFAULT_REMOTE_REF_COLOR = '#b180d7'
const DEFAULT_BASE_REF_COLOR = '#ea5c00'
const DEFAULT_TAG_REF_COLOR = '#e5c07b'

function getDefaultColorForIcon(icon: string | undefined): string {
  switch (icon) {
    case 'remote':
      return DEFAULT_REMOTE_REF_COLOR
    case 'base':
      return DEFAULT_BASE_REF_COLOR
    case 'branch':
      return DEFAULT_REF_COLOR
    case 'tag':
      return DEFAULT_TAG_REF_COLOR
    default:
      return DEFAULT_REF_COLOR
  }
}

function rotateColor(index: number): string {
  return SWIMLANE_COLORS[index % SWIMLANE_COLORS.length]
}

function selectLabelColor(historyItem: HistoryItem, colorMap: Map<string, string | undefined>): string | undefined {
  for (const ref of historyItem.references ?? []) {
    if (ref.color) {
      return ref.color
    }
    const color = colorMap.get(ref.id)
    if (color !== undefined) {
      return color
    }
  }

  return undefined
}

function findLastIndex(nodes: HistoryGraphNode[], id: string): number {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].id === id) {
      return i
    }
  }

  return -1
}

function compareRefs(
  ref1: HistoryItemRef,
  ref2: HistoryItemRef,
  current?: HistoryItemRef,
  remote?: HistoryItemRef,
  base?: HistoryItemRef
): number {
  const order = (ref: HistoryItemRef): number => {
    if (current && ref.id === current.id) {
      return 1
    }

    if (remote && ref.id === remote.id) {
      return 2
    }

    if (base && ref.id === base.id) {
      return 3
    }

    if (ref.color) {
      return 4
    }

    return 99
  }

  return order(ref1) - order(ref2)
}

export function toViewModel(snapshot: HistoryProviderSnapshot): HistoryItemViewModel[] {
  const { items, currentRef, currentRemoteRef, currentBaseRef } = snapshot
  const colorMap = new Map<string, string | undefined>()
  const itemLookup = new Map<string, HistoryItem>()
  let colorIndex = 0
  const viewModels: HistoryItemViewModel[] = []

  for (const item of items) {
    itemLookup.set(item.id, item)
  }

  for (let index = 0; index < items.length; index++) {
    const historyItem = items[index]
    const isCurrent = historyItem.id === currentRef?.revision
    const prevOutput = viewModels.at(-1)?.outputSwimlanes ?? []
    const inputSwimlanes = prevOutput.map(node => ({ ...node }))
    const outputSwimlanes: HistoryGraphNode[] = []

    let firstParentAssigned = false
    const labelColor = selectLabelColor(historyItem, colorMap)

    if (historyItem.parentIds.length > 0) {
      for (const node of inputSwimlanes) {
        if (node.id === historyItem.id) {
          if (!firstParentAssigned) {
            outputSwimlanes.push({
              id: historyItem.parentIds[0],
              color: labelColor ?? node.color
            })
            firstParentAssigned = true
          }

          continue
        }

        outputSwimlanes.push({ ...node })
      }
    }

    for (let parentIndex = firstParentAssigned ? 1 : 0; parentIndex < historyItem.parentIds.length; parentIndex++) {
      let color = labelColor

      if (parentIndex > 0) {
        const parent = itemLookup.get(historyItem.parentIds[parentIndex])
        color = parent ? selectLabelColor(parent, colorMap) : color
      }

      if (!color) {
        color = rotateColor(colorIndex++)
      }

      outputSwimlanes.push({
        id: historyItem.parentIds[parentIndex],
        color
      })
    }

    const inputIndex = inputSwimlanes.findIndex(node => node.id === historyItem.id)
    const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length

    const circleColor =
      circleIndex < outputSwimlanes.length
        ? outputSwimlanes[circleIndex].color
        : circleIndex < inputSwimlanes.length
        ? inputSwimlanes[circleIndex].color
        : undefined

    const references = (historyItem.references ?? []).map(ref => {
      let color = ref.color ?? circleColor ?? colorMap.get(ref.id)

      if (!color) {
        color = getDefaultColorForIcon(ref.icon)
      }

      const enriched = { ...ref, color }
      colorMap.set(ref.id, color)
      return enriched
    })

    references.sort((a, b) => compareRefs(a, b, currentRef, currentRemoteRef, currentBaseRef))

    viewModels.push({
      historyItem: { ...historyItem, references },
      isCurrent,
      inputSwimlanes,
      outputSwimlanes
    })
  }

  return viewModels
}

export function findGraphWidth(nodes: HistoryGraphNode[]): number {
  return nodes.length + 1
}

export function graphPlaceholder(columns: HistoryGraphNode[], highlight?: number): HistoryGraphNode[] {
  const col = [...columns]
  if (highlight !== undefined && highlight >= 0 && highlight < col.length) {
    col[highlight] = { ...col[highlight] }
  }
  return col
}

export function findSwimlaneIndex(viewModel: HistoryItemViewModel): number {
  const { historyItem, inputSwimlanes } = viewModel
  const index = inputSwimlanes.findIndex(node => node.id === historyItem.id)
  return index !== -1 ? index : inputSwimlanes.length
}

export function findExtraParents(viewModel: HistoryItemViewModel): HistoryGraphNode[] {
  const { historyItem, outputSwimlanes } = viewModel
  const extras: HistoryGraphNode[] = []

  for (let i = 1; i < historyItem.parentIds.length; i++) {
    const parentId = historyItem.parentIds[i]
    const idx = findLastIndex(outputSwimlanes, parentId)
    if (idx !== -1) {
      extras.push(outputSwimlanes[idx])
    }
  }

  return extras
}
