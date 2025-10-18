import type { FitAddon as FitAddonType } from '@xterm/addon-fit'
import type { ImageAddon as ImageAddonType } from '@xterm/addon-image'
import type { LigaturesAddon as LigaturesAddonType } from '@xterm/addon-ligatures'
import type { SearchAddon as SearchAddonType } from '@xterm/addon-search'
import type { SerializeAddon as SerializeAddonType } from '@xterm/addon-serialize'
import type { Unicode11Addon as Unicode11AddonType } from '@xterm/addon-unicode11'
import type { WebglAddon as WebglAddonType } from '@xterm/addon-webgl'

export interface IXtermAddonNameToCtor {
  fit: typeof FitAddonType
  image: typeof ImageAddonType
  ligatures: typeof LigaturesAddonType
  search: typeof SearchAddonType
  serialize: typeof SerializeAddonType
  unicode11: typeof Unicode11AddonType
  webgl: typeof WebglAddonType
}

type XtermAddonName = keyof IXtermAddonNameToCtor

interface IImportedXtermAddonMap
  extends Map<XtermAddonName, IXtermAddonNameToCtor[XtermAddonName]> {
  get<K extends XtermAddonName>(name: K): IXtermAddonNameToCtor[K] | undefined
  set<K extends XtermAddonName>(name: K, value: IXtermAddonNameToCtor[K]): this
}

const importedAddons: IImportedXtermAddonMap = new Map()

async function loadAddonCtor<T extends XtermAddonName>(name: T): Promise<IXtermAddonNameToCtor[T]> {
  try {
    switch (name) {
      case 'fit': {
        const module = await import('@xterm/addon-fit')
        return module.FitAddon as IXtermAddonNameToCtor[T]
      }
      case 'image': {
        const module = await import('@xterm/addon-image')
        return module.ImageAddon as IXtermAddonNameToCtor[T]
      }
      case 'ligatures': {
        const module = await import('@xterm/addon-ligatures')
        return module.LigaturesAddon as IXtermAddonNameToCtor[T]
      }
      case 'search': {
        const module = await import('@xterm/addon-search')
        return module.SearchAddon as IXtermAddonNameToCtor[T]
      }
      case 'serialize': {
        const module = await import('@xterm/addon-serialize')
        return module.SerializeAddon as IXtermAddonNameToCtor[T]
      }
      case 'unicode11': {
        const module = await import('@xterm/addon-unicode11')
        return module.Unicode11Addon as IXtermAddonNameToCtor[T]
      }
      case 'webgl': {
        const module = await import('@xterm/addon-webgl')
        return module.WebglAddon as IXtermAddonNameToCtor[T]
      }
      default: {
        throw new Error(`Unsupported addon ${String(name)}`)
      }
    }
  } catch (error) {
    const details = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(`Could not load addon ${name}${details}`)
  }
}

export class XtermAddonImporter {
  private readonly cache = importedAddons

  async importAddon<T extends XtermAddonName>(name: T): Promise<IXtermAddonNameToCtor[T]> {
    const cached = this.cache.get(name)
    if (cached) {
      return cached as IXtermAddonNameToCtor[T]
    }

    const ctor = await loadAddonCtor(name)
    this.cache.set(name, ctor)
    return ctor
  }

  static registerPreloadedAddon<T extends XtermAddonName>(name: T, ctor: IXtermAddonNameToCtor[T]): void {
    importedAddons.set(name, ctor)
  }

  /** Test-only helper to clear the shared addon cache. */
  static __resetCacheForTests(): void {
    importedAddons.clear()
  }
}
