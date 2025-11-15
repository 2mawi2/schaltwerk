export interface LinkMatch {
  text: string
  start: number
  end: number
}

type MatchValidator = (text: string) => boolean

export function findLinkMatches(source: string, pattern: RegExp, validator?: MatchValidator): LinkMatch[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const regex = new RegExp(pattern.source, flags)
  const matches: LinkMatch[] = []

  let result: RegExpExecArray | null
  while ((result = regex.exec(source)) !== null) {
    const text = result[0]
    if (validator && !validator(text)) {
      continue
    }
    matches.push({
      text,
      start: result.index,
      end: result.index + text.length,
    })
    if (text.length === 0) {
      regex.lastIndex += 1
    }
  }

  return matches
}
