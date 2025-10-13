import { render, screen, waitFor } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import userEvent from '@testing-library/user-event'
import { NewProjectDialog } from './NewProjectDialog'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn() }))

const invoke = (await import('@tauri-apps/api/core')).invoke as unknown as ReturnType<typeof vi.fn>
const dialog = await import('@tauri-apps/plugin-dialog')
const path = await import('@tauri-apps/api/path')

describe('NewProjectDialog', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    invoke.mockReset()
    ;(dialog.open as ReturnType<typeof vi.fn>).mockReset()
    ;(path.homeDir as ReturnType<typeof vi.fn>).mockResolvedValue('/home/user')
  })

  function setup(props: Partial<Parameters<typeof NewProjectDialog>[0]> = {}) {
    const onClose = vi.fn()
    const onProjectCreated = vi.fn()
    
    const result = render(
      <NewProjectDialog
        isOpen={true}
        onClose={onClose}
        onProjectCreated={onProjectCreated}
        {...props}
      />
    )
    
    return { onClose, onProjectCreated, ...result }
  }

  it('does not render when closed', () => {
    render(
      <NewProjectDialog
        isOpen={false}
        onClose={vi.fn()}
        onProjectCreated={vi.fn()}
      />
    )
    
    expect(screen.queryByText('New Project')).not.toBeInTheDocument()
  })

  it('renders dialog when open', async () => {
    setup()
    
    expect(screen.getByRole('heading', { name: 'New Project' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/my-awesome-project/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /browse/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('disables create button when project name is empty', async () => {
    const { onProjectCreated } = setup()
    
    const createBtn = screen.getByRole('button', { name: /create project/i })
    
    // Button should be disabled when name is empty
    expect(createBtn).toBeDisabled()
    expect(onProjectCreated).not.toHaveBeenCalled()
  })

  it('validates project name with invalid characters', async () => {
    const { onProjectCreated } = setup()
    
    const nameInput = screen.getByPlaceholderText(/my-awesome-project/i)
    await user.click(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, 'project<>name')
    
    const createBtn = screen.getByRole('button', { name: /create project/i })
    await user.click(createBtn)
    
    expect(await screen.findByText('Project name contains invalid characters')).toBeInTheDocument()
    expect(onProjectCreated).not.toHaveBeenCalled()
  })

  it('disables buttons while creating', async () => {
    let resolvePromise: () => void
    const createPromise = new Promise<string>(resolve => {
      resolvePromise = () => resolve('/home/user/test-project')
    })
    invoke.mockReturnValue(createPromise)
    const { onClose } = setup()

    const nameInput = screen.getByPlaceholderText(/my-awesome-project/i)
    await user.click(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, 'test-project')

    const createBtn = screen.getByRole('button', { name: /create project/i })
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    const browseBtn = screen.getByRole('button', { name: /browse/i })

    await user.click(createBtn)

    expect(createBtn).toBeDisabled()
    expect(cancelBtn).toBeDisabled()
    expect(browseBtn).toBeDisabled()
    expect(nameInput).toBeDisabled()

    await waitFor(() => {
      // The button now uses AnimatedText component for loading state
      const animatedTextElement = createBtn.querySelector('pre')
      expect(animatedTextElement).toBeInTheDocument()
    })

    // Resolve the promise and wait for the component to finish cleanup
    resolvePromise!()
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('validates invalid filename characters', async () => {
    const { onProjectCreated } = setup()

    // Wait for parent path to be initialized
    await waitFor(() => {
      expect(screen.getByDisplayValue('/home/user')).toBeInTheDocument()
    })

    const nameInput = screen.getByPlaceholderText(/my-awesome-project/i)
    await user.click(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, 'project<name')

    const createBtn = screen.getByRole('button', { name: /create project/i })
    await user.click(createBtn)

    expect(await screen.findByText('Project name contains invalid characters')).toBeInTheDocument()
    expect(onProjectCreated).not.toHaveBeenCalled()
  })

  it('allows valid project names', async () => {
    invoke.mockResolvedValue('/home/user/my-project')
    const { onClose } = setup()

    // Wait for parent path to be initialized
    await waitFor(() => {
      expect(screen.getByDisplayValue('/home/user')).toBeInTheDocument()
    })

    const nameInput = screen.getByPlaceholderText(/my-awesome-project/i)
    await user.click(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, 'my-project')

    const createBtn = screen.getByRole('button', { name: /create project/i })
    await user.click(createBtn)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.CreateNewProject, {
        name: 'my-project',
        parentPath: '/home/user'
      })
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('handles directory selection', async () => {
    setup()
    ;(dialog.open as ReturnType<typeof vi.fn>).mockResolvedValue('/custom/path')

    const browseBtn = screen.getByRole('button', { name: /browse/i })
    await user.click(browseBtn)

    await waitFor(() => {
      expect(screen.getByDisplayValue('/custom/path')).toBeInTheDocument()
    })
  })

  it('creates project successfully', async () => {
    invoke.mockResolvedValue('/home/user/test-project')
    const { onProjectCreated, onClose } = setup()

    const nameInput = screen.getByPlaceholderText(/my-awesome-project/i)
    await user.click(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, 'test-project')

    const createBtn = screen.getByRole('button', { name: /create project/i })
    await user.click(createBtn)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.CreateNewProject, {
        name: 'test-project',
        parentPath: '/home/user'
      })
      expect(onProjectCreated).toHaveBeenCalledWith('/home/user/test-project')
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('shows error when project creation fails', async () => {
    invoke.mockRejectedValue('Failed to create project')
    const { onProjectCreated } = setup()

    const nameInput = screen.getByPlaceholderText(/my-awesome-project/i)
    await user.click(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, 'test-project')

    const createBtn = screen.getByRole('button', { name: /create project/i })
    await user.click(createBtn)

    expect(await screen.findByText(/Failed to create project/i)).toBeInTheDocument()

    // Wait for isCreating to be reset to avoid state update after unmount
    await waitFor(() => {
      const button = screen.getByRole('button', { name: /create project/i })
      expect(button).not.toBeDisabled()
    })

    expect(onProjectCreated).not.toHaveBeenCalled()
  })

  it('closes dialog on Cancel button', async () => {
    const { onClose } = setup()

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelBtn)

    expect(onClose).toHaveBeenCalled()
  })

  it('closes dialog on Escape key', async () => {
    const { onClose } = setup()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('creates project on Enter key', async () => {
    invoke.mockResolvedValue('/home/user/test-project')
    const { onProjectCreated } = setup()

    const nameInput = screen.getByPlaceholderText(/my-awesome-project/i)
    await user.click(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, 'test-project')

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.CreateNewProject, {
        name: 'test-project',
        parentPath: '/home/user'
      })
      expect(onProjectCreated).toHaveBeenCalledWith('/home/user/test-project')
    })
  })

  it('trims whitespace from project name', async () => {
    invoke.mockResolvedValue('/home/user/test-project')
    setup()

    const nameInput = screen.getByPlaceholderText(/my-awesome-project/i)
    await user.click(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, '  test-project  ')

    const createBtn = screen.getByRole('button', { name: /create project/i })
    await user.click(createBtn)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.CreateNewProject, {
        name: 'test-project',
        parentPath: '/home/user'
      })
    })
  })

  it('shows project path preview', async () => {
    setup()

    const nameInput = screen.getByPlaceholderText(/my-awesome-project/i)
    await user.click(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, 'my-project')

    expect(screen.getByText('/home/user/my-project')).toBeInTheDocument()
  })
})