import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'

type SetupScriptRequestPayload = {
  setup_script: string
  has_setup_script?: boolean
  project_path?: string
  pending_confirmation?: boolean
}

type ProjectSettingsResponse = {
  setupScript: string
  branchPrefix: string
}

export type SetupScriptProposal = {
  setupScript: string
  hasSetupScript: boolean
  projectPath?: string
}

export function useSetupScriptApproval() {
  const [proposal, setProposal] = useState<SetupScriptProposal | null>(null)
  const [isApplying, setIsApplying] = useState(false)

  useEffect(() => {
    const unlistenPromise = listenEvent(
      SchaltEvent.SetupScriptRequested,
      (payload: SetupScriptRequestPayload) => {
        setProposal({
          setupScript: payload.setup_script ?? '',
          hasSetupScript: payload.has_setup_script ?? Boolean(payload.setup_script?.trim()),
          projectPath: payload.project_path,
        })
      }
    )

    return () => {
      void unlistenPromise.then((unlisten) => {
        try {
          unlisten()
        } catch (error) {
          logger.warn('[useSetupScriptApproval] Failed to unlisten setup script requests', error)
        }
      })
    }
  }, [])

  const approve = useCallback(async () => {
    if (!proposal) return

    setIsApplying(true)
    try {
      const currentSettings = await invoke<ProjectSettingsResponse>(TauriCommands.GetProjectSettings)
      await invoke(TauriCommands.SetProjectSettings, {
        settings: {
          setupScript: proposal.setupScript,
          branchPrefix: currentSettings.branchPrefix,
        },
      })
      setProposal(null)
    } catch (error) {
      logger.error('[useSetupScriptApproval] Failed to apply setup script from MCP request', error)
    } finally {
      setIsApplying(false)
    }
  }, [proposal])

  const reject = useCallback(() => {
    setProposal(null)
  }, [])

  return useMemo(
    () => ({
      proposal,
      isApplying,
      approve,
      reject,
    }),
    [approve, isApplying, proposal, reject]
  )
}
