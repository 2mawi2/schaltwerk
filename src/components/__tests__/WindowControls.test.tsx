import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WindowControls } from '../WindowControls'

const mockWindow = {
  minimize: vi.fn().mockResolvedValue(undefined),
  maximize: vi.fn().mockResolvedValue(undefined),
  unmaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false),
  onResized: vi.fn().mockResolvedValue(() => {}),
}

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mockWindow,
}))

describe('WindowControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all three control buttons', () => {
    render(<WindowControls />)

    expect(screen.getByTestId('window-minimize')).toBeInTheDocument()
    expect(screen.getByTestId('window-maximize')).toBeInTheDocument()
    expect(screen.getByTestId('window-close')).toBeInTheDocument()
  })

  it('calls minimize when minimize button is clicked', async () => {
    render(<WindowControls />)

    const minimizeBtn = screen.getByTestId('window-minimize')
    fireEvent.click(minimizeBtn)

    await waitFor(() => {
      expect(mockWindow.minimize).toHaveBeenCalledTimes(1)
    })
  })

  it('calls maximize when maximize button is clicked', async () => {
    render(<WindowControls />)

    const maximizeBtn = screen.getByTestId('window-maximize')
    fireEvent.click(maximizeBtn)

    await waitFor(() => {
      expect(mockWindow.maximize).toHaveBeenCalledTimes(1)
    })
  })

  it('calls unmaximize when maximize button is clicked while maximized', async () => {
    mockWindow.isMaximized.mockResolvedValue(true)

    render(<WindowControls />)

    await waitFor(() => {
      expect(mockWindow.isMaximized).toHaveBeenCalled()
    })

    const maximizeBtn = screen.getByTestId('window-maximize')
    fireEvent.click(maximizeBtn)

    await waitFor(() => {
      expect(mockWindow.unmaximize).toHaveBeenCalledTimes(1)
    })
  })

  it('calls close when close button is clicked', async () => {
    render(<WindowControls />)

    const closeBtn = screen.getByTestId('window-close')
    fireEvent.click(closeBtn)

    await waitFor(() => {
      expect(mockWindow.close).toHaveBeenCalledTimes(1)
    })
  })
})
