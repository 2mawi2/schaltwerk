import React from 'react'
import { VscDiscard } from 'react-icons/vsc'
import { getAgentColorScheme, theme } from '../../common/theme'
import { AgentTab, MAX_AGENT_TABS } from '../../store/atoms/agentTabs'
import { UnifiedTab } from '../UnifiedTab'
import { AddTabButton } from '../AddTabButton'
import { HeaderActionConfig } from '../../types/actionButton'
import { getActionButtonColorClasses } from '../../constants/actionButtonColors'
import { getAgentColorKey } from '../../utils/agentColors'
import { useTranslation } from '../../common/i18n'

interface AgentTabBarProps {
    tabs: AgentTab[]
    activeTab: number
    onTabSelect: (index: number) => void
    onTabClose?: (index: number) => void
    onTabAdd?: () => void
    onReset?: () => void
    isFocused?: boolean
    actionButtons?: HeaderActionConfig[]
    onAction?: (action: HeaderActionConfig) => void
    shortcutLabel?: string
}

export const AgentTabBar: React.FC<AgentTabBarProps> = ({
    tabs,
    activeTab,
    onTabSelect,
    onTabClose,
    onTabAdd,
    onReset,
    isFocused,
    actionButtons = [],
    onAction,
    shortcutLabel,
}) => {
    const { t } = useTranslation()
    const canAddTab = onTabAdd && tabs.length < MAX_AGENT_TABS

    const renderAgentLabel = (tab: AgentTab) => {
        const colorScheme = getAgentColorScheme(getAgentColorKey(tab.agentType))

        return (
            <span
                data-testid={`agent-tab-badge-${tab.id}`}
                className="flex items-center gap-2"
                title={tab.label}
            >
                <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: colorScheme.DEFAULT }}
                />
                <span
                    className="truncate max-w-[120px]"
                    style={{
                        color: 'var(--color-text-primary)',
                        fontFamily: theme.fontFamily.sans,
                        fontWeight: 500,
                    }}
                >
                    {tab.label}
                </span>
            </span>
        )
    }

    return (
        <div
            data-testid="agent-tab-bar"
            style={{
                backgroundColor: isFocused ? 'var(--color-accent-blue-bg)' : undefined,
                color: isFocused ? 'var(--color-accent-blue-light)' : 'var(--color-text-tertiary)',
                borderBottomColor: isFocused ? 'var(--color-accent-blue-border)' : 'var(--color-border-default)',
            }}
            className={`h-9 px-2 text-xs border-b flex items-center gap-1 overflow-hidden z-10 relative ${
                isFocused
                    ? 'hover:bg-opacity-60'
                    : 'hover:bg-elevated'
            }`}
        >
            {/* Tabs - Expand to fill space, scroll internally */}
            <div className="flex-1 min-w-0 h-full flex items-center overflow-hidden">
                <div className="flex items-center h-full overflow-x-auto overflow-y-hidden scrollbar-hide w-full">
                    {tabs.map((tab, index) => {
                        const isActive = index === activeTab
                        const canClose = index > 0 && !!onTabClose

                        return (
                            <UnifiedTab
                                key={tab.id}
                                id={index}
                                label={tab.label}
                                labelContent={renderAgentLabel(tab)}
                                isActive={isActive}
                                onSelect={() => onTabSelect(index)}
                                onClose={canClose ? () => onTabClose(index) : undefined}
                                onMiddleClick={canClose ? () => onTabClose(index) : undefined}
                                showCloseButton={canClose}
                                className="h-full flex-shrink-0 border-r border-default/50"
                                style={{
                                    minWidth: '100px',
                                    maxWidth: '200px',
                                    backgroundColor: isActive
                                        ? 'var(--color-bg-primary)'
                                        : 'transparent',
                                }}
                            />
                        )
                    })}

                    {/* Add Button */}
                    {canAddTab && (
                        <AddTabButton
                            onClick={(e) => {
                                e.stopPropagation()
                                onTabAdd?.()
                            }}
                            title={t.terminalComponents.addAgentTab}
                            className="ml-1 flex-shrink-0"
                        />
                    )}
                </div>
            </div>

            {/* Right Action Buttons - Fixed width, always visible */}
            <div className="flex items-center flex-shrink-0 ml-2">
                {actionButtons.length > 0 && (
                    <div className="flex items-center gap-1 mr-2">
                        {actionButtons.map((action) => (
                            <button
                                key={action.id}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onAction?.(action)
                                }}
                                className={`px-2 py-1 text-[10px] rounded flex items-center gap-1 whitespace-nowrap ${getActionButtonColorClasses(action.color)}`}
                                title={action.label}
                            >
                                <span>{action.label}</span>
                            </button>
                        ))}
                    </div>
                )}

                {/* Reset Button */}
                {onReset && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            onReset()
                        }}
                        className="p-1 rounded hover:bg-hover mr-1"
                        title={t.terminalComponents.resetSession}
                    >
                        <VscDiscard className="text-base" />
                    </button>
                )}

                {/* Shortcut Label */}
                {shortcutLabel && (
                    <span
                        style={{
                            backgroundColor: isFocused
                                ? 'var(--color-accent-blue-bg)'
                                : 'var(--color-bg-hover)',
                            color: isFocused
                                ? 'var(--color-accent-blue-light)'
                                : 'var(--color-text-tertiary)',
                        }}
                        className="text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap"
                        title={t.terminalComponents.focusClaude.replace('{shortcut}', shortcutLabel)}
                    >
                        {shortcutLabel}
                    </span>
                )}
            </div>
        </div>
    )
}
