import { useState, useEffect } from 'react'

const ONBOARDING_KEY = 'schaltwerk-onboarding-completed'

export function useOnboarding() {
    const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null)
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false)

    useEffect(() => {
        const completed = localStorage.getItem(ONBOARDING_KEY)
        const isCompleted = completed === 'true'
        setHasCompletedOnboarding(isCompleted)
        
        if (!isCompleted) {
            const timer = setTimeout(() => {
                setIsOnboardingOpen(true)
            }, 1000)
            
            return () => clearTimeout(timer)
        }
    }, [])

    const completeOnboarding = () => {
        localStorage.setItem(ONBOARDING_KEY, 'true')
        setHasCompletedOnboarding(true)
        setIsOnboardingOpen(false)
    }

    const resetOnboarding = () => {
        localStorage.removeItem(ONBOARDING_KEY)
        setHasCompletedOnboarding(false)
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