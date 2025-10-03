import { useState, useEffect } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

export function useOnboarding() {
    const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null)
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false)

    useEffect(() => {
        let isMounted = true

        const openOnboarding = () => {
            if (!isMounted) return
            setIsOnboardingOpen(true)
        }

        const checkTutorialCompletion = async () => {
            try {
                const completed = await invoke<boolean>(TauriCommands.GetTutorialCompleted)
                if (!isMounted) return
                setHasCompletedOnboarding(completed)

                if (!completed) {
                    openOnboarding()
                }
            } catch (error) {
                logger.error('Failed to check tutorial completion:', error)
                if (!isMounted) return
                setHasCompletedOnboarding(false)
                openOnboarding()
            }
        }

        checkTutorialCompletion()

        return () => {
            isMounted = false
        }
    }, [])

    const markOnboardingCompleted = async () => {
        try {
            await invoke(TauriCommands.SetTutorialCompleted, { completed: true })
            setHasCompletedOnboarding(true)
        } catch (error) {
            logger.error('Failed to mark tutorial as completed:', error)
        }
    }

    const completeOnboarding = async () => {
        await markOnboardingCompleted()
        setIsOnboardingOpen(false)
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
        if (!hasCompletedOnboarding) {
            void markOnboardingCompleted()
        }
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
