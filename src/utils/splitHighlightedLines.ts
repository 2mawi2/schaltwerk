interface OpenTag {
  name: string
  full: string
}

export function splitHighlightedLines(value: string): string[] {
  if (!value) {
    return ['']
  }

  const lines: string[] = []
  const openTags: OpenTag[] = []
  let current = ''

  const appendClosingTags = () => openTags
    .slice()
    .reverse()
    .map(tag => `</${tag.name}>`)
    .join('')

  const reopenTags = () => openTags.map(tag => tag.full).join('')

  for (let index = 0; index < value.length; index++) {
    const char = value[index]

    if (char === '<') {
      const closeIndex = value.indexOf('>', index)
      if (closeIndex === -1) {
        current += value.slice(index)
        break
      }

      const tagContent = value.slice(index + 1, closeIndex)
      const fullTag = `<${tagContent}>`
      current += fullTag

      if (tagContent.startsWith('/')) {
        const tagName = tagContent.slice(1).split(/\s+/)[0]
        for (let i = openTags.length - 1; i >= 0; i--) {
          if (openTags[i].name === tagName) {
            openTags.splice(i, 1)
            break
          }
        }
      } else if (!tagContent.endsWith('/')) {
        const tagName = tagContent.split(/\s+/)[0]
        openTags.push({ name: tagName, full: fullTag })
      }

      index = closeIndex
      continue
    }

    if (char === '\n') {
      lines.push(current + appendClosingTags())
      current = reopenTags()
      continue
    }

    current += char
  }

  lines.push(current + appendClosingTags())
  return lines
}
