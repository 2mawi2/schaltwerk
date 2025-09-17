import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { SettingsArchivesSection } from '../SettingsArchivesSection'
import { TauriCommands } from '../../../common/tauriCommands'

describe('SettingsArchivesSection', () => {
  const invokeMock = vi.mocked(invoke)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renders loading indicator while fetching archives', async () => {
    const deferredArchives = createDeferred<unknown>()
    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListArchivedSpecs:
          return deferredArchives.promise as ReturnType<typeof invoke>
        case TauriCommands.SchaltwerkCoreGetArchiveMaxEntries:
          return Promise.resolve(50) as ReturnType<typeof invoke>
        default:
          return Promise.reject(new Error(`Unexpected command: ${command as string}`))
      }
    })

    render(
      <SettingsArchivesSection
        onClose={vi.fn()}
        onOpenSpec={vi.fn()}
        onNotify={vi.fn()}
      />
    )

    expect(screen.getByLabelText('SCHALTWERK 3D assembled logo')).toBeInTheDocument()

    deferredArchives.resolve([])
    await waitFor(() => expect(screen.getByText('No archived specs.')).toBeInTheDocument())
  })

  test('renders archives and notifies parent when a spec is selected', async () => {
    const archives = [
      {
        id: '1',
        session_name: 'Spec Alpha',
        repository_path: '/tmp/spec-alpha',
        repository_name: 'spec-alpha',
        content: '# Spec Alpha',
        archived_at: 1_700_000_000_000
      }
    ]

    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListArchivedSpecs:
          return Promise.resolve(archives) as ReturnType<typeof invoke>
        case TauriCommands.SchaltwerkCoreGetArchiveMaxEntries:
          return Promise.resolve(99) as ReturnType<typeof invoke>
        default:
          return Promise.reject(new Error(`Unexpected command: ${command as string}`))
      }
    })

    const onOpenSpec = vi.fn()

    render(
      <SettingsArchivesSection
        onClose={vi.fn()}
        onOpenSpec={onOpenSpec}
        onNotify={vi.fn()}
      />
    )

    await waitFor(() => expect(screen.getByText('Spec Alpha')).toBeInTheDocument())

    await userEvent.click(screen.getByText('Spec Alpha'))

    expect(onOpenSpec).toHaveBeenCalledWith({
      name: 'Spec Alpha',
      content: '# Spec Alpha'
    })
  })

  test('shows empty state when no archives are returned', async () => {
    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListArchivedSpecs:
          return Promise.resolve([]) as ReturnType<typeof invoke>
        case TauriCommands.SchaltwerkCoreGetArchiveMaxEntries:
          return Promise.resolve(25) as ReturnType<typeof invoke>
        default:
          return Promise.reject(new Error(`Unexpected command: ${command as string}`))
      }
    })

    render(
      <SettingsArchivesSection
        onClose={vi.fn()}
        onOpenSpec={vi.fn()}
        onNotify={vi.fn()}
      />
    )

    await waitFor(() => expect(screen.getByText('No archived specs.')).toBeInTheDocument())
  })

  test('prevents state updates after unmounting during fetch', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deferredArchives = createDeferred<unknown>()

    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListArchivedSpecs:
          return deferredArchives.promise as ReturnType<typeof invoke>
        case TauriCommands.SchaltwerkCoreGetArchiveMaxEntries:
          return Promise.resolve(10) as ReturnType<typeof invoke>
        default:
          return Promise.reject(new Error(`Unexpected command: ${command as string}`))
      }
    })

    const { unmount } = render(
      <SettingsArchivesSection
        onClose={vi.fn()}
        onOpenSpec={vi.fn()}
        onNotify={vi.fn()}
      />
    )

    unmount()

    deferredArchives.resolve([])
    await flushMicrotasks()

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Can't perform a React state update on an unmounted component")
    )

    consoleErrorSpy.mockRestore()
  })
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}
