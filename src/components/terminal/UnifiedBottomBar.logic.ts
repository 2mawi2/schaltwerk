import { TabInfo } from './UnifiedBottomBar'
export function canCloseTab(tab: TabInfo, allTabs: TabInfo[]): boolean {
    const isRunTab = tab.terminalId === 'run-terminal'
    
    // Run tab cannot be closed
    if (isRunTab) {
        return false
    }
    
    // Count non-Run tabs
    const nonRunTabCount = allTabs.filter(t => t.terminalId !== 'run-terminal').length
    
    // Can close if there's more than one non-Run tab
    return nonRunTabCount > 1
}

export function isRunTab(tab: TabInfo): boolean {
    return tab.terminalId === 'run-terminal'
}



export function getRunButtonIcon(isRunning: boolean): string {
    return isRunning ? '■' : '▶'
}

export function getRunButtonLabel(isRunning: boolean): string {
    return isRunning ? 'Stop' : 'Run'
}

export function getRunButtonTooltip(isRunning: boolean): string {
    return isRunning ? "Stop (⌘E)" : "Run Mode (⌘E)"
}