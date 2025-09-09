import { invoke } from '@tauri-apps/api/core'
import { determineRunModeState } from './runModeLogic'

export interface RunScriptLoadResult {
    hasRunScripts: boolean
    shouldActivateRunMode: boolean
    savedActiveTab: number | null
}

export async function loadRunScriptConfiguration(sessionKey: string): Promise<RunScriptLoadResult> {
    try {
        // Check if run scripts are available in the project
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const runScript = await invoke<any>('get_project_run_script')
        const scriptsAvailable = !!(runScript && runScript.command)
        
        if (!scriptsAvailable) {
            return {
                hasRunScripts: false,
                shouldActivateRunMode: false,
                savedActiveTab: null
            }
        }
        
        // Scripts are available, determine run mode state
        const runModeState = determineRunModeState(sessionKey)
        
        return {
            hasRunScripts: true,
            shouldActivateRunMode: runModeState.shouldActivateRunMode,
            savedActiveTab: runModeState.savedActiveTab
        }
    } catch (_error) {
        // No project or run script not available
        return {
            hasRunScripts: false,
            shouldActivateRunMode: false,
            savedActiveTab: null
        }
    }
}