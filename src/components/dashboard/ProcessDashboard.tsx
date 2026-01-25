/**
 * Process Dashboard component showing running services/ports for the project.
 *
 * Features:
 * - Shows all running services started from within schaltwerk
 * - Allows opening service URLs in browser or preview panel
 * - Allows navigating to the terminal where the service was started
 * - Can unregister/stop tracking services
 */

import { useCallback, useMemo } from 'react'
import { VscGlobe, VscTerminal, VscTrash, VscRefresh, VscPlay, VscCircleFilled } from 'react-icons/vsc'
import { useRunningServices } from '../../hooks/useRunningServices'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import type { RunningService, ServiceStatus } from '../../types/services'
import { useTranslation } from '../../common/i18n'

interface ProcessDashboardProps {
    /** Optional session name to filter services */
    sessionName?: string
    /** Called when user wants to open a URL in the preview panel */
    onOpenInPreview?: (url: string) => void
    /** Compact mode for smaller displays */
    compact?: boolean
}

const STATUS_COLORS: Record<ServiceStatus, string> = {
    running: 'text-green-500',
    starting: 'text-yellow-500',
    stopped: 'text-gray-500',
    unknown: 'text-gray-400',
}

const STATUS_LABELS: Record<ServiceStatus, string> = {
    running: 'Running',
    starting: 'Starting',
    stopped: 'Stopped',
    unknown: 'Unknown',
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return date.toLocaleDateString()
}

function ServiceCard({
    service,
    onOpenInBrowser,
    onOpenInPreview,
    onGoToTerminal,
    onRemove,
    compact = false,
}: {
    service: RunningService
    onOpenInBrowser: () => void
    onOpenInPreview?: () => void
    onGoToTerminal?: () => void
    onRemove: () => void
    compact?: boolean
}) {
    const { t } = useTranslation()
    const statusColor = STATUS_COLORS[service.status]
    const statusLabel = STATUS_LABELS[service.status]

    return (
        <div
            className={`
                group border border-[var(--vscode-panel-border)]
                rounded-md bg-[var(--vscode-editor-background)]
                hover:border-[var(--vscode-focusBorder)]
                transition-colors
                ${compact ? 'p-2' : 'p-3'}
            `}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <VscCircleFilled className={`w-2 h-2 ${statusColor}`} />
                        <span className="font-medium text-[var(--vscode-foreground)] truncate">
                            {service.name}
                        </span>
                        <span className="text-xs text-[var(--vscode-descriptionForeground)]">
                            :{service.port}
                        </span>
                    </div>
                    {!compact && (
                        <div className="mt-1 text-xs text-[var(--vscode-descriptionForeground)] truncate">
                            {service.url}
                        </div>
                    )}
                    {!compact && (
                        <div className="mt-1 flex items-center gap-3 text-xs text-[var(--vscode-descriptionForeground)]">
                            <span>{statusLabel}</span>
                            <span>•</span>
                            <span>{formatTime(service.started_at)}</span>
                            {service.session_name && (
                                <>
                                    <span>•</span>
                                    <span className="truncate max-w-[100px]">{service.session_name}</span>
                                </>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={onOpenInBrowser}
                        className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                        title={t.dashboard.openInBrowser}
                    >
                        <VscGlobe className="w-4 h-4" />
                    </button>
                    {onOpenInPreview && (
                        <button
                            onClick={onOpenInPreview}
                            className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                            title={t.dashboard.openInPreview}
                        >
                            <VscPlay className="w-4 h-4" />
                        </button>
                    )}
                    {onGoToTerminal && service.terminal_id && (
                        <button
                            onClick={onGoToTerminal}
                            className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                            title={t.dashboard.goToTerminal}
                        >
                            <VscTerminal className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        onClick={onRemove}
                        className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-errorForeground)]"
                        title={t.dashboard.removeService}
                    >
                        <VscTrash className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    )
}

export function ProcessDashboard({ sessionName, onOpenInPreview, compact = false }: ProcessDashboardProps) {
    const { t } = useTranslation()
    const { services, loading, error, refresh, unregisterService } = useRunningServices({
        sessionName,
        pollInterval: 10000, // Refresh every 10 seconds
    })

    const sortedServices = useMemo(() => {
        return [...services].sort((a, b) => b.started_at - a.started_at)
    }, [services])

    const handleOpenInBrowser = useCallback((service: RunningService) => {
        window.open(service.url, '_blank')
    }, [])

    const handleOpenInPreview = useCallback((service: RunningService) => {
        if (onOpenInPreview) {
            onOpenInPreview(service.url)
        }
    }, [onOpenInPreview])

    const handleGoToTerminal = useCallback((service: RunningService) => {
        if (service.terminal_id) {
            // Navigate to the terminal using the FocusTerminal event
            emitUiEvent(UiEvent.FocusTerminal, { terminalId: service.terminal_id })
        }
    }, [])

    const handleRemove = useCallback(async (service: RunningService) => {
        try {
            await unregisterService(service.id)
        } catch (err) {
            console.error('Failed to unregister service:', err)
        }
    }, [unregisterService])

    if (loading && services.length === 0) {
        return (
            <div className="flex items-center justify-center p-4 text-[var(--vscode-descriptionForeground)]">
                {t.dashboard.loading}
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center p-4 gap-2">
                <div className="text-[var(--vscode-errorForeground)]">
                    {t.dashboard.error}
                </div>
                <button
                    onClick={refresh}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]"
                >
                    <VscRefresh className="w-4 h-4" />
                    {t.dashboard.retry}
                </button>
            </div>
        )
    }

    if (services.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-4 gap-2 text-[var(--vscode-descriptionForeground)]">
                <VscGlobe className="w-8 h-8 opacity-50" />
                <div className="text-center">
                    <div>{t.dashboard.noServices}</div>
                    <div className="text-xs mt-1">
                        {t.dashboard.noServicesHint}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--vscode-panel-border)]">
                <span className="text-sm font-medium">
                    {t.dashboard.title} ({services.length})
                </span>
                <button
                    onClick={refresh}
                    className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                    title={t.dashboard.refresh}
                >
                    <VscRefresh className="w-4 h-4" />
                </button>
            </div>
            <div className={`flex-1 overflow-y-auto ${compact ? 'p-2 space-y-2' : 'p-3 space-y-2'}`}>
                {sortedServices.map((service) => (
                    <ServiceCard
                        key={service.id}
                        service={service}
                        onOpenInBrowser={() => handleOpenInBrowser(service)}
                        onOpenInPreview={onOpenInPreview ? () => handleOpenInPreview(service) : undefined}
                        onGoToTerminal={() => handleGoToTerminal(service)}
                        onRemove={() => handleRemove(service)}
                        compact={compact}
                    />
                ))}
            </div>
        </div>
    )
}

export default ProcessDashboard
