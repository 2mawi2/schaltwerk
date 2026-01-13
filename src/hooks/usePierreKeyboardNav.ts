import { useEffect, useState, useCallback, type RefObject } from 'react'

export interface KeyboardNavState {
  focusedLine: number
  side: 'old' | 'new'
}

export interface UsePierreKeyboardNavOptions {
  containerRef: RefObject<HTMLDivElement | null>
  totalLines: number
  enabled?: boolean
  onLineSelect?: (lineNumber: number, side: 'old' | 'new') => void
  onEnter?: (lineNumber: number, side: 'old' | 'new') => void
  initialLine?: number
  initialSide?: 'old' | 'new'
}

export interface UsePierreKeyboardNavResult {
  focusedLine: number
  focusedSide: 'old' | 'new'
  setFocusedLine: (line: number) => void
  setFocusedSide: (side: 'old' | 'new') => void
  isKeyboardActive: boolean
}

export function usePierreKeyboardNav({
  containerRef,
  totalLines,
  enabled = true,
  onLineSelect,
  onEnter,
  initialLine = 1,
  initialSide = 'new',
}: UsePierreKeyboardNavOptions): UsePierreKeyboardNavResult {
  const [focusedLine, setFocusedLine] = useState(initialLine)
  const [focusedSide, setFocusedSide] = useState<'old' | 'new'>(initialSide)
  const [isKeyboardActive, setIsKeyboardActive] = useState(false)

  const scrollLineIntoView = useCallback(
    (line: number) => {
      const container = containerRef.current
      if (!container) return

      const lineHeight = 20
      const containerHeight = container.clientHeight
      const targetY = (line - 1) * lineHeight
      const currentScrollTop = container.scrollTop

      const viewportTop = currentScrollTop
      const viewportBottom = currentScrollTop + containerHeight

      if (targetY < viewportTop + 50) {
        container.scrollTo({ top: Math.max(0, targetY - 100), behavior: 'smooth' })
      } else if (targetY > viewportBottom - 50) {
        container.scrollTo({ top: targetY - containerHeight + 100, behavior: 'smooth' })
      }
    },
    [containerRef]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return

      const container = containerRef.current
      if (!container) return

      const activeElement = document.activeElement
      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.getAttribute('contenteditable') === 'true'

      if (isInputFocused) return

      const isContainerFocused =
        container.contains(activeElement) || document.activeElement === document.body

      if (!isContainerFocused) return

      let handled = false

      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          e.preventDefault()
          setFocusedLine((prev) => {
            const next = Math.min(prev + 1, totalLines)
            scrollLineIntoView(next)
            return next
          })
          setIsKeyboardActive(true)
          handled = true
          break

        case 'ArrowUp':
        case 'k':
          e.preventDefault()
          setFocusedLine((prev) => {
            const next = Math.max(prev - 1, 1)
            scrollLineIntoView(next)
            return next
          })
          setIsKeyboardActive(true)
          handled = true
          break

        case 'ArrowLeft':
        case 'h':
          e.preventDefault()
          setFocusedSide('old')
          setIsKeyboardActive(true)
          handled = true
          break

        case 'ArrowRight':
        case 'l':
          e.preventDefault()
          setFocusedSide('new')
          setIsKeyboardActive(true)
          handled = true
          break

        case 'Enter':
        case ' ':
          e.preventDefault()
          onEnter?.(focusedLine, focusedSide)
          handled = true
          break

        case 'g':
          if (e.shiftKey) {
            e.preventDefault()
            setFocusedLine(totalLines)
            scrollLineIntoView(totalLines)
            setIsKeyboardActive(true)
            handled = true
          } else {
            e.preventDefault()
            setFocusedLine(1)
            scrollLineIntoView(1)
            setIsKeyboardActive(true)
            handled = true
          }
          break

        case 'Home':
          e.preventDefault()
          setFocusedLine(1)
          scrollLineIntoView(1)
          setIsKeyboardActive(true)
          handled = true
          break

        case 'End':
          e.preventDefault()
          setFocusedLine(totalLines)
          scrollLineIntoView(totalLines)
          setIsKeyboardActive(true)
          handled = true
          break

        case 'PageDown':
          e.preventDefault()
          setFocusedLine((prev) => {
            const next = Math.min(prev + 20, totalLines)
            scrollLineIntoView(next)
            return next
          })
          setIsKeyboardActive(true)
          handled = true
          break

        case 'PageUp':
          e.preventDefault()
          setFocusedLine((prev) => {
            const next = Math.max(prev - 20, 1)
            scrollLineIntoView(next)
            return next
          })
          setIsKeyboardActive(true)
          handled = true
          break

        case 'Escape':
          setIsKeyboardActive(false)
          handled = true
          break
      }

      if (handled) {
        onLineSelect?.(focusedLine, focusedSide)
      }
    },
    [
      enabled,
      containerRef,
      totalLines,
      focusedLine,
      focusedSide,
      onLineSelect,
      onEnter,
      scrollLineIntoView,
    ]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    const handleClick = () => {
      setIsKeyboardActive(false)
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  return {
    focusedLine,
    focusedSide,
    setFocusedLine,
    setFocusedSide,
    isKeyboardActive,
  }
}
