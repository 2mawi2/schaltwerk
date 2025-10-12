import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { isWebGLSupported, getWebGLCapabilityState, resetWebGLCapabilityCacheForTesting } from './webglCapability'

describe('WebGL Capability Detection', () => {
    beforeEach(() => {
        resetWebGLCapabilityCacheForTesting()
        vi.restoreAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('should detect WebGL support when available', () => {
        const mockCanvas = document.createElement('canvas')
        const mockContext = {}
        vi.spyOn(mockCanvas, 'getContext').mockReturnValue(mockContext as WebGLRenderingContext)
        vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas)

        const supported = isWebGLSupported()
        expect(supported).toBe(true)

        const state = getWebGLCapabilityState()
        expect(state?.supported).toBe(true)
        expect(state?.failureReason).toBeUndefined()
    })

    it('should detect when WebGL is not supported', () => {
        const mockCanvas = document.createElement('canvas')
        vi.spyOn(mockCanvas, 'getContext').mockReturnValue(null)
        vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas)

        const supported = isWebGLSupported()
        expect(supported).toBe(false)

        const state = getWebGLCapabilityState()
        expect(state?.supported).toBe(false)
        expect(state?.failureReason).toBe('WebGL context creation failed')
    })

    it('should cache the capability check result', () => {
        const createElementSpy = vi.spyOn(document, 'createElement')
        const mockCanvas = document.createElement('canvas')
        const mockContext = {}
        vi.spyOn(mockCanvas, 'getContext').mockReturnValue(mockContext as WebGLRenderingContext)
        createElementSpy.mockReturnValue(mockCanvas)

        isWebGLSupported()
        const firstCallCount = createElementSpy.mock.calls.length

        isWebGLSupported()
        const secondCallCount = createElementSpy.mock.calls.length

        expect(secondCallCount).toBe(firstCallCount)
    })

    it('should handle errors during detection', () => {
        vi.spyOn(document, 'createElement').mockImplementation(() => {
            throw new Error('Canvas creation failed')
        })

        const supported = isWebGLSupported()
        expect(supported).toBe(false)

        const state = getWebGLCapabilityState()
        expect(state?.supported).toBe(false)
        expect(state?.failureReason).toBe('Canvas creation failed')
    })
})
