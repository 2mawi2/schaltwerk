import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { renderHook, act } from '@testing-library/react'
import { SelectionProvider, useSelection } from './SelectionContext'
import { ProjectProvider, useProject } from './ProjectContext'
import { FocusProvider } from './FocusContext'
import React from 'react'

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => {})),
    emit: vi.fn(),
}))

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <ProjectProvider>
        <FocusProvider>
            <SelectionProvider>
                {children}
            </SelectionProvider>
        </FocusProvider>
    </ProjectProvider>
)

describe('Project Switching Selection Behavior', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    describe('Selection Persistence Across Project Switches', () => {
        it('should restore previous selection when switching back to a project', async () => {
            const TestComponent = () => {
                const { selection, setSelection } = useSelection()
                const { projectPath, setProjectPath } = useProject()
                
                return (
                    <div>
                        <div data-testid="project">{projectPath}</div>
                        <div data-testid="selection">{JSON.stringify(selection)}</div>
                        <button onClick={() => setProjectPath('/project1')}>Project 1</button>
                        <button onClick={() => setProjectPath('/project2')}>Project 2</button>
                        <button onClick={() => setSelection({ kind: 'session', payload: 'session1' })}>
                            Select Session 1
                        </button>
                        <button onClick={() => setSelection({ kind: 'session', payload: 'session2' })}>
                            Select Session 2
                        </button>
                    </div>
                )
            }

            const { getByText, getByTestId } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            )

            // Switch to project 1
            act(() => {
                getByText('Project 1').click()
            })

            await waitFor(() => {
                expect(getByTestId('project').textContent).toBe('/project1')
            })

            // Select a session in project 1
            act(() => {
                getByText('Select Session 1').click()
            })

            await waitFor(() => {
                const selection = JSON.parse(getByTestId('selection').textContent!)
                expect(selection).toEqual({ kind: 'session', payload: 'session1' })
            })

            // Switch to project 2
            act(() => {
                getByText('Project 2').click()
            })

            await waitFor(() => {
                expect(getByTestId('project').textContent).toBe('/project2')
            })

            // Select a different session in project 2
            act(() => {
                getByText('Select Session 2').click()
            })

            await waitFor(() => {
                const selection = JSON.parse(getByTestId('selection').textContent!)
                expect(selection).toEqual({ kind: 'session', payload: 'session2' })
            })

            // Switch back to project 1
            act(() => {
                getByText('Project 1').click()
            })

            await waitFor(() => {
                expect(getByTestId('project').textContent).toBe('/project1')
            })

            // Should restore session1 selection, NOT reset to orchestrator
            await waitFor(() => {
                const selection = JSON.parse(getByTestId('selection').textContent!)
                expect(selection).toEqual({ kind: 'session', payload: 'session1' })
            }, { timeout: 2000 })
        })

        it('should NOT reset to orchestrator when switching between projects', async () => {
            const TestComponent = () => {
                const { selection, setSelection } = useSelection()
                const { setProjectPath } = useProject()
                
                return (
                    <div>
                        <div data-testid="selection-kind">{selection.kind}</div>
                        <div data-testid="selection-id">{selection.kind === 'session' ? selection.payload : 'none'}</div>
                        <button onClick={() => setProjectPath('/project-a')}>Project A</button>
                        <button onClick={() => setProjectPath('/project-b')}>Project B</button>
                        <button onClick={() => setSelection({ kind: 'session', payload: 'task-123' })}>
                            Select Task
                        </button>
                    </div>
                )
            }

            const { getByText, getByTestId } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            )

            // Set up project A with a task selection
            act(() => {
                getByText('Project A').click()
            })

            await waitFor(() => {
                expect(getByTestId('selection-kind').textContent).toBe('orchestrator')
            })

            act(() => {
                getByText('Select Task').click()
            })

            await waitFor(() => {
                expect(getByTestId('selection-kind').textContent).toBe('session')
                expect(getByTestId('selection-id').textContent).toBe('task-123')
            })

            // Switch to project B
            act(() => {
                getByText('Project B').click()
            })

            await waitFor(() => {
                expect(getByTestId('selection-kind').textContent).toBe('orchestrator')
            })

            // Switch back to project A
            act(() => {
                getByText('Project A').click()
            })

            // CRITICAL: Should restore task selection, not orchestrator
            await waitFor(() => {
                expect(getByTestId('selection-kind').textContent).toBe('session')
                expect(getByTestId('selection-id').textContent).toBe('task-123')
            }, { timeout: 2000 })
        })

        it('should save selection to localStorage per project', async () => {
            const { result } = renderHook(
                () => ({
                    selection: useSelection(),
                    project: useProject()
                }),
                { wrapper: TestWrapper }
            )

            const project1 = '/Users/test/project1'
            const project2 = '/Users/test/project2'

            // Set project 1 and select a session
            act(() => {
                result.current.project.setProjectPath(project1)
            })

            await waitFor(() => {
                expect(result.current.selection.selection).toEqual({ kind: 'orchestrator' })
            })

            act(() => {
                result.current.selection.setSelection({ kind: 'session', payload: 'session-p1' })
            })

            await waitFor(() => {
                const stored = localStorage.getItem('schaltwerk-selections')
                expect(stored).toBeTruthy()
                const parsed = JSON.parse(stored!)
                expect(parsed[project1]).toEqual({ kind: 'session', payload: 'session-p1' })
            })

            // Set project 2 and select a different session
            act(() => {
                result.current.project.setProjectPath(project2)
            })

            await waitFor(() => {
                expect(result.current.selection.selection).toEqual({ kind: 'orchestrator' })
            })

            act(() => {
                result.current.selection.setSelection({ kind: 'session', payload: 'session-p2' })
            })

            await waitFor(() => {
                const stored = localStorage.getItem('schaltwerk-selections')
                expect(stored).toBeTruthy()
                const parsed = JSON.parse(stored!)
                expect(parsed[project1]).toEqual({ kind: 'session', payload: 'session-p1' })
                expect(parsed[project2]).toEqual({ kind: 'session', payload: 'session-p2' })
            })
        })

        it('should use orchestrator for first-time project access', async () => {
            const { result } = renderHook(
                () => ({
                    selection: useSelection(),
                    project: useProject()
                }),
                { wrapper: TestWrapper }
            )

            const newProject = '/Users/test/brand-new-project'

            // Set a brand new project
            act(() => {
                result.current.project.setProjectPath(newProject)
            })

            // Should default to orchestrator for new projects
            await waitFor(() => {
                expect(result.current.selection.selection).toEqual({ kind: 'orchestrator' })
            })

            // Verify nothing was in localStorage for this project before
            const stored = localStorage.getItem('schaltwerk-selections')
            if (stored) {
                const parsed = JSON.parse(stored)
                // The new project should now be stored with orchestrator selection
                expect(parsed[newProject]).toEqual({ kind: 'orchestrator' })
            }
        })

        it('should handle rapid project switches correctly', async () => {
            const { result } = renderHook(
                () => ({
                    selection: useSelection(),
                    project: useProject()
                }),
                { wrapper: TestWrapper }
            )

            const project1 = '/project/one'
            const project2 = '/project/two'
            const project3 = '/project/three'

            // Set up selections for multiple projects
            act(() => {
                result.current.project.setProjectPath(project1)
            })

            await waitFor(() => {
                expect(result.current.selection.selection.kind).toBe('orchestrator')
            })

            act(() => {
                result.current.selection.setSelection({ kind: 'session', payload: 'p1-session' })
            })

            // Rapidly switch between projects
            act(() => {
                result.current.project.setProjectPath(project2)
            })

            act(() => {
                result.current.selection.setSelection({ kind: 'session', payload: 'p2-session' })
            })

            act(() => {
                result.current.project.setProjectPath(project3)
            })

            act(() => {
                result.current.selection.setSelection({ kind: 'session', payload: 'p3-session' })
            })

            // Switch back to project 1
            act(() => {
                result.current.project.setProjectPath(project1)
            })

            // Should restore the correct selection for project 1
            await waitFor(() => {
                expect(result.current.selection.selection).toEqual({ kind: 'session', payload: 'p1-session' })
            }, { timeout: 2000 })

            // Verify all selections are properly stored
            const stored = localStorage.getItem('schaltwerk-selections')
            expect(stored).toBeTruthy()
            const parsed = JSON.parse(stored!)
            expect(parsed[project1]).toEqual({ kind: 'session', payload: 'p1-session' })
            expect(parsed[project2]).toEqual({ kind: 'session', payload: 'p2-session' })
            expect(parsed[project3]).toEqual({ kind: 'session', payload: 'p3-session' })
        })
    })

    describe('Edge Cases', () => {
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