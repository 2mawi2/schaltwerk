import { describe, it, expect, beforeEach, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { renderHook, act } from '@testing-library/react'
import { SelectionProvider, useSelection } from './SelectionContext'
import { ProjectProvider, useProject } from './ProjectContext'
import { FocusProvider } from './FocusContext'
import { FontSizeProvider } from './FontSizeContext'
import React from 'react'

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => {})),
    emit: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <ProjectProvider>
        <FontSizeProvider>
            <FocusProvider>
                <SelectionProvider>
                    {children}
                </SelectionProvider>
            </FocusProvider>
        </FontSizeProvider>
    </ProjectProvider>
)

describe('Project Switching Selection Behavior', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
        
        // Setup default mocks
        mockInvoke.mockImplementation((command: string, args?: any) => {
            switch (command) {
                case 'get_current_directory':
                    return Promise.resolve('/test/cwd')
                case 'terminal_exists':
                    return Promise.resolve(false)
                case 'create_terminal':
                    return Promise.resolve()
                case 'para_core_get_session':
                    return Promise.resolve({
                        worktree_path: '/test/session/path',
                        session_id: args?.name || 'test-session'
                    })
                case 'get_project_selection':
                    // Database returns null initially
                    return Promise.resolve(null)
                case 'set_project_selection':
                    // Database saves selection
                    return Promise.resolve()
                default:
                    return Promise.resolve()
            }
        })
    })

    describe('Basic Selection Functionality', () => {
        it('should start with orchestrator selection', async () => {
            const { result } = renderHook(() => useSelection(), { wrapper: TestWrapper })

            await waitFor(() => {
                expect(result.current.selection.kind).toBe('orchestrator')
            })
        })

        it('should allow setting a session selection', async () => {
            const { result } = renderHook(() => useSelection(), { wrapper: TestWrapper })

            await act(async () => {
                await result.current.setSelection({
                    kind: 'session',
                    payload: 'test-session',
                    worktreePath: '/test/path'
                })
            })

            await waitFor(() => {
                expect(result.current.selection).toEqual({
                    kind: 'session',
                    payload: 'test-session',
                    worktreePath: '/test/path'
                })
            })
        })

        it('should handle switching to the same project gracefully', async () => {
            const { result } = renderHook(
                () => ({
                    selection: useSelection(),
                    project: useProject()
                }),
                { wrapper: TestWrapper }
            )

            const project = '/same/project'

            act(() => {
                result.current.project.setProjectPath(project)
            })

            await waitFor(() => {
                expect(result.current.selection.selection).toEqual({ kind: 'orchestrator' })
            })

            act(() => {
                result.current.selection.setSelection({ kind: 'session', payload: 'my-session' })
            })

            await waitFor(() => {
                expect(result.current.selection.selection).toEqual({ kind: 'session', payload: 'my-session' })
            })

            // Switch to the same project again
            act(() => {
                result.current.project.setProjectPath(project)
            })

            // Selection should remain unchanged
            await waitFor(() => {
                expect(result.current.selection.selection).toEqual({ kind: 'session', payload: 'my-session' })
            })
        })

        it('should handle null project path gracefully', async () => {
            const { result } = renderHook(
                () => ({
                    selection: useSelection(),
                    project: useProject()
                }),
                { wrapper: TestWrapper }
            )

            // Start with a project
            act(() => {
                result.current.project.setProjectPath('/some/project')
            })

            act(() => {
                result.current.selection.setSelection({ kind: 'session', payload: 'session1' })
            })

            // Set project to null (e.g., going to home screen)
            act(() => {
                result.current.project.setProjectPath(null)
            })

            // Should handle null gracefully
            expect(() => {
                act(() => {
                    result.current.selection.setSelection({ kind: 'orchestrator' })
                })
            }).not.toThrow()
        })
    })
})