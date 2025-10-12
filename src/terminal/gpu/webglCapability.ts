import { logger } from '../../utils/logger'

interface WebGLCapabilityState {
    supported: boolean
    checkedAt: number
    failureReason?: string
}

class WebGLCapabilityCache {
    private static instance: WebGLCapabilityCache
    private state: WebGLCapabilityState | null = null

    private constructor() {}

    static getInstance(): WebGLCapabilityCache {
        if (!WebGLCapabilityCache.instance) {
            WebGLCapabilityCache.instance = new WebGLCapabilityCache()
        }
        return WebGLCapabilityCache.instance
    }

    static resetForTesting(): void {
        if (WebGLCapabilityCache.instance) {
            WebGLCapabilityCache.instance.state = null
        }
    }

    isSupported(): boolean {
        if (this.state) {
            return this.state.supported
        }

        this.state = this.detectCapability()
        return this.state.supported
    }

    getState(): WebGLCapabilityState | null {
        return this.state
    }

    private detectCapability(): WebGLCapabilityState {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return {
                supported: false,
                checkedAt: Date.now(),
                failureReason: 'No window or document available'
            }
        }

        try {
            const canvas = document.createElement('canvas')
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')

            if (!gl) {
                logger.info('[WebGLCapability] WebGL context creation failed')
                return {
                    supported: false,
                    checkedAt: Date.now(),
                    failureReason: 'WebGL context creation failed'
                }
            }

            logger.info('[WebGLCapability] WebGL is supported')
            return {
                supported: true,
                checkedAt: Date.now()
            }
        } catch (error) {
            logger.warn('[WebGLCapability] Error detecting WebGL support:', error)
            return {
                supported: false,
                checkedAt: Date.now(),
                failureReason: error instanceof Error ? error.message : 'Unknown error'
            }
        }
    }
}

export function isWebGLSupported(): boolean {
    return WebGLCapabilityCache.getInstance().isSupported()
}

export function getWebGLCapabilityState(): WebGLCapabilityState | null {
    return WebGLCapabilityCache.getInstance().getState()
}

export function resetWebGLCapabilityCacheForTesting(): void {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
        WebGLCapabilityCache.resetForTesting()
    }
}
