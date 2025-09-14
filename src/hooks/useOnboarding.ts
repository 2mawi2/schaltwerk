import { useState, useEffect } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

export function useOnboarding() {
    const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null)
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false)

    useEffect(() => {
        const checkTutorialCompletion = async () => {
            try {
                const completed = await invoke<boolean>(TauriCommands.GetTutorialCompleted)
                setHasCompletedOnboarding(completed)
                
                if (!completed) {
                    const timer = setTimeout(() => {
                        setIsOnboardingOpen(true)
                    }, 1000)
                    
                    return () => clearTimeout(timer)
                }
            } catch (error) {
                logger.error('Failed to check tutorial completion:', error)
                setHasCompletedOnboarding(false)
            }
        }

        checkTutorialCompletion()
    }, [])

    const completeOnboarding = async () => {
        try {
            await invoke(TauriCommands.SetTutorialCompleted, { completed: true })
            setHasCompletedOnboarding(true)
            setIsOnboardingOpen(false)
        } catch (error) {
            logger.error('Failed to mark tutorial as completed:', error)
        }
    }

    const resetOnboarding = async () => {
        try {
            await invoke(TauriCommands.SetTutorialCompleted, { completed: false })
            setHasCompletedOnboarding(false)
        } catch (error) {
            logger.error('Failed to reset tutorial:', error)
        }
    }

    const openOnboarding = () => {
        setIsOnboardingOpen(true)
    }

    const closeOnboarding = () => {
        setIsOnboardingOpen(false)
    }

    return {
        hasCompletedOnboarding,
        isOnboardingOpen,
        completeOnboarding,
        resetOnboarding,
        openOnboarding,
        closeOnboarding,
        isLoading: hasCompletedOnboarding === null
    }
}