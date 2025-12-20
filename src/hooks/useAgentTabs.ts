import { useAtom } from 'jotai'
import { useCallback } from 'react'
import {
    agentTabsStateAtom,
    AgentTab,
    DEFAULT_AGENT_TAB_LABEL,
    getAgentTabTerminalId,
} from '../store/atoms/agentTabs'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'
import { displayNameForAgent } from '../components/shared/agentDefaults'
import { AgentType } from '../types/session'
import { clearTerminalStartState } from '../common/terminalStartState'
import { removeTerminalInstance } from '../terminal/registry/terminalRegistry'
import {
    clearActiveAgentTerminalId,
    resolveActiveAgentTerminalId,
    setActiveAgentTerminalId,
} from '../common/terminalTargeting'

type StartAgentFn = (params: {
    sessionId: string
    terminalId: string
    agentType: AgentType
}) => Promise<void>

export const useAgentTabs = (
    sessionId: string | null,
    baseTerminalId: string | null,
    options?: { startAgent?: StartAgentFn }
) => {
    const [agentTabsMap, setAgentTabsMap] = useAtom(agentTabsStateAtom)
    const startAgent = options?.startAgent

    const parseTabNumericIndex = useCallback((tab: AgentTab, fallback: number): number => {
        if (tab.id.startsWith('tab-')) {
            const maybe = Number(tab.id.slice(4))
            if (Number.isFinite(maybe)) return maybe
        }
        return fallback
    }, [])

    const ensureInitialized = useCallback(
        (initialAgentType: AgentType = 'claude') => {
            if (!sessionId || !baseTerminalId) return

            let nextActiveTerminalId: string | null = null

            setAgentTabsMap((prev) => {
                const existing = prev.get(sessionId)
                if (existing) {
                    nextActiveTerminalId = resolveActiveAgentTerminalId(existing, baseTerminalId)
                    const currentBaseId = existing.tabs[0]?.terminalId
                    if (currentBaseId === baseTerminalId) return prev

                    const next = new Map(prev)
                    const updatedTabs = existing.tabs.map((tab, index) => ({
                        ...tab,
                        terminalId: getAgentTabTerminalId(
                            baseTerminalId,
                            parseTabNumericIndex(tab, index)
                        ),
                    }))
                    next.set(sessionId, {
                        ...existing,
                        tabs: updatedTabs,
                    })
                    nextActiveTerminalId = resolveActiveAgentTerminalId(
                        next.get(sessionId) ?? null,
                        baseTerminalId
                    )
                    return next
                }

                const next = new Map(prev)
                next.set(sessionId, {
                    tabs: [
                        {
                            id: 'tab-0',
                            terminalId: baseTerminalId,
                            label: displayNameForAgent(initialAgentType) ?? DEFAULT_AGENT_TAB_LABEL,
                            agentType: initialAgentType,
                        },
                    ],
                    activeTab: 0,
                })
                nextActiveTerminalId = baseTerminalId
                return next
            })

            if (nextActiveTerminalId) {
                setActiveAgentTerminalId(sessionId, nextActiveTerminalId)
            }
        },
        [sessionId, baseTerminalId, setAgentTabsMap, parseTabNumericIndex]
    )

    const getTabsState = useCallback(() => {
        if (!sessionId || !baseTerminalId) return null
        return agentTabsMap.get(sessionId) || null
    }, [sessionId, baseTerminalId, agentTabsMap])

    const addTab = useCallback(
        (agentType: AgentType, options?: { skipPermissions?: boolean }) => {
            if (!sessionId || !baseTerminalId) return

            let newTerminalId = ''
            let newTabArrayIndex = 0
            let newTabNumericIndex = 0
            let forceRestartForNewTab = false

            setAgentTabsMap((prev) => {
                const next = new Map(prev)
                let current = next.get(sessionId)

                if (!current) {
                    current = {
                        tabs: [
                            {
                                id: 'tab-0',
                                terminalId: baseTerminalId,
                                label: DEFAULT_AGENT_TAB_LABEL,
                                agentType: 'claude' as AgentType,
                            },
                        ],
                        activeTab: 0,
                    }
                }

                newTabArrayIndex = current.tabs.length
                forceRestartForNewTab = current.tabs.some((tab) => tab.agentType === agentType)
                const numericIndices = current.tabs.map((tab, idx) =>
                    parseTabNumericIndex(tab, idx)
                )
                newTabNumericIndex =
                    numericIndices.length === 0 ? 0 : Math.max(...numericIndices) + 1
                newTerminalId = getAgentTabTerminalId(baseTerminalId, newTabNumericIndex)

                const newTab: AgentTab = {
                    id: `tab-${newTabNumericIndex}`,
                    terminalId: newTerminalId,
                    label: displayNameForAgent(agentType) ?? DEFAULT_AGENT_TAB_LABEL,
                    agentType,
                }

                next.set(sessionId, {
                    ...current,
                    tabs: [...current.tabs, newTab],
                    activeTab: newTabArrayIndex,
                })

                return next
            })

            if (newTerminalId) {
                setActiveAgentTerminalId(sessionId, newTerminalId)
            }

            if (newTerminalId) {
                logger.info(
                    `[useAgentTabs] Starting new agent tab ${newTabArrayIndex} (idx=${newTabNumericIndex}) with ${agentType} in ${newTerminalId}, skipPermissions=${options?.skipPermissions}`
                )
                const starter = startAgent
                    ? startAgent({ sessionId, terminalId: newTerminalId, agentType })
                    : invoke(TauriCommands.SchaltwerkCoreStartSessionAgentWithRestart, {
                          params: {
                              sessionName: sessionId,
                              forceRestart: forceRestartForNewTab,
                              terminalId: newTerminalId,
                              agentType: agentType,
                              skipPrompt: true,
                              skipPermissions: options?.skipPermissions,
                          },
                      })

                Promise.resolve(starter).catch((err) => {
                    logger.error(
                        `[useAgentTabs] Failed to start agent for tab ${newTabArrayIndex}:`,
                        err
                    )
                    let nextActiveTerminalId: string | null = null
                    setAgentTabsMap((prev) => {
                        const next = new Map(prev)
                        const current = next.get(sessionId)
                        if (!current) return prev

                        const newTabs = current.tabs.filter(
                            (_tab, i) => i !== newTabArrayIndex
                        )
                        next.set(sessionId, {
                            ...current,
                            tabs: newTabs,
                            activeTab: Math.max(0, current.activeTab - 1),
                        })
                        nextActiveTerminalId = resolveActiveAgentTerminalId(
                            next.get(sessionId) ?? null,
                            baseTerminalId
                        )
                        return next
                    })
                    if (nextActiveTerminalId) {
                        setActiveAgentTerminalId(sessionId, nextActiveTerminalId)
                    }
                })
            }
        },
        [sessionId, baseTerminalId, setAgentTabsMap, startAgent, parseTabNumericIndex]
    )

    const setActiveTab = useCallback(
        (index: number) => {
            if (!sessionId || !baseTerminalId) return
            let nextActiveTerminalId: string | null = null
            setAgentTabsMap((prev) => {
                const current = prev.get(sessionId)
                if (!current || current.activeTab === index) return prev

                const next = new Map(prev)
                next.set(sessionId, {
                    ...current,
                    activeTab: index,
                })
                nextActiveTerminalId = resolveActiveAgentTerminalId(
                    next.get(sessionId) ?? null,
                    baseTerminalId
                )
                return next
            })
            if (nextActiveTerminalId) {
                setActiveAgentTerminalId(sessionId, nextActiveTerminalId)
            }
        },
        [sessionId, baseTerminalId, setAgentTabsMap]
    )

    const closeTab = useCallback(
        (index: number) => {
            if (!sessionId || !baseTerminalId || index === 0) return

            let nextActiveTerminalId: string | null = null

            setAgentTabsMap((prev) => {
                const next = new Map(prev)
                const current = next.get(sessionId)
                if (!current) return prev

                const tabToClose = current.tabs[index]
                if (!tabToClose) return prev

                logger.info(`[useAgentTabs] Closing tab ${index} (id: ${tabToClose.terminalId})`)
                invoke(TauriCommands.CloseTerminal, { id: tabToClose.terminalId }).catch((err) => {
                    logger.error(
                        `[useAgentTabs] Failed to close terminal ${tabToClose.terminalId}:`,
                        err
                    )
                })
                clearTerminalStartState([tabToClose.terminalId])
                removeTerminalInstance(tabToClose.terminalId)

                const newTabs = current.tabs.filter((_, i) => i !== index)

                let newActiveTab = current.activeTab
                if (newActiveTab === index) {
                    newActiveTab = Math.max(0, index - 1)
                } else if (newActiveTab > index) {
                    newActiveTab = newActiveTab - 1
                }

                next.set(sessionId, {
                    ...current,
                    tabs: newTabs,
                    activeTab: newActiveTab,
                })

                nextActiveTerminalId = resolveActiveAgentTerminalId(
                    next.get(sessionId) ?? null,
                    baseTerminalId
                )
                return next
            })

            if (nextActiveTerminalId) {
                setActiveAgentTerminalId(sessionId, nextActiveTerminalId)
            }
        },
        [sessionId, baseTerminalId, setAgentTabsMap]
    )

    const resetTabs = useCallback(() => {
        if (!sessionId || !baseTerminalId) return

        const current = agentTabsMap.get(sessionId)
        const primaryTerminalId = current?.tabs[0]?.terminalId ?? baseTerminalId
        if (current) {
            current.tabs.forEach((tab, index) => {
                if (index > 0) {
                    invoke(TauriCommands.CloseTerminal, { id: tab.terminalId }).catch((e) => {
                        logger.debug(
                            `[useAgentTabs] Failed to close terminal ${tab.terminalId}:`,
                            e
                        )
                    })
                    clearTerminalStartState([tab.terminalId])
                    removeTerminalInstance(tab.terminalId)
                }
            })
        }

        setActiveAgentTerminalId(sessionId, primaryTerminalId)

        setAgentTabsMap((prev) => {
            const next = new Map(prev)
            if (next.has(sessionId)) {
                const existing = next.get(sessionId)!
                const primaryTab = existing.tabs[0]
                next.set(sessionId, {
                    tabs: [primaryTab],
                    activeTab: 0,
                })
            }
            return next
        })
    }, [sessionId, baseTerminalId, agentTabsMap, setAgentTabsMap])

    const updatePrimaryAgentType = useCallback(
        (agentType: AgentType) => {
            if (!sessionId) return

            setAgentTabsMap((prev) => {
                const current = prev.get(sessionId)
                if (!current || current.tabs.length === 0) return prev

                const primaryTab = current.tabs[0]
                if (primaryTab.agentType === agentType) return prev

                const next = new Map(prev)
                const updatedTabs = [...current.tabs]
                updatedTabs[0] = {
                    ...primaryTab,
                    agentType,
                    label: displayNameForAgent(agentType) ?? DEFAULT_AGENT_TAB_LABEL,
                }

                next.set(sessionId, {
                    ...current,
                    tabs: updatedTabs,
                })

                return next
            })
        },
        [sessionId, setAgentTabsMap]
    )

    const getActiveTerminalId = useCallback(() => {
        const state = getTabsState()
        if (!state) return null
        const activeTab = state.tabs[state.activeTab]
        return activeTab?.terminalId ?? null
    }, [getTabsState])

    const clearSession = useCallback(() => {
        if (!sessionId) return

        clearActiveAgentTerminalId(sessionId)
        setAgentTabsMap((prev) => {
            if (!prev.has(sessionId)) return prev
            const next = new Map(prev)
            next.delete(sessionId)
            return next
        })
    }, [sessionId, setAgentTabsMap])

    return {
        ensureInitialized,
        getTabsState,
        addTab,
        setActiveTab,
        closeTab,
        resetTabs,
        updatePrimaryAgentType,
        getActiveTerminalId,
        clearSession,
    }
}
