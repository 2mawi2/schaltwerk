import { createContext, useContext, ReactNode } from 'react'
import { GithubIntegrationValue, useGithubIntegration } from '../hooks/useGithubIntegration'

export const GithubIntegrationContext = createContext<GithubIntegrationValue | undefined>(undefined)

export function GithubIntegrationProvider({ children }: { children: ReactNode }) {
  const value = useGithubIntegration()
  return (
    <GithubIntegrationContext.Provider value={value}>
      {children}
    </GithubIntegrationContext.Provider>
  )
}

export function useGithubIntegrationContext(): GithubIntegrationValue {
  const context = useContext(GithubIntegrationContext)
  if (!context) {
    throw new Error('useGithubIntegrationContext must be used within GithubIntegrationProvider')
  }
  return context
}
