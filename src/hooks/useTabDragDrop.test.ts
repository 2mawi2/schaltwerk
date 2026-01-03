import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTabDragDrop } from './useTabDragDrop'
import { reorderArray } from '../common/reorderArray'

describe('reorderArray', () => {
  it('moves item forward in array', () => {
    const array = ['a', 'b', 'c', 'd']
    const result = reorderArray(array, 0, 2)
    expect(result).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves item backward in array', () => {
    const array = ['a', 'b', 'c', 'd']
    const result = reorderArray(array, 3, 1)
    expect(result).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns same array when from equals to', () => {
    const array = ['a', 'b', 'c']
    const result = reorderArray(array, 1, 1)
    expect(result).toBe(array)
  })

  it('does not mutate original array', () => {
    const array = ['a', 'b', 'c']
    reorderArray(array, 0, 2)
    expect(array).toEqual(['a', 'b', 'c'])
  })
})

describe('useTabDragDrop', () => {
  const createItems = () => [
    { id: 'tab-1', label: 'Tab 1' },
    { id: 'tab-2', label: 'Tab 2' },
    { id: 'tab-3', label: 'Tab 3' },
  ]

  const createDataTransfer = (type: string) => {
    const data: Record<string, string> = {}
    return {
      effectAllowed: 'uninitialized' as DataTransfer['effectAllowed'],
      dropEffect: 'none' as DataTransfer['dropEffect'],
      types: [type],
      setData: vi.fn((key: string, value: string) => {
        data[key] = value
      }),
      getData: vi.fn((key: string) => data[key] ?? ''),
    } as unknown as DataTransfer
  }

  const createMockDragEvent = (dataTransfer: DataTransfer, overrides: Partial<React.DragEvent> = {}): React.DragEvent =>
    ({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer,
      currentTarget: document.createElement('div'),
      relatedTarget: null,
      ...overrides,
    }) as unknown as React.DragEvent

  it('initializes with no dragging state', () => {
    const { result } = renderHook(() =>
      useTabDragDrop({
        items: createItems(),
        onReorder: vi.fn(),
        type: 'terminal',
        getItemId: item => item.id,
      }),
    )

    expect(result.current.dragState).toEqual({
      isDragging: false,
      draggedIndex: null,
      dropTargetIndex: null,
    })
  })

  it('sets dragging state on drag start', () => {
    const { result } = renderHook(() =>
      useTabDragDrop({
        items: createItems(),
        onReorder: vi.fn(),
        type: 'terminal',
        getItemId: item => item.id,
      }),
    )

    const handlers = result.current.getDragHandlers(1)
    const dataTransfer = createDataTransfer('application/x-schaltwerk-tab-terminal')
    const event = createMockDragEvent(dataTransfer)

    act(() => {
      handlers.onDragStart(event)
    })

    expect(result.current.dragState).toEqual({
      isDragging: true,
      draggedIndex: 1,
      dropTargetIndex: null,
    })
    expect(event.dataTransfer.effectAllowed).toBe('move')
    expect(vi.mocked(dataTransfer.setData)).toHaveBeenCalled()
  })

  it('clears dragging state on drag end', () => {
    const { result } = renderHook(() =>
      useTabDragDrop({
        items: createItems(),
        onReorder: vi.fn(),
        type: 'terminal',
        getItemId: item => item.id,
      }),
    )

    const handlers = result.current.getDragHandlers(1)
    const dataTransfer = createDataTransfer('application/x-schaltwerk-tab-terminal')

    act(() => {
      handlers.onDragStart(createMockDragEvent(dataTransfer))
    })

    act(() => {
      handlers.onDragEnd(createMockDragEvent(dataTransfer))
    })

    expect(result.current.dragState).toEqual({
      isDragging: false,
      draggedIndex: null,
      dropTargetIndex: null,
    })
  })

  it('calls onReorder when dropping on different tab', () => {
    const onReorder = vi.fn()
    const { result } = renderHook(() =>
      useTabDragDrop({
        items: createItems(),
        onReorder,
        type: 'terminal',
        getItemId: item => item.id,
      }),
    )

    const dataTransfer = createDataTransfer('application/x-schaltwerk-tab-terminal')
    const sourceHandlers = result.current.getDragHandlers(0)
    act(() => {
      sourceHandlers.onDragStart(createMockDragEvent(dataTransfer))
    })

    const targetHandlers = result.current.getDragHandlers(2)
    act(() => {
      targetHandlers.onDrop(createMockDragEvent(dataTransfer))
    })

    expect(onReorder).toHaveBeenCalledWith(0, 2)
    expect(result.current.dragState.isDragging).toBe(false)
  })

  it('does not call onReorder when dropping on same tab', () => {
    const onReorder = vi.fn()
    const { result } = renderHook(() =>
      useTabDragDrop({
        items: createItems(),
        onReorder,
        type: 'terminal',
        getItemId: item => item.id,
      }),
    )

    const dataTransfer = createDataTransfer('application/x-schaltwerk-tab-terminal')
    const handlers = result.current.getDragHandlers(1)

    act(() => {
      handlers.onDragStart(createMockDragEvent(dataTransfer))
    })

    act(() => {
      handlers.onDrop(createMockDragEvent(dataTransfer))
    })

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('sets dropTargetIndex on drag enter', () => {
    const { result } = renderHook(() =>
      useTabDragDrop({
        items: createItems(),
        onReorder: vi.fn(),
        type: 'terminal',
        getItemId: item => item.id,
      }),
    )

    const dataTransfer = createDataTransfer('application/x-schaltwerk-tab-terminal')
    act(() => {
      result.current.getDragHandlers(0).onDragStart(createMockDragEvent(dataTransfer))
    })

    act(() => {
      result.current.getDragHandlers(2).onDragEnter(createMockDragEvent(dataTransfer))
    })

    expect(result.current.dragState.dropTargetIndex).toBe(2)
  })

  it('prevents default on drag over for valid drag', () => {
    const { result } = renderHook(() =>
      useTabDragDrop({
        items: createItems(),
        onReorder: vi.fn(),
        type: 'terminal',
        getItemId: item => item.id,
      }),
    )

    const dataTransfer = createDataTransfer('application/x-schaltwerk-tab-terminal')
    act(() => {
      result.current.getDragHandlers(0).onDragStart(createMockDragEvent(dataTransfer))
    })

    const event = createMockDragEvent(dataTransfer)
    act(() => {
      result.current.getDragHandlers(1).onDragOver(event)
    })

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.dataTransfer.dropEffect).toBe('move')
  })

  it('does not allow drag when disabled', () => {
    const { result } = renderHook(() =>
      useTabDragDrop({
        items: createItems(),
        onReorder: vi.fn(),
        type: 'terminal',
        getItemId: item => item.id,
        disabled: true,
      }),
    )

    const handlers = result.current.getDragHandlers(0)
    expect(handlers.draggable).toBe(false)

    const dataTransfer = createDataTransfer('application/x-schaltwerk-tab-terminal')
    const event = createMockDragEvent(dataTransfer)
    act(() => {
      handlers.onDragStart(event)
    })

    expect(event.preventDefault).toHaveBeenCalled()
    expect(result.current.dragState.isDragging).toBe(false)
  })

  it('rejects drag events from different tab types', () => {
    const { result } = renderHook(() =>
      useTabDragDrop({
        items: createItems(),
        onReorder: vi.fn(),
        type: 'terminal',
        getItemId: item => item.id,
      }),
    )

    const wrongTransfer = createDataTransfer('application/x-schaltwerk-tab-project')
    const event = createMockDragEvent(wrongTransfer)

    act(() => {
      result.current.getDragHandlers(0).onDragOver(event)
    })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(result.current.dragState.dropTargetIndex).toBeNull()
  })

  it('provides container handlers', () => {
    const { result } = renderHook(() =>
      useTabDragDrop({
        items: createItems(),
        onReorder: vi.fn(),
        type: 'terminal',
        getItemId: item => item.id,
      }),
    )

    const containerHandlers = result.current.getContainerHandlers()
    expect(containerHandlers).toHaveProperty('onDragOver')
    expect(containerHandlers).toHaveProperty('onDragLeave')
    expect(containerHandlers).toHaveProperty('onDrop')
  })
})

