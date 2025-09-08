import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

export function useOnboarding() {
    const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null)
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false)

    useEffect(() => {
        const checkTutorialCompletion = async () => {
            try {
                const completed = await invoke<boolean>('get_tutorial_completed')
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
            await invoke('set_tutorial_completed', { completed: true })
            setHasCompletedOnboarding(true)
            setIsOnboardingOpen(false)
        } catch (error) {
            logger.error('Failed to mark tutorial as completed:', error)
        }
    }

    const resetOnboarding = async () => {
        try {
            await invoke('set_tutorial_completed', { completed: false })
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