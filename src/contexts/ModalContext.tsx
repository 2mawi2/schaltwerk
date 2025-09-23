import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react'
import { logger } from '../utils/logger'
import { emitUiEvent, UiEvent } from '../common/uiEvents'

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

    // Maintain a body-level flag to close timing gaps for focus guards
    useEffect(() => {
        if (openModals.size > 0) {
            document.body.classList.add('modal-open')
        } else {
            document.body.classList.remove('modal-open')
        }
        // Emit a simple event others can use to detect modal state changes if needed
        try {
            emitUiEvent(UiEvent.ModalsChanged, { openCount: openModals.size })
        } catch (e) {
            logger.warn('[ModalContext] Failed to dispatch modals-changed event:', e)
        }
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
