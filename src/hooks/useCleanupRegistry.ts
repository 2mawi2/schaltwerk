import { useRef, useEffect } from 'react'
import { logger } from '../utils/logger'

export function useCleanupRegistry() {
    const cleanupRegistry = useRef<(() => void)[]>([])
    
    const addCleanup = (cleanup: () => void) => {
        cleanupRegistry.current.push(cleanup)
    }
    
    const addEventListener = <T extends EventTarget>(
        target: T | null,
        event: string,
        handler: EventListener,
        options?: boolean | AddEventListenerOptions
    ) => {
        if (!target) return
        
        target.addEventListener(event, handler, options)
        addCleanup(() => target.removeEventListener(event, handler, options))
    }
    
    const addResizeObserver = (target: Element | null, callback: ResizeObserverCallback) => {
        if (!target) return null
        
        const observer = new ResizeObserver(callback)
        observer.observe(target)
        addCleanup(() => observer.disconnect())
        return observer
    }
    
    const addTimeout = (callback: () => void, delay: number) => {
        const timeoutId = setTimeout(callback, delay)
        addCleanup(() => clearTimeout(timeoutId))
        return timeoutId
    }
    
    const addInterval = (callback: () => void, delay: number) => {
        const intervalId = setInterval(callback, delay)
        addCleanup(() => clearInterval(intervalId))
        return intervalId
    }
    
    useEffect(() => {
        return () => {
            cleanupRegistry.current.forEach(cleanup => {
                try {
                    cleanup()
                } catch (error) {
                    logger.error('[useCleanupRegistry] Cleanup error:', error)
                }
            })
            cleanupRegistry.current = []
        }
    }, [])
    
    return {
        addCleanup,
        addEventListener,
        addResizeObserver,
        addTimeout,
        addInterval
    }
}