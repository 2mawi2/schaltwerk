import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { determineRunModeState } from './runModeLogic'
import { mapRunScriptPreviewConfig, type AutoPreviewConfig } from './runScriptPreviewConfig'

export interface RunScriptLoadResult {
    hasRunScripts: boolean
    shouldActivateRunMode: boolean
    savedActiveTab: number | null
    autoPreviewConfig: AutoPreviewConfig
    rawRunScript: unknown
}

export async function loadRunScriptConfiguration(sessionKey: string): Promise<RunScriptLoadResult> {
    try {
        // Check if run scripts are available in the project
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const runScript = await invoke<any>(TauriCommands.GetProjectRunScript)
        const scriptsAvailable = !!(runScript && runScript.command)
        const autoPreviewConfig = mapRunScriptPreviewConfig(runScript)
        
        if (!scriptsAvailable) {
            return {
                hasRunScripts: false,
                shouldActivateRunMode: false,
                savedActiveTab: null,
                autoPreviewConfig,
                rawRunScript: runScript
            }
        }
        
        // Scripts are available, determine run mode state
        const runModeState = determineRunModeState(sessionKey)

        return {
            hasRunScripts: true,
            shouldActivateRunMode: runModeState.shouldActivateRunMode,
            savedActiveTab: runModeState.savedActiveTab,
            autoPreviewConfig,
            rawRunScript: runScript
        }
    } catch (_error) {
        // No project or run script not available
        return {
            hasRunScripts: false,
            shouldActivateRunMode: false,
            savedActiveTab: null,
            autoPreviewConfig: mapRunScriptPreviewConfig({}),
            rawRunScript: null
        }
    }
}
