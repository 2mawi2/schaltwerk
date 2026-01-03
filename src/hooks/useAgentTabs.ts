import { useAtom } from 'jotai'
import { useCallback, useLayoutEffect } from 'react'
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
import { reorderArray } from '../common/reorderArray'
import {
    clearActiveAgentTerminalId,
    resolveActiveAgentTerminalId,
    setActiveAgentTerminalId,
    setActiveAgentTerminalFromTabsState,
} from '../common/terminalTargeting'

type StartAgentFn = (params: {
    sessionId: string
    terminalId: string
    agentType: AgentType
}) => Promise<void>

export const useAgentTabs = (
    sessionId: string | null,
    baseTerminalId: string | null,
    options?: { startAgent?: StartAgentFn; sessionNameForBackend?: string | null }
) => {
    const [agentTabsMap, setAgentTabsMap] = useAtom(agentTabsStateAtom)
    const startAgent = options?.startAgent
    const backendSessionName = options?.sessionNameForBackend ?? sessionId

    useLayoutEffect(() => {
        if (!sessionId || !baseTerminalId) return
        setActiveAgentTerminalFromTabsState(sessionId, agentTabsMap.get(sessionId) ?? null, baseTerminalId)
    }, [agentTabsMap, sessionId, baseTerminalId])

    const parseTabNumericIndex = useCallback((tab: AgentTab, fallback: number): number => {
        if (tab.id.startsWith('tab-')) {
            const maybe = Number(tab.id.slice(4))
            if (Number.isFinite(maybe)) return maybe
        }
        return fallback
    }, [])

    const getPrimaryTab = useCallback((tabs: AgentTab[]): AgentTab | null => {
        if (tabs.length === 0) return null
        for (let i = 0; i < tabs.length; i += 1) {
            if (parseTabNumericIndex(tabs[i], i) === 0) {
                return tabs[i]
            }
        }
        return tabs[0] ?? null
    }, [parseTabNumericIndex])

    const ensureInitialized = useCallback(
        (initialAgentType: AgentType = 'claude') => {
            if (!sessionId || !baseTerminalId) return

            let nextActiveTerminalId: string | null = null

            setAgentTabsMap((prev) => {
                const existing = prev.get(sessionId)
                if (existing) {
                    nextActiveTerminalId = resolveActiveAgentTerminalId(existing, baseTerminalId)
                    const currentBaseId = getPrimaryTab(existing.tabs)?.terminalId
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
        [sessionId, baseTerminalId, setAgentTabsMap, parseTabNumericIndex, getPrimaryTab]
    )

    const getTabsState = useCallback(() => {
        if (!sessionId || !baseTerminalId) return null
        return agentTabsMap.get(sessionId) || null
    }, [sessionId, baseTerminalId, agentTabsMap])

    const addTab = useCallback(
        (agentType: AgentType, options?: { skipPermissions?: boolean }) => {
            if (!sessionId || !baseTerminalId) return
            if (!startAgent && !backendSessionName) return

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
                const resolvedSessionName = backendSessionName
                const starter = startAgent
                    ? startAgent({ sessionId, terminalId: newTerminalId, agentType })
                    : invoke(TauriCommands.SchaltwerkCoreStartSessionAgentWithRestart, {
                          params: {
                              sessionName: resolvedSessionName as string,
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
        [sessionId, baseTerminalId, setAgentTabsMap, startAgent, backendSessionName, parseTabNumericIndex]
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
            if (!sessionId || !baseTerminalId) return

            let nextActiveTerminalId: string | null = null

            setAgentTabsMap((prev) => {
                const next = new Map(prev)
                const current = next.get(sessionId)
                if (!current) return prev

                const tabToClose = current.tabs[index]
                if (!tabToClose) return prev

                if (parseTabNumericIndex(tabToClose, index) === 0) {
                    return prev
                }

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
        [sessionId, baseTerminalId, setAgentTabsMap, parseTabNumericIndex]
    )

    const resetTabs = useCallback(() => {
        if (!sessionId || !baseTerminalId) return

        const current = agentTabsMap.get(sessionId)
        const primaryTab = current ? getPrimaryTab(current.tabs) : null
        const primaryTerminalId = primaryTab?.terminalId ?? baseTerminalId
        if (current) {
            current.tabs.forEach((tab) => {
                if (tab.id !== primaryTab?.id) {
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
                const primaryTab = getPrimaryTab(existing.tabs)
                if (!primaryTab) {
                    next.delete(sessionId)
                    return next
                }
                next.set(sessionId, {
                    tabs: [primaryTab],
                    activeTab: 0,
                })
            }
            return next
        })
    }, [sessionId, baseTerminalId, agentTabsMap, setAgentTabsMap, getPrimaryTab])

    const updatePrimaryAgentType = useCallback(
        (agentType: AgentType) => {
            if (!sessionId) return

            setAgentTabsMap((prev) => {
                const current = prev.get(sessionId)
                if (!current || current.tabs.length === 0) return prev

                const primaryTab = getPrimaryTab(current.tabs)
                if (!primaryTab) return prev
                if (primaryTab.agentType === agentType) return prev

                const next = new Map(prev)
                const updatedTabs = current.tabs.map((tab) =>
                    tab.id === primaryTab.id
                        ? {
                              ...tab,
                              agentType,
                              label:
                                  displayNameForAgent(agentType) ??
                                  DEFAULT_AGENT_TAB_LABEL,
                          }
                        : tab
                )

                next.set(sessionId, {
                    ...current,
                    tabs: updatedTabs,
                })

                return next
            })
        },
        [sessionId, setAgentTabsMap, getPrimaryTab]
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

    const reorderTabs = useCallback(
        (fromIndex: number, toIndex: number) => {
            if (!sessionId) return

            setAgentTabsMap((prev) => {
                const current = prev.get(sessionId)
                if (!current) return prev

                if (
                    fromIndex < 0 ||
                    fromIndex >= current.tabs.length ||
                    toIndex < 0 ||
                    toIndex >= current.tabs.length ||
                    fromIndex === toIndex
                ) {
                    return prev
                }

                const activeTabId = current.tabs[current.activeTab]?.id ?? null
                const reorderedTabs = reorderArray(current.tabs, fromIndex, toIndex)
                const nextActiveTab =
                    activeTabId === null
                        ? current.activeTab
                        : Math.max(
                              0,
                              reorderedTabs.findIndex((tab) => tab.id === activeTabId)
                          )

                const next = new Map(prev)
                next.set(sessionId, {
                    ...current,
                    tabs: reorderedTabs,
                    activeTab: nextActiveTab,
                })
                return next
            })
        },
        [sessionId, setAgentTabsMap]
    )

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
        reorderTabs,
    }
}
