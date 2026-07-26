import { beforeEach } from 'vitest'

const createMemoryStorage = () => {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => {
      store.clear()
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
  }
}

for (const prop of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, prop, {
    configurable: true,
    value: createMemoryStorage(),
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
