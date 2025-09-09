import { useRef, useEffect, useCallback } from 'react'
import { logger } from '../utils/logger'

export function useCleanupRegistry() {
    const cleanupRegistry = useRef<(() => void)[]>([])
    
    const addCleanup = useCallback((cleanup: () => void) => {
        cleanupRegistry.current.push(cleanup)
    }, [])
    
    const addEventListener = useCallback(<T extends EventTarget>(
        target: T | null,
        event: string,
        handler: EventListener,
        options?: boolean | AddEventListenerOptions
    ) => {
        if (!target) return
        
        target.addEventListener(event, handler, options)
        addCleanup(() => target.removeEventListener(event, handler, options))
    }, [addCleanup])
    
    const addResizeObserver = useCallback((target: Element | null, callback: ResizeObserverCallback) => {
        if (!target) return null
        
        const observer = new ResizeObserver(callback)
        observer.observe(target)
        addCleanup(() => observer.disconnect())
        return observer
    }, [addCleanup])
    
    const addTimeout = useCallback((callback: () => void, delay: number) => {
        const timeoutId = setTimeout(callback, delay)
        addCleanup(() => clearTimeout(timeoutId))
        return timeoutId
    }, [addCleanup])
    
    const addInterval = useCallback((callback: () => void, delay: number) => {
        const intervalId = setInterval(callback, delay)
        addCleanup(() => clearInterval(intervalId))
        return intervalId
    }, [addCleanup])
    
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