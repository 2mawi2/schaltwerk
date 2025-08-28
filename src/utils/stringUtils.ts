export function getLongestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) {
    return ''
  }
  if (strings.length === 1) {
    return strings[0]
  }

  let prefix = strings[0]
  for (let i = 1; i < strings.length; i++) {
    while (strings[i].indexOf(prefix) !== 0) {
      prefix = prefix.slice(0, -1)
      if (prefix === '') {
        return ''
      }
    }
  }
  return prefix
}