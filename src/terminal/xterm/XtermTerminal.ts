import type { ITerminalOptions } from 'ghostty-web'
import { FitAddon, Terminal as GhosttyTerminal, init } from 'ghostty-web'
import { invoke } from '@tauri-apps/api/core'

import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { TauriCommands } from '../../common/tauriCommands'
import { RegexLinkProvider } from './fileLinkProvider'
import { parseTerminalFileReference, TERMINAL_FILE_LINK_REGEX } from './fileLinks/terminalFileLinks'

export interface XtermTerminalConfig {
  scrollback: number
  fontSize: number
  fontFamily: string
  readOnly: boolean
  minimumContrastRatio: number
  smoothScrolling: boolean
}

export interface XtermTerminalOptions {
  terminalId: string
  config: XtermTerminalConfig
  onLinkClick?: (uri: string) => boolean | Promise<boolean>
  uiMode?: TerminalUiMode
}

type TerminalTheme = NonNullable<ITerminalOptions['theme']>
type FileLinkHandler = (text: string) => Promise<boolean> | boolean
export type TerminalUiMode = 'standard' | 'tui'

let ghosttyInitPromise: Promise<void> | null = null

const TERMINAL_URL_REGEX =
  /(?:https?:\/\/|mailto:|ftp:\/\/|ssh:\/\/|git:\/\/|tel:|magnet:|gemini:\/\/|gopher:\/\/|news:)[\w\-.~:/?#@!$&*+,;=%]+/gi
const URL_TRAILING_PUNCTUATION = /[.,;!?)\]]+$/

function ensureGhosttyInitialized(): Promise<void> {
  if (ghosttyInitPromise) {
    return ghosttyInitPromise
  }

  ghosttyInitPromise = init().catch(error => {
    logger.error('[ghostty-web] init failed', error)
    ghosttyInitPromise = null
    throw error
  })
  return ghosttyInitPromise
}

function buildTheme(): TerminalTheme {
  return {
    background: theme.colors.background.secondary,
    foreground: theme.colors.text.primary,
    cursor: theme.colors.text.primary,
    cursorAccent: theme.colors.background.secondary,
    selectionBackground: theme.colors.text.primary,
    selectionForeground: theme.colors.background.secondary,
    black: theme.colors.background.elevated,
    red: theme.colors.accent.red.DEFAULT,
    green: theme.colors.accent.green.DEFAULT,
    yellow: theme.colors.accent.yellow.DEFAULT,
    blue: theme.colors.accent.blue.DEFAULT,
    magenta: theme.colors.accent.purple.DEFAULT,
    cyan: theme.colors.accent.cyan.DEFAULT,
    white: theme.colors.text.primary,
    brightBlack: theme.colors.background.hover,
    brightRed: theme.colors.accent.red.light,
    brightGreen: theme.colors.accent.green.light,
    brightYellow: theme.colors.accent.yellow.light,
    brightBlue: theme.colors.accent.blue.light,
    brightMagenta: theme.colors.accent.purple.light,
    brightCyan: theme.colors.accent.cyan.light,
    brightWhite: theme.colors.text.primary,
  }
}

const DEFAULT_SMOOTH_SCROLL_DURATION_MS = 125

function buildTerminalOptions(config: XtermTerminalConfig): ITerminalOptions {
  return {
    theme: buildTheme(),
    fontFamily: config.fontFamily,
    fontSize: config.fontSize,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: config.scrollback,
    smoothScrollDuration: config.smoothScrolling ? DEFAULT_SMOOTH_SCROLL_DURATION_MS : 0,
    convertEol: false,
    disableStdin: config.readOnly,
    allowTransparency: false,
  }
}

export class XtermTerminal {
  static ensureInitialized(): Promise<void> {
    return ensureGhosttyInitialized()
  }

  readonly raw: GhosttyTerminal
  readonly fitAddon: FitAddon
  private urlLinkProviderRegistered = false
  private fileLinkProviderRegistered = false
  private selectionApiPatched = false
  private readonly container: HTMLDivElement
  private opened = false
  private config: XtermTerminalConfig
  private readonly terminalId: string
  private fileLinkHandler: FileLinkHandler | null = null
  private linkHandler: ((uri: string) => boolean | Promise<boolean>) | null = null
  private uiMode: TerminalUiMode
  private savedViewportY: number | null = null

