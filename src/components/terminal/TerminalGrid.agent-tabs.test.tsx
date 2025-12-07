import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { Provider, useSetAtom, createStore } from 'jotai'
import { agentTabsStateAtom, AgentTab, DEFAULT_AGENT_TAB_LABEL } from '../../store/atoms/agentTabs'
import { AgentType } from '../../types/session'
import { displayNameForAgent } from '../shared/agentDefaults'
import { useAgentTabs } from '../../hooks/useAgentTabs'

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(async () => undefined),
}))

vi.mock('../../utils/logger', () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    },
}))

const sessionId = 'demo-session'
const topId = `${sessionId}-top`

function TestComponent({
    onStateChange,
}: {
    onStateChange: (state: ReturnType<typeof useAgentTabs>) => void
}) {
    const hook = useAgentTabs(sessionId, topId)

    useEffect(() => {
        hook.ensureInitialized('claude')
    }, [hook])

    useEffect(() => {
        onStateChange(hook)
    }, [hook, onStateChange])

    const tabsState = hook.getTabsState()
    return (
        <div data-testid="tabs-count">{tabsState?.tabs.length ?? 0}</div>
    )
}

function PrefillTabs({ onMount }: { onMount?: () => void }) {
    const setAgentTabs = useSetAtom(agentTabsStateAtom)
    useEffect(() => {
        const tabs: AgentTab[] = [
            {
                id: 'tab-0',
                terminalId: topId,
                label: displayNameForAgent('claude') ?? DEFAULT_AGENT_TAB_LABEL,
                agentType: 'claude',
            },
            { id: 'tab-1', terminalId: `${topId}-1`, label: 'Second', agentType: 'codex' as AgentType },
        ]
        setAgentTabs(new Map([[sessionId, { tabs, activeTab: 0 }]]))
        onMount?.()
    }, [setAgentTabs, onMount])
    return null
}

describe('TerminalGrid agent tabs integration', () => {
    let latestHookState: ReturnType<typeof useAgentTabs> | null = null

    beforeEach(() => {
        latestHookState = null
    })

    it('initializes with a single tab', async () => {
        const store = createStore()

        render(
            <Provider store={store}>
                <TestComponent onStateChange={(state) => { latestHookState = state }} />
            </Provider>
        )

        await waitFor(() => {
            expect(latestHookState?.getTabsState()?.tabs.length).toBe(1)
        })
    })

    it('renders all agent tabs from jotai state', async () => {
        const store = createStore()

        render(
            <Provider store={store}>
                <PrefillTabs />
                <TestComponent onStateChange={(state) => { latestHookState = state }} />
            </Provider>
        )

        await waitFor(() => {
            expect(latestHookState?.getTabsState()?.tabs.length).toBe(2)
        })

        expect(latestHookState?.getTabsState()?.tabs.map((t) => t.label)).toEqual([
            displayNameForAgent('claude') ?? DEFAULT_AGENT_TAB_LABEL,
            'Second',
        ])
    })

    it('adds a new tab when addTab is called', async () => {
        const store = createStore()

        render(
            <Provider store={store}>
                <PrefillTabs />
                <TestComponent onStateChange={(state) => { latestHookState = state }} />
            </Provider>
        )

        await waitFor(() => {
            expect(latestHookState?.getTabsState()?.tabs.length).toBe(2)
        })

        await act(async () => {
            latestHookState?.addTab('gemini' as AgentType)
        })

        await waitFor(() => {
            expect(latestHookState?.getTabsState()?.tabs.length).toBe(3)
        })
    })

    it('resets to a single tab on resetTabs', async () => {
        const store = createStore()

        render(
            <Provider store={store}>
                <PrefillTabs />
                <TestComponent onStateChange={(state) => { latestHookState = state }} />
            </Provider>
        )

        await waitFor(() => {
            expect(latestHookState?.getTabsState()?.tabs.length).toBe(2)
        })

        await act(async () => {
            await latestHookState?.resetTabs()
        })

        await waitFor(() => {
            expect(latestHookState?.getTabsState()?.tabs.length).toBe(1)
        })
    })
})
