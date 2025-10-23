const TEMPLATE_PREFIX = [
  '## Problem',
  '<!-- What problem does this solve? -->',
  '',
  '## Proposed Solution',
  '<!-- How should it work? -->',
  '',
  '## Alternatives',
  '<!-- Other approaches considered -->',
  '',
  '## Additional Context',
  '',
] as const

const TEMPLATE_SUFFIX = [
  '',
  '<!-- Provide any extra details, logs, or screenshots here. -->',
  '',
] as const

export function composeFeedbackBody(contextLines: string[]): string {
  return [...TEMPLATE_PREFIX, ...contextLines, ...TEMPLATE_SUFFIX].join('\n')
}
