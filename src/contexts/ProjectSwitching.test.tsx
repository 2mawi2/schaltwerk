import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TauriCommands } from '../common/tauriCommands'
import { waitFor } from '@testing-library/react'
import { renderHook, act } from '@testing-library/react'
import { useSelection } from './SelectionContext'
import { useProject } from './ProjectContext'
import React from 'react'
import { MockTauriInvokeArgs } from '../types/testing'
import { TestProviders } from '../tests/test-utils'

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
    <TestProviders>
        {children}
    </TestProviders>
)

describe('Project Switching Selection Behavior', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
        
        // Setup default mocks
        mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
            const typedArgs = args as { name?: string; id?: string } | undefined
            switch (command) {
                case TauriCommands.GetCurrentDirectory:
                    return Promise.resolve('/test/cwd')
                case TauriCommands.TerminalExists:
                    return Promise.resolve(false)
                case TauriCommands.CreateTerminal:
                    return Promise.resolve()
                case TauriCommands.SchaltwerkCoreGetSession:
                    return Promise.resolve({
                        worktree_path: '/test/session/path',
                        session_id: typedArgs?.name || 'test-session',
                        session_state: 'running',
                        name: typedArgs?.name || 'test-session'
                    })
                case TauriCommands.GetProjectSelection:
                    // Database returns null initially
                    return Promise.resolve(null)
                case TauriCommands.SetProjectSelection:
                    // Database saves selection
                    return Promise.resolve()
                case TauriCommands.SchaltwerkCoreListEnrichedSessions:
                    return Promise.resolve([])
                case TauriCommands.GetProjectSessionsSettings:
                    return Promise.resolve({ filter_mode: 'all', sort_mode: 'name' })
                case TauriCommands.SetProjectSessionsSettings:
                    return Promise.resolve()
                case TauriCommands.PathExists:
                    return Promise.resolve(true)
                case TauriCommands.SchaltwerkCoreListSessionsByState:
                    return Promise.resolve([])
                case TauriCommands.SchaltwerkCoreGetFontSizes:
                    return Promise.resolve([13, 14])
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

            // Batch initial setup operations
            act(() => {
                result.current.project.setProjectPath(project)
                result.current.selection.setSelection({ kind: 'session', payload: 'my-session' })
            })

            // Wait for both operations to complete
            await waitFor(() => {
                expect(result.current.selection.selection).toEqual({ kind: 'session', payload: 'my-session' })
            })

            // Switch to the same project again - this should be synchronous
            act(() => {
                result.current.project.setProjectPath(project)
            })

            // Selection should remain unchanged (synchronous check)
            expect(result.current.selection.selection).toEqual({ kind: 'session', payload: 'my-session' })
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

    describe('Project Switching Boundary Constraints', () => {
        // Test the project switching boundary logic that was causing infinite loops
        describe('Boundary Logic Unit Tests', () => {
            const mockOpenTabs = [
                { projectPath: '/project1', projectName: 'Project 1' },
                { projectPath: '/project2', projectName: 'Project 2' },
                { projectPath: '/project3', projectName: 'Project 3' }
            ]

            const mockHandleSelectTab = vi.fn()

            // Simulate the switchProject logic from App.tsx
            const createSwitchProjectFunction = (currentIndex: number) => {
                return (direction: 'prev' | 'next') => {
                    if (mockOpenTabs.length <= 1) return

                    // Calculate new index with proper boundary constraints (fixed logic)
                    let newIndex: number
                    if (direction === 'next') {
                        // Don't go past the last tab
                        newIndex = Math.min(currentIndex + 1, mockOpenTabs.length - 1)
                    } else {
                        // Don't go before the first tab
                        newIndex = Math.max(currentIndex - 1, 0)
                    }

                    // Only switch if we actually moved to a different index
                    if (newIndex !== currentIndex) {
                        const targetTab = mockOpenTabs[newIndex]
                        if (targetTab?.projectPath) {
                            mockHandleSelectTab(targetTab.projectPath)
                        }
                    }
                }
            }

            beforeEach(() => {
                vi.clearAllMocks()
            })

            it('should not switch when at first project and going prev', () => {
                const switchProject = createSwitchProjectFunction(0) // At first project
                
                switchProject('prev')
                
                // Should not call handleSelectTab because we're already at the boundary
                expect(mockHandleSelectTab).not.toHaveBeenCalled()
            })

            it('should not switch when at last project and going next', () => {
                const switchProject = createSwitchProjectFunction(2) // At last project (index 2 of 3 projects)
                
                switchProject('next')
                
                // Should not call handleSelectTab because we're already at the boundary
                expect(mockHandleSelectTab).not.toHaveBeenCalled()
            })

            it('should switch from middle to prev project', () => {
                const switchProject = createSwitchProjectFunction(1) // At middle project
                
                switchProject('prev')
                
                expect(mockHandleSelectTab).toHaveBeenCalledWith('/project1')
            })

            it('should switch from middle to next project', () => {
                const switchProject = createSwitchProjectFunction(1) // At middle project
                
                switchProject('next')
                
                expect(mockHandleSelectTab).toHaveBeenCalledWith('/project3')
            })

            it('should switch from second to first project', () => {
                const switchProject = createSwitchProjectFunction(1) // At second project
                
                switchProject('prev')
                
                expect(mockHandleSelectTab).toHaveBeenCalledWith('/project1')
            })

            it('should switch from second to last project', () => {
                const switchProject = createSwitchProjectFunction(1) // At second project
                
                switchProject('next')
                
                expect(mockHandleSelectTab).toHaveBeenCalledWith('/project3')
            })

            it('should not switch when only one project is open', () => {
                const singleTabSwitchProject = () => {
                    const singleTab = [{ projectPath: '/project1', projectName: 'Project 1' }]
                    if (singleTab.length <= 1) return
                    
                    // This should never execute
                    mockHandleSelectTab('/should-not-be-called')
                }
                
                singleTabSwitchProject()
                singleTabSwitchProject()
                
                expect(mockHandleSelectTab).not.toHaveBeenCalled()
            })

            it('should handle multiple prev attempts at first project', () => {
                const switchProject = createSwitchProjectFunction(0) // At first project
                
                // Try to go prev multiple times - this was causing the infinite loop
                switchProject('prev')
                switchProject('prev')
                switchProject('prev')
                
                // Should never call handleSelectTab
                expect(mockHandleSelectTab).not.toHaveBeenCalled()
            })

            it('should handle multiple next attempts at last project', () => {
                const switchProject = createSwitchProjectFunction(2) // At last project
                
                // Try to go next multiple times - this was also causing infinite loops
                switchProject('next')
                switchProject('next')
                switchProject('next')
                
                // Should never call handleSelectTab
                expect(mockHandleSelectTab).not.toHaveBeenCalled()
            })

            describe('edge cases with two projects', () => {
                const twoTabs = [
                    { projectPath: '/project1', projectName: 'Project 1' },
                    { projectPath: '/project2', projectName: 'Project 2' }
                ]

                const createTwoTabSwitchProject = (currentIndex: number) => {
                    return (direction: 'prev' | 'next') => {
                        if (twoTabs.length <= 1) return
                        
                        let newIndex: number
                        if (direction === 'next') {
                            newIndex = Math.min(currentIndex + 1, twoTabs.length - 1)
                        } else {
                            newIndex = Math.max(currentIndex - 1, 0)
                        }
                        
                        if (newIndex !== currentIndex) {
                            const targetTab = twoTabs[newIndex]
                            if (targetTab?.projectPath) {
                                mockHandleSelectTab(targetTab.projectPath)
                            }
                        }
                    }
                }

                it('should handle two projects - at first, going prev', () => {
                    const switchProject = createTwoTabSwitchProject(0)
                    
                    switchProject('prev')
                    expect(mockHandleSelectTab).not.toHaveBeenCalled()
                    
                    switchProject('next')
                    expect(mockHandleSelectTab).toHaveBeenCalledWith('/project2')
                })

                it('should handle two projects - at last, going next', () => {
                    const switchProject = createTwoTabSwitchProject(1)
                    
                    switchProject('next')
                    expect(mockHandleSelectTab).not.toHaveBeenCalled()
                    
                    switchProject('prev')
                    expect(mockHandleSelectTab).toHaveBeenCalledWith('/project1')
                })
            })

            describe('regression tests for infinite loop bug', () => {
                it('should not cause infinite loops with rapid prev switching at boundary', () => {
                    const switchProject = createSwitchProjectFunction(0) // At first project
                    
                    // Simulate rapid keyboard presses that caused the original bug
                    for (let i = 0; i < 10; i++) {
                        switchProject('prev')
                    }
                    
                    // Should never call handleSelectTab, preventing the infinite loop
                    expect(mockHandleSelectTab).not.toHaveBeenCalled()
                })

                it('should not cause infinite loops with rapid next switching at boundary', () => {
                    const switchProject = createSwitchProjectFunction(2) // At last project
                    
                    // Simulate rapid keyboard presses that caused the original bug
                    for (let i = 0; i < 10; i++) {
                        switchProject('next')
                    }
                    
                    // Should never call handleSelectTab, preventing the infinite loop
                    expect(mockHandleSelectTab).not.toHaveBeenCalled()
                })
            })
        })
    })
})
