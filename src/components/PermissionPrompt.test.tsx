import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PermissionPrompt } from './PermissionPrompt'
import { TauriCommands } from '../common/tauriCommands'

const mockRequestPermission = vi.fn()
const mockCheckPermission = vi.fn()
const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('../hooks/usePermissions', () => ({
  useFolderPermission: () => ({
    hasPermission: false,
    isChecking: false,
    permissionError: null,
    deniedPath: '/Users/test/Documents/project',
    requestPermission: mockRequestPermission,
    checkPermission: mockCheckPermission,
  }),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

describe('PermissionPrompt', () => {
  const diagnostics = {
    bundleIdentifier: 'com.mariuswichtner.schaltwerk',
    executablePath: '/Applications/Schaltwerk.app/Contents/MacOS/schaltwerk',
    installKind: 'app-bundle' as const,
    appDisplayName: 'Schaltwerk',
  }

  beforeEach(() => {
    mockInvoke.mockReset()
    mockRequestPermission.mockReset()
    mockCheckPermission.mockReset()

    mockInvoke.mockResolvedValue(diagnostics)

    mockRequestPermission.mockResolvedValue(false)
    mockCheckPermission.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fetches permission diagnostics and displays guidance', async () => {
    render(<PermissionPrompt folderPath="/Users/test/Documents/project" />)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetPermissionDiagnostics)
    })

    expect(
      await screen.findByText(/Enable Documents access for Schaltwerk in System Settings/i)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Current executable:/i)
    ).toHaveTextContent(diagnostics.executablePath)
  })

  it('opens system settings when requested', async () => {
    render(<PermissionPrompt folderPath="/Users/test/Documents/project" />)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetPermissionDiagnostics)
    })

    mockInvoke.mockClear()

    const button = await screen.findByRole('button', { name: /Open System Settings/i })
    fireEvent.click(button)

    expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.OpenDocumentsPrivacySettings)
  })

  it('resets permissions when user selects reset option', async () => {
    render(<PermissionPrompt folderPath="/Users/test/Documents/project" />)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetPermissionDiagnostics)
    })

    mockInvoke.mockClear()

    const button = await screen.findByRole('button', { name: /Reset Folder Access/i })
    fireEvent.click(button)

    expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.ResetFolderPermissions)
  })
})
