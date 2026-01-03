export function reorderArray<T>(array: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return array

  const result = array.slice()
  const [removed] = result.splice(fromIndex, 1)

  if (removed === undefined) {
    return array
  }

  result.splice(toIndex, 0, removed)
  return result
}

