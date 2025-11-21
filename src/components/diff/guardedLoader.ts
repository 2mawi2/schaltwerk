export interface GuardedLoader {
  run: () => Promise<void>
  getState: () => { inFlight: boolean; pending: boolean }
}

/**
 * Wraps an async loader so concurrent triggers coalesce into a single follow-up run.
 */
export function createGuardedLoader(loader: () => Promise<void>): GuardedLoader {
  let inFlight = false
  let pending = false
  let currentPromise: Promise<void> | null = null

  const run = async () => {
    if (inFlight) {
      pending = true
      return currentPromise ?? Promise.resolve()
    }
    inFlight = true
    currentPromise = (async () => {
      try {
        await loader()
      } finally {
        inFlight = false
        if (pending) {
          pending = false
          await run()
        }
      }
    })()
    await currentPromise
  }

  return {
    run,
    getState: () => ({ inFlight, pending })
  }
}
