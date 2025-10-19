import type { ITerminalOptions } from '@xterm/xterm'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'

import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { XtermAddonImporter } from './xtermAddonImporter'

export interface XtermTerminalConfig {
  scrollback: number
  fontSize: number
  fontFamily: string
  readOnly: boolean
  minimumContrastRatio: number
}

export interface XtermTerminalOptions {
  terminalId: string
  config: XtermTerminalConfig
}

type TerminalTheme = NonNullable<ITerminalOptions['theme']>

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

function buildTerminalOptions(config: XtermTerminalConfig): ITerminalOptions {
  return {
    theme: buildTheme(),
    fontFamily: config.fontFamily,
    fontSize: config.fontSize,
    cursorBlink: true,
    cursorStyle: 'block',
    cursorInactiveStyle: 'outline',
    scrollback: config.scrollback,
    smoothScrollDuration: 0,
    convertEol: false,
    disableStdin: config.readOnly,
    minimumContrastRatio: config.minimumContrastRatio,
    customGlyphs: true,
    drawBoldTextInBrightColors: false,
    rescaleOverlappingGlyphs: false,
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
  private readonly container: HTMLDivElement
  private opened = false
  private readonly coreAddonsReady: Promise<void>
  private config: XtermTerminalConfig
  private readonly terminalId: string

  constructor(options: XtermTerminalOptions) {
    this.terminalId = options.terminalId
    this.config = options.config
    const resolvedOptions = buildTerminalOptions(this.config)

    this.raw = new XTerm(resolvedOptions)
    this.fitAddon = new FitAddon()
    this.raw.loadAddon(this.fitAddon)

    this.searchAddon = new SearchAddon()
    this.raw.loadAddon(this.searchAddon)

    XtermAddonImporter.registerPreloadedAddon('fit', FitAddon)
    XtermAddonImporter.registerPreloadedAddon('search', SearchAddon)

    this.coreAddonsReady = Promise.resolve()

    this.container = document.createElement('div')
    this.container.dataset.terminalId = options.terminalId
    this.container.style.width = '100%'
    this.container.style.height = '100%'
    this.container.style.display = 'flex'
    this.container.style.flexDirection = 'column'
    this.container.style.flex = '1 1 auto'
    this.container.style.alignItems = 'stretch'
    this.container.style.justifyContent = 'stretch'
    this.container.style.overflow = 'hidden'

    this.registerOscHandlers()
  }

  get element(): HTMLDivElement {
    return this.container
  }

  attach(target: HTMLElement): void {
    if (!this.opened) {
      this.raw.open(this.container)
      this.opened = true
    }
    if (this.container.parentElement !== target) {
      target.appendChild(this.container)
    }
    this.container.style.display = 'flex'
  }

  detach(): void {
    this.container.style.display = 'none'
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

    if (Object.keys(configUpdates).length > 0) {
      this.applyConfig(configUpdates)
    }

    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        ;(this.raw.options as Record<string, unknown>)[key] = value
      }
    }
  }

  dispose(): void {
    this.detach()
    this.raw.dispose()
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
}
