import { getCurrentWindow } from '@tauri-apps/api/window'
import { VscChromeMinimize, VscChromeMaximize, VscChromeClose } from 'react-icons/vsc'
import { useState, useEffect } from 'react'
import { logger } from '../utils/logger'

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const checkMaximized = async () => {
      const window = getCurrentWindow()
      const maximized = await window.isMaximized()
      setIsMaximized(maximized)
    }

    void checkMaximized()

    let unlistenPromise: Promise<() => void> | null = null
    try {
      unlistenPromise = getCurrentWindow().onResized(() => {
        void checkMaximized()
      })
    } catch (error) {
      logger.debug('[WindowControls] Failed to listen for resize events', error)
    }

    return () => {
      if (!unlistenPromise) return
      unlistenPromise
        .then(fn => {
          try {
            const result = fn()
            void Promise.resolve(result).catch(error => {
              logger.debug('[WindowControls] Failed to remove resize listener (async):', error)
            })
          } catch (error) {
            logger.debug('[WindowControls] Failed to remove resize listener:', error)
          }
        })
        .catch(error => {
          logger.debug('[WindowControls] Failed to resolve resize listener unsubscriber:', error)
        })
    }
  }, [])

  const handleMinimize = async () => {
    await getCurrentWindow().minimize()
  }

  const handleMaximize = async () => {
    const window = getCurrentWindow()
    if (isMaximized) {
      await window.unmaximize()
    } else {
      await window.maximize()
    }
    setIsMaximized(!isMaximized)
  }

  const handleClose = async () => {
    await getCurrentWindow().close()
  }

  return (
    <div className="flex items-center gap-0.5 mr-2" data-testid="window-controls">
      <button
        onClick={() => { void handleMinimize() }}
        className="h-6 w-8 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/50 transition-colors"
        title="Minimize"
        aria-label="Minimize window"
        data-testid="window-minimize"
      >
        <VscChromeMinimize className="text-[14px]" />
      </button>
      <button
        onClick={() => { void handleMaximize() }}
        className="h-6 w-8 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/50 transition-colors"
        title={isMaximized ? "Restore" : "Maximize"}
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        data-testid="window-maximize"
      >
        <VscChromeMaximize className="text-[14px]" />
      </button>
      <button
        onClick={() => { void handleClose() }}
        className="h-6 w-8 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-accent-red transition-colors"
        title="Close"
        aria-label="Close window"
        data-testid="window-close"
      >
        <VscChromeClose className="text-[14px]" />
      </button>
    </div>
  )
}
