import { useCallback, useMemo, useRef, useState } from 'react'

export interface DragState {
  isDragging: boolean
  draggedIndex: number | null
  dropTargetIndex: number | null
}

export type TabDragType = 'project' | 'agent' | 'terminal'

export interface UseTabDragDropOptions<T> {
  items: T[]
  onReorder: (fromIndex: number, toIndex: number) => void
  type: TabDragType
  getItemId?: (item: T, index: number) => string | number
  disabled?: boolean
}

export interface TabDragHandlers {
  draggable: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragEnter: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export interface UseTabDragDropResult {
  dragState: DragState
  getDragHandlers: (index: number) => TabDragHandlers
  getContainerHandlers: () => {
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

type DragPayload = { id: string }

function buildDragType(type: TabDragType): string {
  return `application/x-schaltwerk-tab-${type}`
}

function safeParsePayload(raw: string): DragPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const value = (parsed as { id?: unknown }).id
    if (typeof value !== 'string' || !value) return null
    return { id: value }
  } catch {
    return null
  }
}

function resolveItemId<T>(
  items: T[],
  index: number,
  getItemId: ((item: T, index: number) => string | number) | undefined,
): string {
  const item = items[index]
  if (item === undefined) return String(index)
  if (!getItemId) return String(index)
  return String(getItemId(item, index))
}

function resolveIndexFromPayload<T>(
  items: T[],
  payload: DragPayload | null,
  getItemId: ((item: T, index: number) => string | number) | undefined,
): number | null {
  if (!payload) return null
  const targetId = payload.id
  for (let i = 0; i < items.length; i += 1) {
    if (resolveItemId(items, i, getItemId) === targetId) {
      return i
    }
  }
  return null
}

function isDragForType(event: React.DragEvent, dragType: string): boolean {
  const types = Array.from(event.dataTransfer.types ?? [])
  return types.includes(dragType)
}

export function useTabDragDrop<T>({
  items,
  onReorder,
  type,
  getItemId,
  disabled = false,
}: UseTabDragDropOptions<T>): UseTabDragDropResult {
  const dragType = useMemo(() => buildDragType(type), [type])
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    draggedIndex: null,
    dropTargetIndex: null,
  })

  const draggedPayloadRef = useRef<DragPayload | null>(null)

  const clearDragState = useCallback(() => {
    draggedPayloadRef.current = null
    setDragState({ isDragging: false, draggedIndex: null, dropTargetIndex: null })
  }, [])

  const handleDragStart = useCallback(
    (index: number) => (e: React.DragEvent) => {
      if (disabled) {
        e.preventDefault()
        return
      }

      const payload: DragPayload = {
        id: resolveItemId(items, index, getItemId),
      }

      draggedPayloadRef.current = payload
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(dragType, JSON.stringify(payload))

      setDragState({ isDragging: true, draggedIndex: index, dropTargetIndex: null })
    },
    [disabled, dragType, getItemId, items],
  )

  const handleDragEnd = useCallback(
    (_index: number) => (_e: React.DragEvent) => {
      clearDragState()
    },
    [clearDragState],
  )

  const handleDragOver = useCallback(
    (index: number) => (e: React.DragEvent) => {
      if (disabled || !isDragForType(e, dragType)) {
        return
      }

      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      const payload = draggedPayloadRef.current
      const fromIndex = resolveIndexFromPayload(items, payload, getItemId)

      if (fromIndex === null || fromIndex === index) {
        setDragState(prev => ({ ...prev, dropTargetIndex: null }))
        return
      }

      setDragState(prev => ({ ...prev, dropTargetIndex: index }))
    },
    [disabled, dragType, getItemId, items],
  )

  const handleDragEnter = useCallback(
    (index: number) => (e: React.DragEvent) => {
      if (disabled || !isDragForType(e, dragType)) {
        return
      }

      e.preventDefault()

      const payload = draggedPayloadRef.current
      const fromIndex = resolveIndexFromPayload(items, payload, getItemId)
      if (fromIndex === null || fromIndex === index) {
        return
      }

      setDragState(prev => ({ ...prev, dropTargetIndex: index }))
    },
    [disabled, dragType, getItemId, items],
  )

  const handleDragLeave = useCallback(
    (_index: number) => (e: React.DragEvent) => {
      const relatedTarget = e.relatedTarget as Node | null
      const currentTarget = e.currentTarget as Node

      if (relatedTarget && currentTarget.contains(relatedTarget)) {
        return
      }

      setDragState(prev => ({ ...prev, dropTargetIndex: null }))
    },
    [],
  )

  const handleDrop = useCallback(
    (toIndex: number) => (e: React.DragEvent) => {
      if (disabled || !isDragForType(e, dragType)) {
        return
      }

      e.preventDefault()

      const raw = e.dataTransfer.getData(dragType)
      const parsed = safeParsePayload(raw)
      const fromIndex = resolveIndexFromPayload(items, parsed, getItemId)

      if (
        fromIndex === null ||
        fromIndex < 0 ||
        fromIndex >= items.length ||
        toIndex < 0 ||
        toIndex >= items.length ||
        fromIndex === toIndex
      ) {
        clearDragState()
        return
      }

      onReorder(fromIndex, toIndex)
      clearDragState()
    },
    [clearDragState, disabled, dragType, getItemId, items, onReorder],
  )

  const handleContainerDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !isDragForType(e, dragType)) {
        return
      }
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    [disabled, dragType],
  )

  const handleContainerDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as Node | null
    const currentTarget = e.currentTarget as Node

    if (relatedTarget && currentTarget.contains(relatedTarget)) {
      return
    }

    setDragState(prev => ({ ...prev, dropTargetIndex: null }))
  }, [])

  const handleContainerDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !isDragForType(e, dragType)) {
        return
      }

      e.preventDefault()
      clearDragState()
    },
    [clearDragState, disabled, dragType],
  )

  const getDragHandlers = useCallback(
    (index: number): TabDragHandlers => ({
      draggable: !disabled,
      onDragStart: handleDragStart(index),
      onDragEnd: handleDragEnd(index),
      onDragOver: handleDragOver(index),
      onDragEnter: handleDragEnter(index),
      onDragLeave: handleDragLeave(index),
      onDrop: handleDrop(index),
    }),
    [disabled, handleDragStart, handleDragEnd, handleDragOver, handleDragEnter, handleDragLeave, handleDrop],
  )

  const getContainerHandlers = useCallback(
    () => ({
      onDragOver: handleContainerDragOver,
      onDragLeave: handleContainerDragLeave,
      onDrop: handleContainerDrop,
    }),
    [handleContainerDragOver, handleContainerDragLeave, handleContainerDrop],
  )

  return {
    dragState,
    getDragHandlers,
    getContainerHandlers,
  }
}

