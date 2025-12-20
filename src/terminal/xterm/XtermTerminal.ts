import type { IDisposable, ITerminalOptions } from '@xterm/xterm'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { invoke } from '@tauri-apps/api/core'

import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { XtermAddonImporter } from './xtermAddonImporter'
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

interface IXtermViewport {
  _innerRefresh(): void
}

interface IXtermCore {
  viewport?: IXtermViewport
}

interface ITerminalWithCore extends XTerm {
  _core?: IXtermCore
}

function buildTheme(): TerminalTheme {
  return {
    background: theme.colors.background.secondary,
    foreground: theme.colors.text.primary,
    cursor: theme.colors.text.primary,
    cursorAccent: theme.colors.background.secondary,
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
    cursorInactiveStyle: 'outline',
    scrollback: config.scrollback,
    smoothScrollDuration: config.smoothScrolling ? DEFAULT_SMOOTH_SCROLL_DURATION_MS : 0,
    convertEol: false,
    disableStdin: config.readOnly,
    minimumContrastRatio: config.minimumContrastRatio,
    customGlyphs: true,
    drawBoldTextInBrightColors: false,
    rescaleOverlappingGlyphs: true,
    allowTransparency: false,
    allowProposedApi: false,
    fastScrollSensitivity: 8,
    scrollSensitivity: 1.5,
    scrollOnUserInput: true,
    altClickMovesCursor: true,
    rightClickSelectsWord: true,
    tabStopWidth: 8,
  }
}

export class XtermTerminal {
  readonly raw: XTerm
  readonly fitAddon: FitAddon
  readonly searchAddon: SearchAddon
  readonly webLinksAddon: WebLinksAddon
  private readonly fileLinkProvider: IDisposable
  private readonly container: HTMLDivElement
  private opened = false
  private readonly coreAddonsReady: Promise<void>
  private config: XtermTerminalConfig
  private readonly terminalId: string
  private fileLinkHandler: FileLinkHandler | null = null
  private linkHandler: ((uri: string) => boolean | Promise<boolean>) | null = null
  private uiMode: TerminalUiMode
  private savedDistanceFromBottom: number | null = null

  constructor(options: XtermTerminalOptions) {
    this.terminalId = options.terminalId
    this.config = options.config
    this.uiMode = options.uiMode ?? 'standard'
    this.linkHandler = options.onLinkClick ?? null
    const resolvedOptions = buildTerminalOptions(this.config)

    this.raw = new XTerm(resolvedOptions)
    this.fitAddon = new FitAddon()
    this.raw.loadAddon(this.fitAddon)

    this.searchAddon = new SearchAddon()
    this.raw.loadAddon(this.searchAddon)

    this.webLinksAddon = new WebLinksAddon((_event: MouseEvent, uri: string) => {
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
    })
    this.raw.loadAddon(this.webLinksAddon)

    this.fileLinkProvider = this.raw.registerLinkProvider(
      new RegexLinkProvider(
        this.raw,
        TERMINAL_FILE_LINK_REGEX,
        (event, text) => {
          void this.handleFileLink(event, text)
        },
        candidate => Boolean(parseTerminalFileReference(candidate)),
      ),
    )

    XtermAddonImporter.registerPreloadedAddon('fit', FitAddon)
    XtermAddonImporter.registerPreloadedAddon('search', SearchAddon)
    XtermAddonImporter.registerPreloadedAddon('webLinks', WebLinksAddon)

    this.coreAddonsReady = Promise.resolve()

    this.container = document.createElement('div')
    this.container.dataset.terminalId = options.terminalId
    this.container.classList.add('schaltwerk-terminal-wrapper')
    this.container.style.width = '100%'
    this.container.style.height = '100%'
    this.container.style.position = 'relative'
    this.container.style.display = 'block'
    this.container.style.overflow = 'hidden'
    this.container.style.boxSizing = 'border-box'

    this.registerOscHandlers()
    this.registerCsiHandlers()
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
    const buffer = this.raw.buffer?.active
    logger.debug(`[XtermTerminal ${this.terminalId}] attach(): uiMode=${this.uiMode}, opened=${this.opened}, baseY=${buffer?.baseY}, viewportY=${buffer?.viewportY}`)

    if (!this.opened) {
      this.raw.open(this.container)
      this.opened = true
      logger.debug(`[XtermTerminal ${this.terminalId}] Opened terminal (first attach)`)
    }
    if (this.uiMode === 'tui') {
      this.applyTuiMode()
    }
    if (this.container.parentElement !== target) {
      target.appendChild(this.container)
    }
    this.container.style.display = 'block'

    if (this.savedDistanceFromBottom !== null && this.uiMode !== 'tui') {
      const distance = this.savedDistanceFromBottom
      this.savedDistanceFromBottom = null
      logger.debug(`[XtermTerminal ${this.terminalId}] Restoring scroll position: distance=${distance}`)
      requestAnimationFrame(() => {
        try {
          const buf = this.raw.buffer?.active
          if (buf) {
            const targetY = Math.max(0, buf.baseY - distance)
            logger.debug(`[XtermTerminal ${this.terminalId}] Scroll restore RAF: baseY=${buf.baseY}, targetY=${targetY}`)
            this.raw.scrollToLine(targetY)
            this.forceScrollbarRefresh()
          }
        } catch (error) {
          logger.debug(`[XtermTerminal ${this.terminalId}] Failed to restore scroll position`, error)
        }
      })
    } else if (this.uiMode === 'tui') {
      this.savedDistanceFromBottom = null
    }
  }

