import type { ITerminalOptions } from '@xterm/xterm'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'

export interface XtermTerminalOptions {
  terminalId: string
  xtermOptions: Partial<ITerminalOptions>
}

export class XtermTerminal {
  readonly raw: XTerm
  readonly fitAddon: FitAddon
  readonly searchAddon: SearchAddon
  private readonly container: HTMLDivElement
  private opened = false

  constructor(options: XtermTerminalOptions) {
    this.raw = new XTerm(options.xtermOptions as ITerminalOptions)

    this.fitAddon = new FitAddon()
    this.raw.loadAddon(this.fitAddon)

    this.searchAddon = new SearchAddon()
    this.raw.loadAddon(this.searchAddon)

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
  }

  detach(): void {
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container)
    }
  }

  updateOptions(options: Partial<ITerminalOptions>): void {
    const { fontSize, fontFamily, ...rest } = options

    if (fontSize !== undefined) {
      this.raw.options.fontSize = fontSize
    }

    if (fontFamily !== undefined) {
      this.raw.options.fontFamily = fontFamily
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
}
