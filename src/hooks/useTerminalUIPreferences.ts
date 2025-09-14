import { useEffect, useState } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

interface TerminalUIPreferencesResponse {
    is_collapsed: boolean
    divider_position: number | null
}

interface TerminalUIPreferences {
    isCollapsed: boolean
    dividerPosition: number | null
}

export function useTerminalUIPreferences() {
    const [preferences, setPreferences] = useState<TerminalUIPreferences>({
        isCollapsed: false,
        dividerPosition: null
    })
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadPreferences()
    }, [])

    const loadPreferences = async () => {
        try {
            const prefs = await invoke<TerminalUIPreferencesResponse>(TauriCommands.GetTerminalUiPreferences)
            setPreferences({
                isCollapsed: prefs.is_collapsed,
                dividerPosition: prefs.divider_position
            })
        } catch (error) {
            logger.error('Failed to load terminal UI preferences:', error)
        } finally {
            setLoading(false)
        }
    }

    const setCollapsed = async (isCollapsed: boolean) => {
        try {
            await invoke(TauriCommands.SetTerminalCollapsed, { isCollapsed })
            setPreferences(prev => ({ ...prev, isCollapsed }))
        } catch (error) {
            logger.error('Failed to save terminal collapsed state:', error)
        }
    }

    const setDividerPosition = async (position: number) => {
        try {
            await invoke(TauriCommands.SetTerminalDividerPosition, { position })
            setPreferences(prev => ({ ...prev, dividerPosition: position }))
        } catch (error) {
            logger.error('Failed to save terminal divider position:', error)
        }
    }

    return {
        isCollapsed: preferences.isCollapsed,
        dividerPosition: preferences.dividerPosition,
        loading,
        setCollapsed,
        setDividerPosition
    }
}