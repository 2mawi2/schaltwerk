import { useState, useEffect, useRef } from 'react'
import { ModelSelector } from '../inputs/ModelSelector'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS } from '../../types/session'
import { logger } from '../../utils/logger'

interface Props {
  open: boolean
  onClose: () => void
  onSwitch: (options: { agentType: AgentType; skipPermissions: boolean }) => void | Promise<void>
  scope?: 'orchestrator' | 'session'
  initialAgentType?: AgentType
  initialSkipPermissions?: boolean
  targetSessionId?: string | null
}

const ORCHESTRATOR_ALLOWED_AGENTS: AgentType[] = AGENT_TYPES.filter(
  (agent): agent is AgentType => agent !== 'terminal'
)
const SESSION_ALLOWED_AGENTS = ORCHESTRATOR_ALLOWED_AGENTS
const DEFAULT_AGENT: AgentType = 'claude'

export function SwitchOrchestratorModal({
  open,
  onClose,
  onSwitch,
  scope,
  initialAgentType,
  initialSkipPermissions,
  targetSessionId,
}: Props) {
  const [agentType, setAgentType] = useState<AgentType>('claude')
  const [skipPermissions, setSkipPermissions] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const {
    getOrchestratorAgentType,
    getOrchestratorSkipPermissions,
    getAgentType,
    getSkipPermissions,
  } = useClaudeSession()
  const switchRef = useRef<() => void>(() => {})

  const derivedScope: 'orchestrator' | 'session' =
    scope ?? (targetSessionId ? 'session' : 'orchestrator')
  const isOrchestrator = derivedScope === 'orchestrator'
  const allowedAgents = isOrchestrator ? ORCHESTRATOR_ALLOWED_AGENTS : SESSION_ALLOWED_AGENTS
  const title = isOrchestrator ? 'Switch Orchestrator Agent' : 'Switch Session Agent'
  const warningBody = isOrchestrator
    ? 'Switching the orchestrator agent will restart the terminal and clear the current session history. Any unsaved work in the orchestrator terminal will be lost.'
    : `Switching the session agent${
        targetSessionId ? ` for ${targetSessionId}` : ''
      } will restart the terminal and clear the current session history. Any unsaved work in that terminal will be lost.`
  const helperText = isOrchestrator
    ? 'Choose the AI agent to use for the orchestrator terminal'
    : 'Choose the AI agent to use for this session terminal'

  const handleSwitch = async () => {
    if (switching) return

    setSwitching(true)
    try {
      await Promise.resolve(onSwitch({ agentType, skipPermissions }))
    } finally {
      setSwitching(false)
    }
  }

  switchRef.current = () => { void handleSwitch() }

  useEffect(() => {
    if (!open) {
      return
    }

    setSwitching(false)

    if (initialAgentType !== undefined) {
      const normalized = AGENT_TYPES.includes(initialAgentType) ? initialAgentType : DEFAULT_AGENT
      const fallbackAgent = allowedAgents[0] ?? DEFAULT_AGENT
      const sanitized = allowedAgents.includes(normalized) ? normalized : fallbackAgent
      setAgentType(sanitized)
      const supports = AGENT_SUPPORTS_SKIP_PERMISSIONS[sanitized]
      setSkipPermissions(supports ? Boolean(initialSkipPermissions) : false)
      return
    }

    const loadAgentType = isOrchestrator ? getOrchestratorAgentType : getAgentType
    const loadSkipPermissions = isOrchestrator
      ? getOrchestratorSkipPermissions
      : getSkipPermissions

    Promise.all([loadAgentType(), loadSkipPermissions()])
      .then(([type, skip]) => {
        const normalized = AGENT_TYPES.includes(type as AgentType)
          ? (type as AgentType)
          : DEFAULT_AGENT
        const fallbackAgent = allowedAgents[0] ?? DEFAULT_AGENT
        const sanitized = allowedAgents.includes(normalized) ? normalized : fallbackAgent
        setAgentType(sanitized)
        const supports = AGENT_SUPPORTS_SKIP_PERMISSIONS[sanitized]
        setSkipPermissions(supports ? Boolean(skip) : false)
      })
      .catch((error) => {
        logger.warn('[SwitchOrchestratorModal] Failed to load agent configuration:', error)
      })
  }, [
    open,
    initialAgentType,
    initialSkipPermissions,
    allowedAgents,
    isOrchestrator,
    getAgentType,
    getSkipPermissions,
    getOrchestratorAgentType,
    getOrchestratorSkipPermissions,
  ])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModelSelectorOpen) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        switchRef.current()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose, isModelSelectorOpen])

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-overlay-backdrop z-50 flex items-center justify-center">
      <div className="w-[480px] max-w-[95vw] bg-elevated border border-subtle rounded-xl shadow-xl">
        <h2 className="px-4 py-3 border-b border-subtle text-primary font-medium">
          {title}
        </h2>

        <div className="p-4 space-y-4">
          <div className="p-3 bg-warning-bg border border-warning rounded-lg">
            <div className="flex items-start gap-2">
              <span className="text-warning text-lg">⚠️</span>
              <div className="text-sm text-warning-light">
                <p className="font-medium mb-1">Warning</p>
                <p className="text-warning-lighter">{warningBody}</p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm text-secondary mb-2">Select Agent</label>
            <ModelSelector
              value={agentType}
              onChange={setAgentType}
              disabled={switching}
              skipPermissions={skipPermissions}
              onSkipPermissionsChange={(value) => setSkipPermissions(value)}
              onDropdownOpenChange={setIsModelSelectorOpen}
              allowedAgents={allowedAgents}
            />
            <p className="text-xs text-tertiary mt-2">{helperText}</p>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-subtle flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={switching}
            className="px-3 py-1.5 bg-secondary hover:bg-hover disabled:bg-secondary disabled:opacity-50 rounded group relative"
            title="Cancel (Esc)"
          >
            Cancel
            <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
          </button>
          <button
            onClick={() => { void handleSwitch() }}
            disabled={switching}
            className="px-3 py-1.5 bg-accent-blue hover:bg-accent-blue-dark disabled:bg-hover disabled:cursor-not-allowed rounded text-inverse group relative inline-flex items-center gap-2"
            title="Switch Agent (Enter)"
          >
            {switching && (
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                aria-hidden="true"
              />
            )}
            <span>Switch Agent</span>
            {!switching && (
              <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
