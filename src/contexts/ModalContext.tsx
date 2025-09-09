import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface ModalContextType {
    registerModal: (modalId: string) => void
    unregisterModal: (modalId: string) => void
    isAnyModalOpen: () => boolean
    openModals: Set<string>
}

const ModalContext = createContext<ModalContextType | null>(null)

export function ModalProvider({ children }: { children: ReactNode }) {
    const [openModals, setOpenModals] = useState<Set<string>>(new Set())

    const registerModal = useCallback((modalId: string) => {
        setOpenModals(prev => new Set(prev).add(modalId))
    }, [])

    const unregisterModal = useCallback((modalId: string) => {
        setOpenModals(prev => {
            const next = new Set(prev)
            next.delete(modalId)
            return next
        })
    }, [])

    const isAnyModalOpen = useCallback(() => {
        return openModals.size > 0
    }, [openModals])

    return (
        <ModalContext.Provider value={{
            registerModal,
            unregisterModal,
            isAnyModalOpen,
            openModals
        }}>
            {children}
        </ModalContext.Provider>
    )
}

export function useModal() {
    const context = useContext(ModalContext)
    if (!context) {
        throw new Error('useModal must be used within a ModalProvider')
    }
    return context
}