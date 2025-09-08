import { describe, it, expect } from 'vitest'
import { getFileLanguage } from './diff'

describe('diff utilities', () => {
  describe('getFileLanguage', () => {
    it('identifies TypeScript files', () => {
      expect(getFileLanguage('file.ts')).toBe('typescript')
      expect(getFileLanguage('component.tsx')).toBe('typescript')
    })
    
    it('identifies JavaScript files', () => {
      expect(getFileLanguage('script.js')).toBe('javascript')
      expect(getFileLanguage('component.jsx')).toBe('javascript')
    })
    
    it('identifies Rust files', () => {
      expect(getFileLanguage('main.rs')).toBe('rust')
    })
    
    it('returns undefined for unknown extensions', () => {
      expect(getFileLanguage('file.xyz')).toBeUndefined()
      expect(getFileLanguage('noextension')).toBeUndefined()
    })
    
    it('handles nested paths', () => {
      expect(getFileLanguage('src/components/App.tsx')).toBe('typescript')
      expect(getFileLanguage('/usr/local/bin/script.sh')).toBe('bash')
    })
    
    it('handles empty input', () => {
      expect(getFileLanguage('')).toBeUndefined()
    })
  })
})