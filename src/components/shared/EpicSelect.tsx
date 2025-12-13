import { useCallback, useMemo, useState } from 'react'
import { VscTag } from 'react-icons/vsc'
import type { Epic } from '../../types/session'
import { Dropdown, type DropdownItem } from '../inputs/Dropdown'
import { theme } from '../../common/theme'
import { getEpicAccentScheme } from '../../utils/epicColors'
import { useEpics } from '../../hooks/useEpics'
import { EpicModal } from '../modals/EpicModal'
import { logger } from '../../utils/logger'

interface EpicSelectProps {
    value?: Epic | null
    disabled?: boolean
    onChange: (epicId: string | null) => void | Promise<void>
    variant?: 'pill' | 'field' | 'compact' | 'icon'
    className?: string
    stopPropagation?: boolean
}

export function EpicSelect({ value, disabled = false, onChange, variant = 'pill', className = '', stopPropagation = false }: EpicSelectProps) {
    const { epics, ensureLoaded, createEpic } = useEpics()
    const [open, setOpen] = useState(false)
    const [createOpen, setCreateOpen] = useState(false)

    const selectedId = value?.id ?? null
    const selectedScheme = getEpicAccentScheme(value?.color)

    const items = useMemo<DropdownItem[]>(() => {
        const hasSelected = selectedId ? epics.some(e => e.id === selectedId) : true
        const normalized = hasSelected || !value ? epics : [value, ...epics]

        const epicItems: DropdownItem[] = normalized.map((epic) => {
            const scheme = getEpicAccentScheme(epic.color)
            return {
                key: epic.id,
                label: (
                    <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: scheme?.DEFAULT ?? theme.colors.text.muted }} />
                        <span className="truncate">{epic.name}</span>
                    </span>
                ),
            }
        })

        return [
            { key: 'none', label: 'None' },
            { key: 'separator', label: <div style={{ height: 1, backgroundColor: theme.colors.border.subtle }} />, disabled: true },
            ...epicItems,
            { key: 'separator-2', label: <div style={{ height: 1, backgroundColor: theme.colors.border.subtle }} />, disabled: true },
            { key: 'create', label: '+ Create new epic' },
        ]
    }, [epics, selectedId, value])

    const handleOpenChange = useCallback((next: boolean) => {
        setOpen(next)
        if (next) {
            ensureLoaded().catch((err) => {
                logger.warn('[EpicSelect] Failed to load epics:', err)
            })
        }
    }, [ensureLoaded])

    const handleSelect = useCallback((key: string) => {
        if (disabled) {
            return
        }
        if (key === 'separator' || key === 'separator-2') {
            return
        }
        if (key === 'create') {
            setCreateOpen(true)
            return
        }
        if (key === 'none') {
            Promise.resolve(onChange(null)).catch((err) => {
                logger.error('[EpicSelect] Failed to update epic:', err)
            })
            return
        }
        Promise.resolve(onChange(key)).catch((err) => {
            logger.error('[EpicSelect] Failed to update epic:', err)
        })
    }, [disabled, onChange])

    const handleCreateEpic = useCallback(async (data: { name: string; color: string | null }) => {
        const epic = await createEpic(data.name, data.color)
        await onChange(epic.id)
    }, [createEpic, onChange])

    return (
        <>
            <Dropdown
                open={open}
                onOpenChange={handleOpenChange}
                items={items}
                selectedKey={selectedId ?? 'none'}
                onSelect={handleSelect}
                align="left"
                minWidth={200}
            >
                {({ toggle }) => (
                    <button
                        type="button"
                        onClick={(e) => {
                            if (stopPropagation) {
                                e.stopPropagation()
                            }
                            toggle()
                        }}
                        disabled={disabled}
                        className={variant === 'icon'
                            ? `inline-flex items-center justify-center px-1.5 py-1 rounded transition-colors duration-150 ${disabled ? 'opacity-50 cursor-not-allowed' : 'bg-slate-700/60 hover:bg-slate-600/60 cursor-pointer'} ${className}`
                            : `${variant === 'field' ? 'w-full px-3 py-2 justify-between' : variant === 'compact' ? 'p-1' : 'px-2 py-1'} rounded border inline-flex items-center gap-2 ${disabled ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'} ${className}`
                        }
                        style={variant === 'icon' ? undefined : {
                            backgroundColor: variant === 'field'
                                ? theme.colors.background.secondary
                                : theme.colors.background.elevated,
                            borderColor: theme.colors.border.subtle,
                            color: variant === 'field' ? theme.colors.text.primary : theme.colors.text.secondary,
                            fontSize: variant === 'field' ? theme.fontSize.body : theme.fontSize.caption,
                        }}
                        title={value?.name ?? 'Set epic'}
                    >
                        {variant === 'icon' ? (
                            <span className="w-4 h-4 flex items-center justify-center">
                                <VscTag style={{ color: selectedScheme?.DEFAULT ?? theme.colors.text.muted }} />
                            </span>
                        ) : (
                            <>
                                <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: selectedScheme?.DEFAULT ?? theme.colors.text.muted }}
                                />
                                {variant !== 'compact' && (
                                    <>
                                        <span className={`truncate ${variant === 'field' ? 'flex-1 text-left' : 'max-w-[140px]'}`}>{value?.name ?? 'None'}</span>
                                        <span style={{ color: theme.colors.text.muted }}>▾</span>
                                    </>
                                )}
                            </>
                        )}
                    </button>
                )}
            </Dropdown>

            <EpicModal
                open={createOpen}
                mode="create"
                onClose={() => {
                    setCreateOpen(false)
                }}
                onSubmit={handleCreateEpic}
            />
        </>
    )
}
