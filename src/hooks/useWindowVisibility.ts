import { useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { logger } from '../utils/logger'

export interface WindowVisibilityState {
  isForeground: boolean
  isVisible: boolean
  lastFocusLostAt: number | null
}

const getInitialVisibility = (): WindowVisibilityState => {
  if (typeof document === 'undefined') {
    return {
      isForeground: true,
      isVisible: true,
      lastFocusLostAt: null,
    }
  }

  const isVisible = document.visibilityState !== 'hidden'
  const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true

  return {
    isForeground: isVisible && hasFocus,
    isVisible,
    lastFocusLostAt: null,
  }
}

export function useWindowVisibility(): WindowVisibilityState {
  const [state, setState] = useState<WindowVisibilityState>(() => getInitialVisibility())
  const lastFocusState = useRef<boolean>(state.isForeground)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    let mounted = true
    const unlistenFns: UnlistenFn[] = []

    const updateState = (updater: (prev: WindowVisibilityState) => WindowVisibilityState) => {
      if (!mounted) return
      setState(updater)
    }

    const handleFocus = () => {
      lastFocusState.current = true
      updateState(prev => ({
        ...prev,
        isForeground: true,
        isVisible: true,
      }))
    }

    const handleBlur = () => {
      const now = Date.now()
      lastFocusState.current = false
      updateState(prev => ({
        ...prev,
        isForeground: false,
        lastFocusLostAt: now,
      }))
    }

    const handleVisibilityChange = () => {
      const visible = document.visibilityState !== 'hidden'
      updateState(prev => {
        const nextForeground = visible && lastFocusState.current && document.hasFocus()
        return {
          isForeground: nextForeground,
          isVisible: visible,
          lastFocusLostAt: visible ? prev.lastFocusLostAt : Date.now(),
        }
      })
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    ;(async () => {
      try {
        const currentWindow = await getCurrentWindow()
        const focusEvents = ['tauri://focus', 'tauri://active', 'tauri://resumed']
        const blurEvents = ['tauri://blur', 'tauri://inactive']
        const visibilityEvents = ['tauri://visible-change', 'tauri://visibility-change']

        const register = async (eventNames: string[], handler: (payload: unknown) => void) => {
          for (const name of eventNames) {
            try {
              const unlisten = await currentWindow.listen(name, handler)
              unlistenFns.push(unlisten)
              return
            } catch (error) {
              logger.debug(`[useWindowVisibility] Failed to listen for ${name}:`, error)
            }
          }
        }

        await register(focusEvents, handleFocus)
        await register(blurEvents, handleBlur)
        await register(visibilityEvents, handleVisibilityChange)
      } catch (error) {
        logger.debug('[useWindowVisibility] Failed to attach Tauri window listeners:', error)
      }
    })()

    return () => {
      mounted = false
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      unlistenFns.forEach(unlisten => {
        try {
          const result = unlisten()
          void Promise.resolve(result).catch(error => {
            logger.debug('[useWindowVisibility] Failed to remove listener (async):', error)
          })
        } catch (error) {
          logger.debug('[useWindowVisibility] Failed to remove listener:', error)
        }
      })
    }
  }, [])

  return useMemo(() => state, [state])
}
