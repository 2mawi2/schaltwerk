import { describe, it, expect, vi, beforeEach } from 'vitest'

let searchImportCount = 0
let webglImportCount = 0

vi.mock('@xterm/addon-search', () => {
  searchImportCount += 1
  return {
    SearchAddon: class MockSearchAddon {},
  }
})

vi.mock('@xterm/addon-webgl', () => {
  webglImportCount += 1
  return {
    WebglAddon: class MockWebglAddon {},
  }
})

describe('XtermAddonImporter', () => {
  beforeEach(async () => {
    searchImportCount = 0
    webglImportCount = 0
    vi.resetModules()
    const { XtermAddonImporter } = await vi.importActual<typeof import('./xtermAddonImporter')>('./xtermAddonImporter')
    XtermAddonImporter.__resetCacheForTests()
  })

  it('caches addon constructors across calls', async () => {
    const { XtermAddonImporter } = await import('./xtermAddonImporter')
    const importer = new XtermAddonImporter()

    const firstCtor = await importer.importAddon('search')
    const secondCtor = await importer.importAddon('search')

    expect(firstCtor).toBe(secondCtor)
    expect(searchImportCount).toBe(1)
  })

  it('reuses cache across importer instances', async () => {
    const { XtermAddonImporter } = await import('./xtermAddonImporter')
    const importerA = new XtermAddonImporter()
    const importerB = new XtermAddonImporter()

    const ctorA = await importerA.importAddon('webgl')
    const ctorB = await importerB.importAddon('webgl')

    expect(ctorA).toBe(ctorB)
    expect(webglImportCount).toBe(1)
  })

  it('throws when an addon module cannot be resolved', async () => {
    vi.doMock('@xterm/addon-serialize', () => {
      throw new Error('serialize load failed')
    })
    const { XtermAddonImporter } = await import('./xtermAddonImporter')
    const importer = new XtermAddonImporter()

    await expect(
      importer.importAddon('serialize'),
    ).rejects.toThrow(/Could not load addon serialize/)
    vi.unmock('@xterm/addon-serialize')
    vi.resetModules()
  })
})
