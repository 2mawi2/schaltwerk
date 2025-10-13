import { getCurrentWindow } from '@tauri-apps/api/window'
import { VscChromeMinimize, VscChromeMaximize, VscChromeClose } from 'react-icons/vsc'
import { useState, useEffect } from 'react'

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const checkMaximized = async () => {
      const window = getCurrentWindow()
      const maximized = await window.isMaximized()
      setIsMaximized(maximized)
    }

    checkMaximized()

    // Listen for window resize events
    const unlisten = getCurrentWindow().onResized(() => {
      checkMaximized()
    })

    return () => {
      unlisten.then(fn => fn())
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
        onClick={handleMinimize}
        className="h-6 w-8 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/50 transition-colors"
        title="Minimize"
        aria-label="Minimize window"
        data-testid="window-minimize"
      >
        <VscChromeMinimize className="text-[14px]" />
      </button>
      <button
        onClick={handleMaximize}
        className="h-6 w-8 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/50 transition-colors"
        title={isMaximized ? "Restore" : "Maximize"}
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        data-testid="window-maximize"
      >
        <VscChromeMaximize className="text-[14px]" />
      </button>
      <button
        onClick={handleClose}
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
