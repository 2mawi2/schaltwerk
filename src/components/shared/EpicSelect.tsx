import { useCallback, useMemo, useState } from 'react'
import { VscTag, VscClose } from 'react-icons/vsc'
import type { Epic } from '../../types/session'
import { Dropdown, type DropdownItem } from '../inputs/Dropdown'
import { theme } from '../../common/theme'
import { getEpicAccentScheme } from '../../utils/epicColors'
import { useEpics } from '../../hooks/useEpics'
import { EpicModal } from '../modals/EpicModal'
import { ConfirmModal } from '../modals/ConfirmModal'
import { logger } from '../../utils/logger'

interface EpicSelectProps {
    value?: Epic | null
    disabled?: boolean
    onChange: (epicId: string | null) => void | Promise<void>
    variant?: 'pill' | 'field' | 'compact' | 'icon'
    className?: string
    stopPropagation?: boolean
    showDeleteButton?: boolean
}

export function EpicSelect({ value, disabled = false, onChange, variant = 'pill', className = '', stopPropagation = false, showDeleteButton = false }: EpicSelectProps) {
    const { epics, ensureLoaded, createEpic, deleteEpic } = useEpics()
    const [open, setOpen] = useState(false)
    const [createOpen, setCreateOpen] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<Epic | null>(null)
    const [deleteLoading, setDeleteLoading] = useState(false)

    const selectedId = value?.id ?? null
    const selectedScheme = getEpicAccentScheme(value?.color)

    const handleDeleteClick = useCallback((e: React.MouseEvent, epic: Epic) => {
        e.stopPropagation()
        e.preventDefault()
        setDeleteTarget(epic)
        setOpen(false)
    }, [])

    const items = useMemo<DropdownItem[]>(() => {
        const hasSelected = selectedId ? epics.some(e => e.id === selectedId) : true
        const normalized = hasSelected || !value ? epics : [value, ...epics]

        const epicItems: DropdownItem[] = normalized.map((epic) => {
            const scheme = getEpicAccentScheme(epic.color)
            return {
                key: epic.id,
                label: (
                    <span className="flex items-center gap-2 w-full group/epic-item">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: scheme?.DEFAULT ?? 'var(--color-text-muted)' }} />
                        <span className="truncate flex-1">{epic.name}</span>
                        {showDeleteButton && (
                            <span
                                role="button"
                                tabIndex={-1}
                                onClick={(e) => handleDeleteClick(e, epic)}
                                onPointerDown={(e) => e.stopPropagation()}
                                className="opacity-0 group-hover/epic-item:opacity-100 p-0.5 rounded hover:opacity-80 transition-opacity flex-shrink-0"
                                style={{ color: 'var(--color-text-primary)' }}
                                title={`Delete epic "${epic.name}"`}
                            >
                                <VscClose className="w-3.5 h-3.5" />
                            </span>
                        )}
                    </span>
                ),
            }
        })

        return [
            { key: 'none', label: 'None' },
            { key: 'separator', label: <div style={{ height: 1, backgroundColor: 'var(--color-border-subtle)' }} />, disabled: true },
            ...epicItems,
            { key: 'separator-2', label: <div style={{ height: 1, backgroundColor: 'var(--color-border-subtle)' }} />, disabled: true },
            { key: 'create', label: '+ Create new epic' },
        ]
    }, [epics, selectedId, value, showDeleteButton, handleDeleteClick])

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
                            ? `inline-flex items-center justify-center px-1.5 py-1 rounded border transition-colors duration-150 ${disabled ? 'opacity-50 cursor-not-allowed' : 'bg-[rgb(var(--color-border-subtle-rgb)/0.4)] hover:bg-[rgb(var(--color-border-subtle-rgb)/0.6)] border-[rgb(var(--color-border-strong-rgb)/0.5)] hover:border-[rgb(var(--color-border-strong-rgb)/0.7)] cursor-pointer'} ${className}`
                            : `${variant === 'field' ? 'w-full px-3 py-2 justify-between' : variant === 'compact' ? 'p-1' : 'px-2 py-1'} rounded border inline-flex items-center gap-2 ${disabled ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'} ${className}`
                        }
                        style={variant === 'icon' ? undefined : {
                            backgroundColor: variant === 'field'
                                ? 'var(--color-bg-secondary)'
                                : 'var(--color-bg-elevated)',
                            borderColor: 'var(--color-border-subtle)',
                            color: variant === 'field' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                            fontSize: variant === 'field' ? theme.fontSize.body : theme.fontSize.caption,
                        }}
                        title={value?.name ?? 'Set epic'}
                    >
                        {variant === 'icon' ? (
                            <span className="w-4 h-4 flex items-center justify-center">
                                <VscTag style={{ color: selectedScheme?.DEFAULT ?? 'var(--color-text-muted)' }} />
                            </span>
                        ) : (
                            <>
                                <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: selectedScheme?.DEFAULT ?? 'var(--color-text-muted)' }}
                                />
                                {variant !== 'compact' && (
                                    <>
                                        <span className={`truncate ${variant === 'field' ? 'flex-1 text-left' : 'max-w-[140px]'}`}>{value?.name ?? 'None'}</span>
                                        <span style={{ color: 'var(--color-text-muted)' }}>▾</span>
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

            <ConfirmModal
                open={Boolean(deleteTarget)}
                title={`Delete epic "${deleteTarget?.name ?? ''}"?`}
                body={
                    <div style={{ color: theme.colors.text.secondary, fontSize: theme.fontSize.body }}>
                        All sessions and specs in this epic will be moved to <strong>Ungrouped</strong>.
                    </div>
                }
                confirmText="Delete"
                cancelText="Cancel"
                variant="danger"
                loading={deleteLoading}
                onCancel={() => {
                    if (deleteLoading) {
                        return
                    }
                    setDeleteTarget(null)
                }}
                onConfirm={() => {
                    if (!deleteTarget || deleteLoading) {
                        return
                    }
                    void (async () => {
                        setDeleteLoading(true)
                        try {
                            if (value?.id === deleteTarget.id) {
                                await onChange(null)
                            }
                            await deleteEpic(deleteTarget.id)
                            setDeleteTarget(null)
                        } catch (err) {
                            logger.error('[EpicSelect] Failed to delete epic:', err)
                        } finally {
                            setDeleteLoading(false)
                        }
                    })()
                }}
            />
        </>
    )
}
