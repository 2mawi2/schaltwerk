import { describe, it, expect } from 'vitest'
import { mapRunScriptPreviewConfig } from './runScriptPreviewConfig'

describe('mapRunScriptPreviewConfig', () => {
  it('maps camelCase flags to internal config', () => {
    const config = mapRunScriptPreviewConfig({
      command: 'bun run dev',
      previewLocalhostOnClick: true,
    })

    expect(config).toEqual({
      interceptClicks: true,
    })
  })

  it('maps snake_case flags for backward compatibility', () => {
    const config = mapRunScriptPreviewConfig({
      command: 'npm start',
      preview_localhost_on_click: true,
    })

    expect(config).toEqual({
      interceptClicks: true,
    })
  })

  it('defaults to interceptClicks true when flags are missing', () => {
    const config = mapRunScriptPreviewConfig({ command: 'pnpm dev' })
    expect(config).toEqual({ interceptClicks: true })
  })

  it('respects explicit false setting', () => {
    const config = mapRunScriptPreviewConfig({
      command: 'npm start',
      previewLocalhostOnClick: false,
    })
    expect(config).toEqual({ interceptClicks: false })
  })
})
