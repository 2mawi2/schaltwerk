import { describe, it, expect } from 'vitest'
import {
    canCloseTab,
    isRunTab,
    getRunButtonIcon,
    getRunButtonLabel,
    getRunButtonTooltip
} from './UnifiedBottomBar.logic'
import { TabInfo } from './UnifiedBottomBar'

describe('UnifiedBottomBar logic', () => {
    describe('canCloseTab', () => {
        it('should not allow closing the run tab', () => {
            const runTab: TabInfo = { index: 0, terminalId: 'run-terminal', label: 'Run' }
            const allTabs: TabInfo[] = [
                runTab,
                { index: 1, terminalId: 'terminal-1', label: 'Terminal 1' }
            ]
            
            expect(canCloseTab(runTab, allTabs)).toBe(false)
        })
        
        it('should not allow closing the last non-run tab', () => {
            const regularTab: TabInfo = { index: 1, terminalId: 'terminal-1', label: 'Terminal 1' }
            const allTabs: TabInfo[] = [
                { index: 0, terminalId: 'run-terminal', label: 'Run' },
                regularTab
            ]
            
            expect(canCloseTab(regularTab, allTabs)).toBe(false)
        })
        
        it('should allow closing a non-run tab when multiple exist', () => {
            const tab1: TabInfo = { index: 1, terminalId: 'terminal-1', label: 'Terminal 1' }
            const allTabs: TabInfo[] = [
                { index: 0, terminalId: 'run-terminal', label: 'Run' },
                tab1,
                { index: 2, terminalId: 'terminal-2', label: 'Terminal 2' }
            ]
            
            expect(canCloseTab(tab1, allTabs)).toBe(true)
        })
        
        it('should allow closing tabs when no run tab exists', () => {
            const tab1: TabInfo = { index: 0, terminalId: 'terminal-1', label: 'Terminal 1' }
            const allTabs: TabInfo[] = [
                tab1,
                { index: 1, terminalId: 'terminal-2', label: 'Terminal 2' }
            ]
            
            expect(canCloseTab(tab1, allTabs)).toBe(true)
        })
    })
    
    describe('isRunTab', () => {
        it('should identify run tabs correctly', () => {
            const runTab: TabInfo = { index: 0, terminalId: 'run-terminal', label: 'Run' }
            expect(isRunTab(runTab)).toBe(true)
        })
        
        it('should identify non-run tabs correctly', () => {
            const regularTab: TabInfo = { index: 1, terminalId: 'terminal-1', label: 'Terminal 1' }
            expect(isRunTab(regularTab)).toBe(false)
        })
    })
    
    describe('getRunButtonIcon', () => {
        it('should return stop icon when running', () => {
            expect(getRunButtonIcon(true)).toBe('■')
        })
        
        it('should return play icon when not running', () => {
            expect(getRunButtonIcon(false)).toBe('▶')
        })
    })
    
    describe('getRunButtonLabel', () => {
        it('should return Stop when running', () => {
            expect(getRunButtonLabel(true)).toBe('Stop')
        })
        
        it('should return Run when not running', () => {
            expect(getRunButtonLabel(false)).toBe('Run')
        })
    })
    
    describe('getRunButtonTooltip', () => {
        it('should return stop tooltip when running', () => {
            expect(getRunButtonTooltip(true)).toBe('Stop (⌘E)')
        })
        
        it('should return run tooltip when not running', () => {
            expect(getRunButtonTooltip(false)).toBe('Run Mode (⌘E)')
        })
    })
})