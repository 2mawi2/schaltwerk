import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, type MockedFunction } from 'vitest'
import { CloneProjectDialog } from './CloneProjectDialog'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../../common/eventSystem', async () => {
  const actual = await vi.importActual<typeof import('../../common/eventSystem')>('../../common/eventSystem')
  return {
    ...actual,
    listenEvent: vi.fn()
  }
})

const invoke = (await import('@tauri-apps/api/core')).invoke as MockedFunction<
  (cmd: string, args?: unknown) => Promise<unknown>
>
const dialog = await import('@tauri-apps/plugin-dialog')
const dialogOpenMock = dialog.open as MockedFunction<
  (options?: unknown) => Promise<string | null>
>
const eventSystem = await import('../../common/eventSystem')
const listenEvent = eventSystem.listenEvent as MockedFunction<
  (event: unknown, handler: (payload: MockProgressPayload) => void) => Promise<() => void>
>
type MockProgressPayload = { message: string, requestId: string, remote: string, kind: 'info' | 'success' | 'error' }
let baseInvokeImpl: ((cmd: string, args?: unknown) => Promise<unknown>) | null = null

describe('CloneProjectDialog', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()

    baseInvokeImpl = async (cmd: string) => {
      switch (cmd) {
        case TauriCommands.GetLastProjectParentDirectory:
          return '/home/user'
        case TauriCommands.SetLastProjectParentDirectory:
          return null
        case TauriCommands.SchaltwerkCoreCloneProject:
          return {
            projectPath: '/home/user/projects/alpha',
            defaultBranch: 'main',
            remote: 'github.com/example/alpha'
          }
        default:
          return null
      }
    }
    invoke.mockImplementation((cmd: string, args?: unknown) => baseInvokeImpl!(cmd, args))

    dialogOpenMock.mockResolvedValue('/home/user/projects')
    listenEvent.mockResolvedValue(() => {})
  })

  function setup(props: Partial<Parameters<typeof CloneProjectDialog>[0]> = {}) {
    const onClose = vi.fn()
    const onProjectCloned = vi.fn()

    render(
      <CloneProjectDialog
        isOpen={true}
        onClose={onClose}
        onProjectCloned={onProjectCloned}
        {...props}
      />
    )

    return { onClose, onProjectCloned }
  }

  it('renders modal and loads defaults', async () => {
    setup()

    expect(await screen.findByRole('heading', { name: /clone git repository/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/remote url/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText(/parent directory/i)).toHaveDisplayValue('/home/user')
    })
  })

  it('derives folder name from remote and enables clone button when form is valid', async () => {
    setup()

    const remoteInput = await screen.findByLabelText(/remote url/i)
    const cloneButton = screen.getByRole('button', { name: /clone project/i })

    expect(cloneButton).toBeDisabled()

    await user.type(remoteInput, 'git@github.com:mariusw/new-repo.git')

    await waitFor(() => {
      expect(screen.getByText(/new-repo$/i)).toBeInTheDocument()
    })

    expect(cloneButton).not.toBeDisabled()
  })

  it('invokes clone command with sanitized payload and opens project by default', async () => {
    const { onProjectCloned, onClose } = setup()

    const remoteInput = await screen.findByLabelText(/remote url/i)
    await user.type(remoteInput, 'https://github.com/example/alpha.git')

    const cloneButton = screen.getByRole('button', { name: /clone project/i })
    await user.click(cloneButton)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SetLastProjectParentDirectory, { path: '/home/user' })
    })

    const cloneCall = invoke.mock.calls.find(([cmd]) => cmd === TauriCommands.SchaltwerkCoreCloneProject)
    expect(cloneCall?.[1]).toEqual(expect.objectContaining({
      remoteUrl: 'https://github.com/example/alpha.git',
      parentDirectory: '/home/user',
      folderName: 'alpha',
      requestId: expect.any(String)
    }))

    await waitFor(() => {
      expect(onProjectCloned).toHaveBeenCalledWith('/home/user/projects/alpha', true)
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('updates progress message from clone progress events', async () => {
    let progressHandler: (payload: MockProgressPayload) => void = () => {}
    listenEvent.mockImplementation(async (_event, handler) => {
      progressHandler = handler
      return () => {}
    })

    const defaultImpl = baseInvokeImpl!
    let resolveClone: () => void = () => {}
    const clonePromise = new Promise((resolve) => {
      resolveClone = () => resolve({
        projectPath: '/home/user/projects/alpha',
        defaultBranch: 'main',
        remote: 'github.com/example/alpha'
      })
    })

    invoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === TauriCommands.SchaltwerkCoreCloneProject) {
        return clonePromise
      }
      return defaultImpl(cmd, args)
    })

    setup()

    const remoteInput = await screen.findByLabelText(/remote url/i)
    await user.type(remoteInput, 'https://github.com/example/alpha.git')
    const cloneButton = screen.getByRole('button', { name: /clone project/i })
    await user.click(cloneButton)

    const cloneCall = invoke.mock.calls.find(([cmd]) => cmd === TauriCommands.SchaltwerkCoreCloneProject)
    const requestPayload = cloneCall?.[1] as { requestId?: string } | undefined
    if (!requestPayload?.requestId) {
      throw new Error('Expected clone invocation to include a requestId')
    }
    const { requestId } = requestPayload

    // Simulate backend progress event
    await act(async () => {
      progressHandler({
        requestId,
        message: 'receiving objects: 42%',
        remote: 'github.com/example/alpha',
        kind: 'info'
      })
    })

    expect(await screen.findByText(/receiving objects/i)).toBeInTheDocument()
    await act(async () => {
      resolveClone()
    })
  })
})
