import { useCallback, useEffect, useMemo, useState } from 'react'
import { ResizableModal } from '../shared/ResizableModal'
import { theme } from '../../common/theme'
import { Dropdown, type DropdownItem } from '../inputs/Dropdown'
import { EPIC_COLOR_KEYS, type EpicColorKey, getEpicAccentScheme, labelForEpicColor } from '../../utils/epicColors'
import { getErrorMessage } from '../../types/errors'
import { logger } from '../../utils/logger'

interface EpicModalProps {
    open: boolean
    mode: 'create' | 'edit'
    initialName?: string
    initialColor?: string | null
    onClose: () => void
    onSubmit: (data: { name: string; color: string | null }) => Promise<void>
}

export function EpicModal({ open, mode, initialName = '', initialColor = null, onClose, onSubmit }: EpicModalProps) {
    const [name, setName] = useState(initialName)
    const [color, setColor] = useState<string | null>(initialColor)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [colorMenuOpen, setColorMenuOpen] = useState(false)

    useEffect(() => {
        if (!open) {
            return
        }
        setName(initialName)
        setColor(initialColor)
        setSaving(false)
        setError(null)
        setColorMenuOpen(false)
    }, [open, initialName, initialColor])

    const title = mode === 'create' ? 'Create Epic' : 'Edit Epic'
    const submitLabel = mode === 'create' ? 'Create' : 'Save'

    const selectedScheme = getEpicAccentScheme(color)
    const colorLabel = useMemo(() => {
        if (!color) {
            return 'None'
        }
        const isKey = EPIC_COLOR_KEYS.includes(color as EpicColorKey)
        return isKey ? labelForEpicColor(color as EpicColorKey) : color
    }, [color])

    const colorItems = useMemo<DropdownItem[]>(() => {
        const items: DropdownItem[] = [
            { key: 'none', label: 'None' },
            { key: 'separator', label: <div style={{ height: 1, backgroundColor: theme.colors.border.subtle }} />, disabled: true },
            ...EPIC_COLOR_KEYS.map((key) => {
                const scheme = getEpicAccentScheme(key)
                return {
                    key,
                    label: (
                        <span className="flex items-center gap-2">
                            <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: scheme?.DEFAULT ?? theme.colors.text.muted }}
                            />
                            <span>{labelForEpicColor(key)}</span>
                        </span>
                    ),
                }
            }),
        ]
        return items
    }, [])

    const handleColorSelect = useCallback((key: string) => {
        if (key === 'none') {
            setColor(null)
            return
        }
        if (key === 'separator') {
            return
        }
        setColor(key)
    }, [])

    const handleSubmit = useCallback(async () => {
        if (saving) {
            return
        }
        const trimmed = name.trim()
        if (!trimmed) {
            setError('Name is required')
            return
        }

        setSaving(true)
        setError(null)
        try {
            await onSubmit({ name: trimmed, color })
            onClose()
        } catch (err) {
            logger.error('[EpicModal] Failed to save epic:', err)
            setError(getErrorMessage(err))
        } finally {
            setSaving(false)
        }
    }, [saving, name, onSubmit, color, onClose])

    const footer = (
        <>
            <button
                type="button"
                onClick={onClose}
                className="px-3 h-9 rounded border"
                style={{
                    backgroundColor: theme.colors.background.elevated,
                    color: theme.colors.text.primary,
                    borderColor: theme.colors.border.subtle,
                }}
            >
                Cancel
            </button>
            <button
                type="button"
                onClick={() => { void handleSubmit() }}
                disabled={saving}
                className="px-3 h-9 rounded text-white disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                    backgroundColor: theme.colors.accent.blue.DEFAULT,
                }}
            >
                {submitLabel}
            </button>
        </>
    )

    return (
        <ResizableModal
            isOpen={open}
            onClose={onClose}
            title={title}
            storageKey="epic-modal"
            defaultWidth={420}
            defaultHeight={260}
            minWidth={380}
            minHeight={240}
            footer={footer}
        >
            <form
                className="p-4 flex flex-col gap-4"
                onSubmit={(e) => {
                    e.preventDefault()
                    void handleSubmit()
                }}
            >
                <div className="flex flex-col gap-1">
                    <label style={{ color: theme.colors.text.secondary, fontSize: theme.fontSize.caption }}>Name</label>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-2 rounded border"
                        style={{
                            backgroundColor: theme.colors.background.secondary,
                            color: theme.colors.text.primary,
                            borderColor: error ? theme.colors.accent.red.border : theme.colors.border.subtle,
                        }}
                        placeholder="billing-v2"
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label style={{ color: theme.colors.text.secondary, fontSize: theme.fontSize.caption }}>Color (optional)</label>
                    <Dropdown
                        open={colorMenuOpen}
                        onOpenChange={setColorMenuOpen}
                        items={colorItems}
                        selectedKey={color ?? 'none'}
                        onSelect={handleColorSelect}
                        align="left"
                    >
                        {({ toggle }) => (
                            <button
                                type="button"
                                onClick={toggle}
                                className="w-full px-3 py-2 rounded border flex items-center justify-between"
                                style={{
                                    backgroundColor: theme.colors.background.secondary,
                                    color: theme.colors.text.primary,
                                    borderColor: theme.colors.border.subtle,
                                }}
                            >
                                <span className="flex items-center gap-2">
                                    <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: selectedScheme?.DEFAULT ?? theme.colors.text.muted }}
                                    />
                                    <span>{colorLabel}</span>
                                </span>
                                <span style={{ color: theme.colors.text.muted }}>▾</span>
                            </button>
                        )}
                    </Dropdown>
                </div>

                {error && (
                    <div
                        className="rounded px-3 py-2 border"
                        style={{
                            backgroundColor: theme.colors.accent.red.bg,
                            borderColor: theme.colors.accent.red.border,
                            color: theme.colors.accent.red.light,
                            fontSize: theme.fontSize.caption,
                        }}
                    >
                        {error}
                    </div>
                )}
            </form>
        </ResizableModal>
    )
}