  isAtBottom(): boolean {
    const buffer = this.raw.buffer?.active
    if (!buffer) return true
    return buffer.baseY - buffer.viewportY <= 1
  }

  private applyTuiMode(): void {
    const buffer = this.raw.buffer?.active
    logger.debug(`[XtermTerminal ${this.terminalId}] applyTuiMode(): baseY=${buffer?.baseY}, viewportY=${buffer?.viewportY}`)

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
    const buffer = this.raw.buffer?.active
    if (buffer && this.uiMode !== 'tui') {
      this.savedDistanceFromBottom = buffer.baseY - buffer.viewportY
      logger.debug(`[XtermTerminal ${this.terminalId}] detach(): Saved scroll distance=${this.savedDistanceFromBottom}, baseY=${buffer.baseY}, viewportY=${buffer.viewportY}`)
    } else {
      logger.debug(`[XtermTerminal ${this.terminalId}] detach(): TUI mode - not saving scroll position`)
    }
    this.container.style.display = 'none'
  }

  setLinkHandler(handler: ((uri: string) => boolean | Promise<boolean>) | null): void {
    this.linkHandler = handler ?? null
  }

  async ensureCoreAddonsLoaded(): Promise<void> {
    await this.coreAddonsReady
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

    if (partial.minimumContrastRatio !== undefined) {
      this.raw.options.minimumContrastRatio = next.minimumContrastRatio
    }

    if (partial.smoothScrolling !== undefined) {
      this.setSmoothScrolling(partial.smoothScrolling)
    }
  }

  updateOptions(options: Partial<ITerminalOptions>): void {
    const { fontSize, fontFamily, disableStdin, minimumContrastRatio, scrollback, ...rest } = options

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
    if (minimumContrastRatio !== undefined) {
      configUpdates.minimumContrastRatio = minimumContrastRatio
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
    const rawWithRefresh = this.raw as unknown as { refresh?: (start: number, end: number) => void }
    if (typeof rawWithRefresh.refresh === 'function') {
      rawWithRefresh.refresh(0, this.raw.rows - 1)
    }
  }

  forceScrollbarRefresh(): void {
    const terminal = this.raw as ITerminalWithCore
    terminal._core?.viewport?._innerRefresh()
  }

  setSmoothScrolling(enabled: boolean): void {
    this.raw.options.smoothScrollDuration = enabled ? DEFAULT_SMOOTH_SCROLL_DURATION_MS : 0
  }

  dispose(): void {
    this.detach()
    try {
      this.fileLinkProvider.dispose()
    } catch (error) {
      logger.debug(`[XtermTerminal ${this.terminalId}] Failed to dispose file link provider`, error)
    }
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

  private registerOscHandlers(): void {
    const oscCodes = [10, 11, 12, 13, 14, 15, 16, 17, 19]
    for (const code of oscCodes) {
      try {
        this.raw.parser.registerOscHandler(code, () => true)
      } catch (error) {
        logger.debug(`[XtermTerminal ${this.terminalId}] OSC handler registration failed for code ${code}`, error)
      }
    }
  }

  private registerCsiHandlers(): void {
    try {
      this.raw.parser.registerCsiHandler({ final: 'J' }, (params) => {
        const param = params.length > 0 ? params[0] : 0
        const isClearScrollback = param === 3
        const buffer = this.raw.buffer?.active

        if (isClearScrollback) {
          if (this.isTuiMode()) {
            logger.debug(`[XtermTerminal ${this.terminalId}] BLOCKED CSI 3J in TUI mode (baseY=${buffer?.baseY}, viewportY=${buffer?.viewportY})`)
            return true
          } else {
            logger.debug(`[XtermTerminal ${this.terminalId}] ALLOWING CSI 3J in standard mode (baseY=${buffer?.baseY}, viewportY=${buffer?.viewportY})`)
          }
        }

        return false
      })
    } catch (error) {
      logger.debug(`[XtermTerminal ${this.terminalId}] CSI J handler registration failed`, error)
    }

    this.registerSynchronizedOutputHandlers()
  }

  private registerSynchronizedOutputHandlers(): void {
    const SYNC_MODE = 2026

    try {
      this.raw.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
        if (params.length > 0 && params[0] === SYNC_MODE) {
          logger.debug(`[XtermTerminal ${this.terminalId}] Synchronized output enabled`)
          return true
        }
        return false
      })

      this.raw.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
        if (params.length > 0 && params[0] === SYNC_MODE) {
          logger.debug(`[XtermTerminal ${this.terminalId}] Synchronized output disabled`)
          return true
        }
        return false
      })
    } catch (error) {
      logger.debug(`[XtermTerminal ${this.terminalId}] Synchronized output handler registration failed`, error)
    }
  }
}
