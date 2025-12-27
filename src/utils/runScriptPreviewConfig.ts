export interface AutoPreviewConfig {
  interceptClicks: boolean
}

export function mapRunScriptPreviewConfig(runScript: unknown): AutoPreviewConfig {
  const script = (runScript ?? {}) as Record<string, unknown>

  const interceptClicks = Boolean(
    script.previewLocalhostOnClick ?? script.preview_localhost_on_click ?? true
  )

  return {
    interceptClicks,
  }
}
