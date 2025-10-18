import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WebGLTerminalRenderer } from './webglRenderer'
import type { Terminal as XTerm } from '@xterm/xterm'

vi.mock('./webglCapability', () => ({
    isWebGLSupported: vi.fn(() => true)
}))

const mockWebglAddonInstance = {
    onContextLoss: vi.fn(),
    dispose: vi.fn(),
    clearTextureAtlas: vi.fn()
};
const mockWebglAddonCtor = vi.fn(() => mockWebglAddonInstance);

let importAddonMock: ReturnType<typeof vi.fn>;

vi.mock('../xterm/xtermAddonImporter', () => ({
    XtermAddonImporter: class {
        importAddon(name: string) {
            return importAddonMock(name);
        }
    }
}));

importAddonMock = vi.fn(async (name: string) => {
    if (name === 'webgl') {
        return mockWebglAddonCtor;
    }
    throw new Error(`Unexpected addon request: ${name}`);
});

describe('WebGLTerminalRenderer', () => {
    let mockTerminal: XTerm
    let renderer: WebGLTerminalRenderer

    beforeEach(() => {
        mockTerminal = {
            loadAddon: vi.fn(),
            element: document.createElement('div')
        } as unknown as XTerm

        renderer = new WebGLTerminalRenderer(mockTerminal, 'test-terminal')

        importAddonMock.mockClear();
        mockWebglAddonCtor.mockClear();
        mockWebglAddonInstance.onContextLoss.mockClear();
        mockWebglAddonInstance.dispose.mockClear();
        mockWebglAddonInstance.clearTextureAtlas.mockClear();
    })

    it('should initialize with WebGL when supported', async () => {
        const state = await renderer.initialize()

        expect(state.type).toBe('webgl')
        expect(state.contextLost).toBe(false)
        expect(mockTerminal.loadAddon).toHaveBeenCalled()
        expect(importAddonMock).toHaveBeenCalledWith('webgl')
    })

    it('should fall back to Canvas when WebGL is not supported', async () => {
        const { isWebGLSupported } = await import('./webglCapability')
        vi.mocked(isWebGLSupported).mockReturnValue(false)

        const state = await renderer.initialize()

        expect(state.type).toBe('canvas')
        expect(state.contextLost).toBe(false)
        expect(mockTerminal.loadAddon).not.toHaveBeenCalled()
    })

    it('should not re-initialize if already initialized', async () => {
        await renderer.initialize()
        const firstCallCount = vi.mocked(mockTerminal.loadAddon).mock.calls.length

        await renderer.initialize()
        const secondCallCount = vi.mocked(mockTerminal.loadAddon).mock.calls.length

        expect(secondCallCount).toBe(firstCallCount)
    })

    it('should defer initialization when terminal element is missing', async () => {
        const terminalWithoutElement = {
            loadAddon: vi.fn()
        } as unknown as XTerm
        const rendererWithoutElement = new WebGLTerminalRenderer(terminalWithoutElement, 'missing-element')

        const state = await rendererWithoutElement.initialize()

        expect(state.type).toBe('none')
        expect(vi.mocked(terminalWithoutElement.loadAddon)).not.toHaveBeenCalled()
    })

    it('should dispose the renderer and reset state', async () => {
        await renderer.initialize()

        renderer.dispose()

        const stateAfter = renderer.getState()
        expect(stateAfter.type).toBe('none')
        expect(stateAfter.addon).toBeUndefined()
    })

    it('should not throw when clearing texture atlas', async () => {
        await renderer.initialize()

        expect(() => renderer.clearTextureAtlas()).not.toThrow()
    })

    it('should not throw when clearing texture atlas without WebGL', async () => {
        const { isWebGLSupported } = await import('./webglCapability')
        vi.mocked(isWebGLSupported).mockReturnValue(false)

        await renderer.initialize()

        expect(() => renderer.clearTextureAtlas()).not.toThrow()
    })
})
