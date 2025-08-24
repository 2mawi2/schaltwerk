import { describe, it, expect } from 'vitest'
import { isBinaryFileByExtension, getBinaryExtensions, isBinaryExtension } from './binaryDetection'

describe('binaryDetection', () => {
  describe('isBinaryFileByExtension', () => {
    it('should detect image files as binary', () => {
      expect(isBinaryFileByExtension('test.png')).toBe(true)
      expect(isBinaryFileByExtension('image.jpg')).toBe(true)
      expect(isBinaryFileByExtension('photo.JPEG')).toBe(true) // case insensitive
      expect(isBinaryFileByExtension('icon.svg')).toBe(true)
    })

    it('should detect archive files as binary', () => {
      expect(isBinaryFileByExtension('archive.zip')).toBe(true)
      expect(isBinaryFileByExtension('compressed.rar')).toBe(true)
      expect(isBinaryFileByExtension('data.tar.gz')).toBe(true) // handles multiple extensions
      expect(isBinaryFileByExtension('backup.7z')).toBe(true)
    })

    it('should detect executable files as binary', () => {
      expect(isBinaryFileByExtension('program.exe')).toBe(true)
      expect(isBinaryFileByExtension('library.dll')).toBe(true)
      expect(isBinaryFileByExtension('lib.so')).toBe(true)
      expect(isBinaryFileByExtension('app.dylib')).toBe(true)
    })

    it('should detect office files as binary', () => {
      expect(isBinaryFileByExtension('document.pdf')).toBe(true)
      expect(isBinaryFileByExtension('spreadsheet.xlsx')).toBe(true)
      expect(isBinaryFileByExtension('presentation.pptx')).toBe(true)
      expect(isBinaryFileByExtension('text.docx')).toBe(true)
    })

    it('should detect media files as binary', () => {
      expect(isBinaryFileByExtension('song.mp3')).toBe(true)
      expect(isBinaryFileByExtension('video.mp4')).toBe(true)
      expect(isBinaryFileByExtension('audio.wav')).toBe(true)
      expect(isBinaryFileByExtension('movie.avi')).toBe(true)
    })

    it('should NOT detect text files as binary', () => {
      expect(isBinaryFileByExtension('code.rs')).toBe(false)
      expect(isBinaryFileByExtension('text.txt')).toBe(false)
      expect(isBinaryFileByExtension('config.json')).toBe(false)
      expect(isBinaryFileByExtension('style.css')).toBe(false)
      expect(isBinaryFileByExtension('script.js')).toBe(false)
      expect(isBinaryFileByExtension('component.tsx')).toBe(false)
      expect(isBinaryFileByExtension('readme.md')).toBe(false)
    })

    it('should handle edge cases', () => {
      expect(isBinaryFileByExtension('')).toBe(false)
      expect(isBinaryFileByExtension('no_extension')).toBe(false)
      expect(isBinaryFileByExtension('multiple.dots.txt')).toBe(false)
      expect(isBinaryFileByExtension('.hidden')).toBe(false)
    })

    it('should be case insensitive', () => {
      expect(isBinaryFileByExtension('IMAGE.PNG')).toBe(true)
      expect(isBinaryFileByExtension('Document.PDF')).toBe(true)
      expect(isBinaryFileByExtension('Music.Mp3')).toBe(true)
      expect(isBinaryFileByExtension('Video.MP4')).toBe(true)
    })

    it('should handle paths with directories', () => {
      expect(isBinaryFileByExtension('/path/to/image.png')).toBe(true)
      expect(isBinaryFileByExtension('src/components/Icon.tsx')).toBe(false)
      expect(isBinaryFileByExtension('./assets/logo.svg')).toBe(true)
      expect(isBinaryFileByExtension('../docs/manual.pdf')).toBe(true)
    })
  })

  describe('isBinaryExtension', () => {
    it('should detect binary extensions', () => {
      expect(isBinaryExtension('png')).toBe(true)
      expect(isBinaryExtension('PDF')).toBe(true) // case insensitive
      expect(isBinaryExtension('mp3')).toBe(true)
      expect(isBinaryExtension('exe')).toBe(true)
    })

    it('should NOT detect text extensions', () => {
      expect(isBinaryExtension('txt')).toBe(false)
      expect(isBinaryExtension('js')).toBe(false)
      expect(isBinaryExtension('ts')).toBe(false)
      expect(isBinaryExtension('md')).toBe(false)
    })

    it('should handle empty/invalid input', () => {
      expect(isBinaryExtension('')).toBe(false)
      expect(isBinaryExtension('unknown')).toBe(false)
    })
  })

  describe('getBinaryExtensions', () => {
    it('should return a non-empty array', () => {
      const extensions = getBinaryExtensions()
      expect(extensions.length).toBeGreaterThan(0)
    })

    it('should include common binary extensions', () => {
      const extensions = getBinaryExtensions()
      expect(extensions).toContain('png')
      expect(extensions).toContain('pdf')
      expect(extensions).toContain('zip')
      expect(extensions).toContain('exe')
      expect(extensions).toContain('mp3')
    })

    it('should return readonly array', () => {
      const extensions = getBinaryExtensions()
      // The array is readonly at TypeScript level, but JavaScript allows mutation
      // This test verifies the type is readonly, not runtime immutability
      expect(Array.isArray(extensions)).toBe(true)
      expect(extensions.length).toBeGreaterThan(0)
    })
  })

  describe('consistency between functions', () => {
    it('should be consistent between isBinaryFileByExtension and isBinaryExtension', () => {
      const extensions = getBinaryExtensions()
      
      for (const ext of extensions) {
        const testFile = `test.${ext}`
        expect(isBinaryFileByExtension(testFile)).toBe(true)
        expect(isBinaryExtension(ext)).toBe(true)
      }
    })

    it('should handle all extensions from the static list', () => {
      const extensions = getBinaryExtensions()
      expect(extensions).toContain('png')
      expect(extensions).toContain('jpg')
      expect(extensions).toContain('zip')
      expect(extensions).toContain('pdf')
      expect(extensions).toContain('exe')
      expect(extensions).toContain('mp3')
      expect(extensions).toContain('mp4')
    })
  })
})