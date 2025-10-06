import { act } from '@testing-library/react'

export async function flushPromises(times = 2) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}
