import { useEffect, Dispatch, SetStateAction } from 'react'

export interface PrefillEventDetail {
  name?: string
  taskContent?: string
  baseBranch?: string
  lockName?: boolean
  fromDraft?: boolean
}

export interface ModalPrefillHandlers {
  setName: Dispatch<SetStateAction<string>>
  setTaskContent: Dispatch<SetStateAction<string>>
  setBaseBranch: Dispatch<SetStateAction<string>>
  setWasEdited: Dispatch<SetStateAction<boolean>>
  setNameLocked: Dispatch<SetStateAction<boolean>>
  setCreateAsDraft: Dispatch<SetStateAction<boolean>>
  wasEditedRef: React.MutableRefObject<boolean>
}

/**
 * Processes the prefill event detail and updates the modal state
 */
export function processPrefillData(
  detail: PrefillEventDetail,
  handlers: ModalPrefillHandlers
): void {
  const {
    setName,
    setTaskContent,
    setBaseBranch,
    setWasEdited,
    setNameLocked,
    setCreateAsDraft,
    wasEditedRef,
  } = handlers

  if (detail.name) {
    setName(detail.name)
    // Treat this as user-provided name to avoid regeneration
    wasEditedRef.current = true
    setWasEdited(true)
    setNameLocked(!!detail.lockName)
  }

  if (typeof detail.taskContent === 'string') {
    setTaskContent(detail.taskContent)
  }

  if (detail.baseBranch) {
    setBaseBranch(detail.baseBranch)
  }

  // If running from an existing plan, don't create another plan
  if (detail.fromDraft) {
    setCreateAsDraft(false)
  }
}

/**
 * Hook for setting up the modal prefill event listener
 * Registers the listener immediately to avoid race conditions
 */
export function useModalPrefill(handlers: ModalPrefillHandlers) {
  useEffect(() => {
    const prefillHandler = (event: CustomEvent<PrefillEventDetail>) => {
      const detail = event.detail || {}
      processPrefillData(detail, handlers)
    }

    // Type assertion needed for custom event
    window.addEventListener('schaltwerk:new-session:prefill' as any, prefillHandler as any)
    
    return () => {
      window.removeEventListener('schaltwerk:new-session:prefill' as any, prefillHandler as any)
    }
  }, [handlers])
}