  constructor(options: XtermTerminalOptions) {
    this.terminalId = options.terminalId
    this.config = options.config
    this.uiMode = options.uiMode ?? 'standard'
    this.linkHandler = options.onLinkClick ?? null
    const resolvedOptions = buildTerminalOptions(this.config)

    this.raw = new GhosttyTerminal(resolvedOptions)
    this.fitAddon = new FitAddon()
    this.raw.loadAddon(this.fitAddon)

    this.container = document.createElement('div')
    this.container.dataset.terminalId = options.terminalId
    this.container.classList.add('schaltwerk-terminal-wrapper')
    this.container.style.width = '100%'
    this.container.style.height = '100%'
    this.container.style.position = 'relative'
    this.container.style.display = 'block'
    this.container.style.overflow = 'hidden'
    this.container.style.boxSizing = 'border-box'
  }

  isTuiMode(): boolean {
    return this.uiMode === 'tui'
  }

  shouldFollowOutput(): boolean {
    return !this.isTuiMode()
  }

  setUiMode(mode: TerminalUiMode): void {
    if (mode === this.uiMode) {
      return
    }
    this.uiMode = mode
    if (!this.opened) {
      return
    }
    if (this.uiMode === 'tui') {
      this.applyTuiMode()
    } else {
      this.applyStandardMode()
    }
  }

  get element(): HTMLDivElement {
    return this.container
  }

  attach(target: HTMLElement): void {
    const viewportY = this.getViewportY()
    logger.debug(`[XtermTerminal ${this.terminalId}] attach(): uiMode=${this.uiMode}, opened=${this.opened}, viewportY=${viewportY}`)

    if (!this.opened) {
      this.raw.open(this.container)
      this.opened = true
      logger.debug(`[XtermTerminal ${this.terminalId}] Opened terminal (first attach)`)

      this.registerLinkProviders()
      this.patchSelectionApi()
    }
    if (this.uiMode === 'tui') {
      this.applyTuiMode()
    }
    if (this.container.parentElement !== target) {
      target.appendChild(this.container)
    }
    this.container.style.display = 'block'

    if (this.savedViewportY !== null) {
      const savedViewportY = this.savedViewportY
      this.savedViewportY = null
      logger.debug(`[XtermTerminal ${this.terminalId}] Restoring scroll position: viewportY=${savedViewportY}`)
      requestAnimationFrame(() => {
        try {
          this.raw.scrollToLine(savedViewportY)
        } catch (error) {
          logger.debug(`[XtermTerminal ${this.terminalId}] Failed to restore scroll position`, error)
        }
      })
    }
  }

  isAtBottom(): boolean {
    return this.getViewportY() <= 1
  }

  private applyTuiMode(): void {
    logger.debug(`[XtermTerminal ${this.terminalId}] applyTuiMode(): viewportY=${this.getViewportY()}`)

    try {
      this.raw.options.cursorBlink = false
    } catch (error) {
      logger.debug(`[XtermTerminal ${this.terminalId}] Failed to disable cursor blink for TUI mode`, error)
    }

    try {
      this.raw.write('\x1b[?25l')
    } catch (error) {
      logger.debug(`[XtermTerminal ${this.terminalId}] Failed to hide cursor for TUI mode`, error)
    }
  }

  private applyStandardMode(): void {
    try {
      this.raw.options.cursorBlink = true
    } catch (error) {
      logger.debug(`[XtermTerminal ${this.terminalId}] Failed to enable cursor blink for standard mode`, error)
    }

    try {
      this.raw.write('\x1b[?25h')
    } catch (error) {
      logger.debug(`[XtermTerminal ${this.terminalId}] Failed to show cursor for standard mode`, error)
    }
  }

  detach(): void {
    this.savedViewportY = this.getViewportY()
    logger.debug(`[XtermTerminal ${this.terminalId}] detach(): Saved viewportY=${this.savedViewportY}`)
    this.container.style.display = 'none'
  }

  setLinkHandler(handler: ((uri: string) => boolean | Promise<boolean>) | null): void {
    this.linkHandler = handler ?? null
  }

