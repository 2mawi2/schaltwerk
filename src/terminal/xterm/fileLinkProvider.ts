import type { ILink, ILinkProvider, IBufferLine, Terminal } from '@xterm/xterm'

import { findLinkMatches } from './fileLinks/linkText'

type Validator = (text: string) => boolean

export class RegexLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly pattern: RegExp,
    private readonly activate: (event: MouseEvent, text: string) => void,
    private readonly validator?: Validator,
  ) {}

  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const [lines, startLineIndex] = getWindowedLines(y - 1, this.terminal)
    const mergedLine = lines.join('')

    const matches = findLinkMatches(mergedLine, this.pattern, this.validator)
    const links: ILink[] = []

    for (const match of matches) {
      const [startY, startX] = mapIndex(this.terminal, startLineIndex, 0, match.start)
      const [endY, endX] = mapIndex(this.terminal, startY, startX, match.text.length)

      if (startY === -1 || startX === -1 || endY === -1 || endX === -1) {
        continue
      }

      links.push({
        text: match.text,
        range: {
          start: { x: startX + 1, y: startY + 1 },
          end: { x: endX, y: endY + 1 },
        },
        activate: (event: MouseEvent) => this.activate(event, match.text),
      })
    }

    callback(links)
  }
}

function getWindowedLines(lineIndex: number, terminal: Terminal): [string[], number] {
  let topIdx = lineIndex
  let bottomIdx = lineIndex
  const lines: string[] = []
  let line: IBufferLine | undefined = terminal.buffer.active.getLine(lineIndex)

  if (!line) {
    return [lines, topIdx]
  }

  const currentContent = line.translateToString(true)

  if (line.isWrapped && currentContent[0] !== ' ') {
    let length = 0
    while ((line = terminal.buffer.active.getLine(--topIdx))) {
      const content = line.translateToString(true)
      length += content.length
      lines.push(content)
      if (!line.isWrapped || content.indexOf(' ') !== -1 || length > 2048) {
        break
      }
    }
    lines.reverse()
  }

  lines.push(currentContent)

  let bottomLength = 0
  while ((line = terminal.buffer.active.getLine(++bottomIdx)) && line.isWrapped) {
    const content = line.translateToString(true)
    bottomLength += content.length
    lines.push(content)
    if (content.indexOf(' ') !== -1 || bottomLength > 2048) {
      break
    }
  }

  return [lines, topIdx]
}

function mapIndex(terminal: Terminal, lineIndex: number, rowIndex: number, stringIndex: number): [number, number] {
  const buffer = terminal.buffer.active
  const cell = buffer.getNullCell()
  let start = rowIndex

  while (stringIndex) {
    const line = buffer.getLine(lineIndex)
    if (!line) {
      return [-1, -1]
    }
    for (let i = start; i < line.length; i += 1) {
      line.getCell(i, cell)
      const chars = cell.getChars()
      const width = cell.getWidth()
      if (width) {
        stringIndex -= chars.length || 1
        if (i === line.length - 1 && chars === '') {
          const nextLine = buffer.getLine(lineIndex + 1)
          if (nextLine && nextLine.isWrapped) {
            nextLine.getCell(0, cell)
            if (cell.getWidth() === 2) {
              stringIndex += 1
            }
          }
        }
      }
      if (stringIndex < 0) {
        return [lineIndex, i]
      }
    }
    lineIndex += 1
    start = 0
  }

  return [lineIndex, start]
}
