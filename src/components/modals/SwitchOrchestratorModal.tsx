import { useState, useEffect, useRef } from 'react'
import { ModelSelector } from '../inputs/ModelSelector'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS } from '../../types/session'
import { logger } from '../../utils/logger'
import { useTranslation } from '../../common/i18n'

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
  const { t } = useTranslation()
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
  const title = isOrchestrator ? t.switchAgentModal.titleOrchestrator : t.switchAgentModal.titleSession
  const warningBody = isOrchestrator
    ? t.switchAgentModal.warningOrchestrator
    : targetSessionId
      ? t.switchAgentModal.warningSession.replace('session agent', `session agent for ${targetSessionId}`)
      : t.switchAgentModal.warningSession
  const helperText = isOrchestrator
    ? t.switchAgentModal.helperOrchestrator
    : t.switchAgentModal.helperSession

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
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
      <div className="w-[480px] max-w-[95vw] bg-slate-900 border border-slate-700 rounded-xl shadow-xl">
        <h2 className="px-4 py-3 border-b border-slate-800 text-slate-200 font-medium">
          {title}
        </h2>

        <div className="p-4 space-y-4">
          <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg">
            <div className="flex items-start gap-2">
              <span className="text-amber-500 text-lg">⚠️</span>
              <div className="text-sm text-amber-200">
                <p className="font-medium mb-1">{t.switchAgentModal.warning}</p>
                <p className="text-amber-300/90">{warningBody}</p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-2">{t.switchAgentModal.selectAgent}</label>
            <ModelSelector
              value={agentType}
              onChange={setAgentType}
              disabled={switching}
              skipPermissions={skipPermissions}
              onSkipPermissionsChange={(value) => setSkipPermissions(value)}
              onDropdownOpenChange={setIsModelSelectorOpen}
              allowedAgents={allowedAgents}
            />
            <p className="text-xs text-slate-400 mt-2">{helperText}</p>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={switching}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:opacity-50 rounded group relative"
            title={t.switchAgentModal.cancelEsc}
          >
            {t.switchAgentModal.cancel}
            <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
          </button>
          <button
            onClick={() => { void handleSwitch() }}
            disabled={switching}
            className="px-3 py-1.5 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-white group relative inline-flex items-center gap-2"
            style={{
              backgroundColor: 'var(--color-accent-blue-dark)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-accent-blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-accent-blue-dark)'
            }}
            title={t.switchAgentModal.switchAgentEnter}
          >
            {switching && (
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                aria-hidden="true"
              />
            )}
            <span>{t.switchAgentModal.switchAgent}</span>
            {!switching && (
              <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