  async ensureCoreAddonsLoaded(): Promise<void> {
    return
  }

  applyConfig(partial: Partial<XtermTerminalConfig>): void {
    const next: XtermTerminalConfig = { ...this.config, ...partial }
    this.config = next

    if (partial.scrollback !== undefined) {
      this.raw.options.scrollback = next.scrollback
    }

    if (partial.fontSize !== undefined) {
      this.raw.options.fontSize = next.fontSize
    }

    if (partial.fontFamily !== undefined) {
      this.raw.options.fontFamily = next.fontFamily
    }

    if (partial.readOnly !== undefined) {
      this.raw.options.disableStdin = next.readOnly
    }

    if (partial.smoothScrolling !== undefined) {
      this.setSmoothScrolling(partial.smoothScrolling)
    }
  }

  updateOptions(options: Partial<ITerminalOptions>): void {
    const { fontSize, fontFamily, disableStdin, scrollback, ...rest } = options

    const configUpdates: Partial<XtermTerminalConfig> = {}
    if (fontSize !== undefined) {
      configUpdates.fontSize = fontSize
    }
    if (fontFamily !== undefined) {
      configUpdates.fontFamily = fontFamily
    }
    if (disableStdin !== undefined) {
      configUpdates.readOnly = disableStdin
    }
    if (scrollback !== undefined) {
      configUpdates.scrollback = scrollback
    }
    if (typeof options.smoothScrollDuration === 'number') {
      configUpdates.smoothScrolling = options.smoothScrollDuration > 0
    }

    if (Object.keys(configUpdates).length > 0) {
      this.applyConfig(configUpdates)
    }

    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        ;(this.raw.options as Record<string, unknown>)[key] = value
      }
    }
  }

  refresh(): void {
    return
  }

  setSmoothScrolling(enabled: boolean): void {
    this.raw.options.smoothScrollDuration = enabled ? DEFAULT_SMOOTH_SCROLL_DURATION_MS : 0
  }

  dispose(): void {
    this.detach()
    this.raw.dispose()
  }

  setFileLinkHandler(handler: FileLinkHandler | null): void {
    this.fileLinkHandler = handler
  }

  private async handleFileLink(event: MouseEvent, text: string): Promise<void> {
    if (!this.fileLinkHandler) return
    try {
      const handled = await this.fileLinkHandler(text)
      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    } catch (error) {
      logger.error(`[XtermTerminal ${this.terminalId}] File link handler failed for ${text}`, error)
    }
  }

  private registerLinkProviders(): void {
    if (!this.opened) {
      return
    }

    if (!this.urlLinkProviderRegistered) {
      try {
        this.raw.registerLinkProvider(
          new RegexLinkProvider(
            this.raw,
            TERMINAL_URL_REGEX,
            (event, text) => {
              void this.handleUrlLink(event, text)
            },
          ),
        )
        this.urlLinkProviderRegistered = true
      } catch (error) {
        logger.debug(`[XtermTerminal ${this.terminalId}] Failed to register URL link provider`, error)
      }
    }

    if (!this.fileLinkProviderRegistered) {
      try {
        this.raw.registerLinkProvider(
          new RegexLinkProvider(
            this.raw,
            TERMINAL_FILE_LINK_REGEX,
            (event, text) => {
              void this.handleFileLink(event, text)
            },
            candidate => Boolean(parseTerminalFileReference(candidate)),
          ),
        )
        this.fileLinkProviderRegistered = true
      } catch (error) {
        logger.debug(`[XtermTerminal ${this.terminalId}] Failed to register file link provider`, error)
      }
    }
  }

  private patchSelectionApi(): void {
    if (this.selectionApiPatched) {
      return
    }
    this.selectionApiPatched = true

    const term = this.raw as unknown as {
      selectionManager?: {
        hasSelection?: () => boolean
        clearSelection?: () => void
        selectionStart?: { col: number; absoluteRow: number } | null
        selectionEnd?: { col: number; absoluteRow: number } | null
      }
      wasmTerm?: { getScrollbackLength?: () => number }
    }

    const selectionManager = term.selectionManager
    if (!selectionManager) {
      return
    }

    const getScrollbackLength = (): number => term.wasmTerm?.getScrollbackLength?.() ?? 0

    const clearIfNeeded = () => {
      try {
        if (typeof selectionManager.hasSelection === 'function' && selectionManager.hasSelection()) {
          selectionManager.clearSelection?.()
        }
      } catch (error) {
        logger.debug(`[XtermTerminal ${this.terminalId}] Failed to clear selection`, error)
      }
    }

    const clampCol = (col: number) => Math.max(0, Math.min(col, this.raw.cols - 1))
    const clampAbsRow = (row: number) => Math.max(0, row)

    const setSelection = (startCol: number, startAbsRow: number, endCol: number, endAbsRow: number) => {
      clearIfNeeded()

      selectionManager.selectionStart = {
        col: clampCol(startCol),
        absoluteRow: clampAbsRow(startAbsRow),
      }
      selectionManager.selectionEnd = {
        col: clampCol(endCol),
        absoluteRow: clampAbsRow(endAbsRow),
      }
    }

    const selectAll = () => {
      const scrollbackLength = getScrollbackLength()
      const endAbsRow = scrollbackLength + this.raw.rows - 1
      setSelection(0, 0, this.raw.cols - 1, endAbsRow)
    }

    const select = (column: number, row: number, length: number) => {
      const cols = this.raw.cols
      const rows = this.raw.rows
      const viewportY = this.getViewportY()
      const scrollbackLength = getScrollbackLength()

      const startViewportRow = Math.max(0, Math.min(row, rows - 1))
      const startCol = clampCol(column)

      const endOffset = Math.max(0, length - 1)
      const endIndex = startCol + endOffset
      const endViewportRow = Math.min(rows - 1, startViewportRow + Math.floor(endIndex / cols))
      const endCol = clampCol(endIndex % cols)

      const startAbsRow = scrollbackLength + startViewportRow - viewportY
      const endAbsRow = scrollbackLength + endViewportRow - viewportY

      setSelection(startCol, startAbsRow, endCol, endAbsRow)
    }

    const selectLines = (start: number, end: number) => {
      const rows = this.raw.rows
      const viewportY = this.getViewportY()
      const scrollbackLength = getScrollbackLength()

      const startViewportRow = Math.max(0, Math.min(start, rows - 1))
      const endViewportRow = Math.max(0, Math.min(end, rows - 1))
      const startRow = Math.min(startViewportRow, endViewportRow)
      const endRow = Math.max(startViewportRow, endViewportRow)

      const startAbsRow = scrollbackLength + startRow - viewportY
      const endAbsRow = scrollbackLength + endRow - viewportY

      setSelection(0, startAbsRow, this.raw.cols - 1, endAbsRow)
    }

    ;(this.raw as unknown as { selectAll?: () => void }).selectAll = selectAll
    ;(this.raw as unknown as { select?: (column: number, row: number, length: number) => void }).select = select
    ;(this.raw as unknown as { selectLines?: (start: number, end: number) => void }).selectLines = selectLines
  }

  private getViewportY(): number {
    const getViewportY = (this.raw as unknown as { getViewportY?: () => number }).getViewportY
    if (typeof getViewportY === 'function') {
      return Math.max(0, Math.floor(getViewportY.call(this.raw)))
    }
    return Math.max(0, Math.floor((this.raw as unknown as { viewportY?: number }).viewportY ?? 0))
  }

  private async handleUrlLink(event: MouseEvent, text: string): Promise<void> {
    if (!event.ctrlKey && !event.metaKey) {
      return
    }

    const uri = text.replace(URL_TRAILING_PUNCTUATION, '')

    const openLink = async () => {
      try {
        if (this.linkHandler) {
          const handled = await this.linkHandler(uri)
          if (handled) return
        }
      } catch (error) {
        logger.debug(`[XtermTerminal ${this.terminalId}] Link handler failed`, error)
      }

      try {
        await invoke<void>(TauriCommands.OpenExternalUrl, { url: uri })
      } catch (error) {
        logger.error(`[XtermTerminal ${this.terminalId}] Failed to open link: ${uri}`, error)
      }
    }

    void openLink()
  }
}
