import { createContext, useContext, type ReactNode } from 'react'
import { useGitlabIntegration, type GitlabIntegrationValue } from '../hooks/useGitlabIntegration'

export const GitlabIntegrationContext = createContext<GitlabIntegrationValue | undefined>(undefined)

export function GitlabIntegrationProvider({ children }: { children: ReactNode }) {
  const value = useGitlabIntegration()
  return (
    <GitlabIntegrationContext.Provider value={value}>
      {children}
    </GitlabIntegrationContext.Provider>
  )
}

export function useGitlabIntegrationContext(): GitlabIntegrationValue {
  const context = useContext(GitlabIntegrationContext)
  if (!context) {
    throw new Error('useGitlabIntegrationContext must be used within GitlabIntegrationProvider')
  }
  return context
}
