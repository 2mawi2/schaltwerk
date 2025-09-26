import { describe, it, expect } from 'vitest'
import { filterFilePaths } from './fileReferenceAutocomplete'

describe('filterFilePaths', () => {
  const files = [
    'README.md',
    'docs/setup.md',
    'src/components/Button.tsx',
    'src/components/Card.tsx',
    'src/hooks/useProject.ts',
    'tests/spec.md'
  ]

  it('returns top results when query is empty', () => {
    expect(filterFilePaths(files, '')).toEqual(files)
  })

  it('matches on any path segment prefix', () => {
    expect(filterFilePaths(files, 'comp')).toEqual([
      'src/components/Button.tsx',
      'src/components/Card.tsx'
    ])
  })

  it('is case insensitive', () => {
    expect(filterFilePaths(files, 'READ')).toEqual(['README.md'])
  })

  it('returns empty array when no matches are found', () => {
    expect(filterFilePaths(files, 'nope')).toEqual([])
  })
})
