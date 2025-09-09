export interface RunModeState {
    isFirstVisit: boolean
    shouldActivateRunMode: boolean
    savedActiveTab: number | null
}

export function determineRunModeState(sessionKey: string): RunModeState {
    const firstVisitKey = `schaltwerk:first-visit:${sessionKey}`
    const runModeKey = `schaltwerk:run-mode:${sessionKey}`
    const activeTabKey = `schaltwerk:active-tab:${sessionKey}`
    
    const isFirstVisit = sessionStorage.getItem(firstVisitKey) === null
    const savedRunMode = sessionStorage.getItem(runModeKey) === 'true'
    const savedActiveTabStr = sessionStorage.getItem(activeTabKey)
    const savedActiveTab = savedActiveTabStr !== null ? parseInt(savedActiveTabStr, 10) : null
    
    if (isFirstVisit) {
        // Mark as visited and activate run mode for first-time users
        sessionStorage.setItem(firstVisitKey, 'true')
        sessionStorage.setItem(runModeKey, 'true')
        return {
            isFirstVisit: true,
            shouldActivateRunMode: true,
            savedActiveTab
        }
    }
    
    return {
        isFirstVisit: false,
        shouldActivateRunMode: savedRunMode,
        savedActiveTab
    }
}

export function saveRunModeState(sessionKey: string, isActive: boolean): void {
    const runModeKey = `schaltwerk:run-mode:${sessionKey}`
    sessionStorage.setItem(runModeKey, String(isActive))
}

export function saveActiveTab(sessionKey: string, tabIndex: number): void {
    const activeTabKey = `schaltwerk:active-tab:${sessionKey}`
    sessionStorage.setItem(activeTabKey, String(tabIndex))
}