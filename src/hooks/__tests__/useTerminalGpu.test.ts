import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useTerminalGpu } from '../useTerminalGpu'

describe('useTerminalGpu (ghostty-web)', () => {
  it('exposes a stable no-op API when WebGL is unavailable', async () => {
    const terminalRef = { current: null }
    const fitAddonRef = { current: null }

    const { result } = renderHook(() =>
      useTerminalGpu({
        terminalId: 'test-terminal',
        terminalRef,
        fitAddonRef,
        applySizeUpdate: () => true,
      }),
    )

    expect(result.current.gpuEnabledForTerminal).toBe(false)
    expect(result.current.webglRendererActive).toBe(false)

    expect(() => result.current.applyLetterSpacing(true)).not.toThrow()
    expect(() => result.current.refreshGpuFontRendering()).not.toThrow()
    expect(() => result.current.cancelGpuRefreshWork()).not.toThrow()

    await act(async () => {
      await result.current.ensureRenderer()
      await result.current.handleFontPreferenceChange()
    })
  })
})

