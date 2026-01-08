import { useCallback, useEffect, useMemo, useState } from 'react'
import { ResizableModal } from '../shared/ResizableModal'
import { theme } from '../../common/theme'
import { Dropdown, type DropdownItem } from '../inputs/Dropdown'
import { EPIC_COLOR_KEYS, type EpicColorKey, getEpicAccentScheme, labelForEpicColor } from '../../utils/epicColors'
import { getErrorMessage } from '../../types/errors'
import { logger } from '../../utils/logger'
import { useTranslation } from '../../common/i18n'

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
    const { t } = useTranslation()

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

    const title = mode === 'create' ? t.epicModal.createTitle : t.epicModal.editTitle
    const submitLabel = mode === 'create' ? t.epicModal.create : t.epicModal.save

    const selectedScheme = getEpicAccentScheme(color)
    const colorLabel = useMemo(() => {
        if (!color) {
            return t.epicModal.colorNone
        }
        const isKey = EPIC_COLOR_KEYS.includes(color as EpicColorKey)
        return isKey ? labelForEpicColor(color as EpicColorKey) : color
    }, [color, t.epicModal.colorNone])

    const colorItems = useMemo<DropdownItem[]>(() => {
        const items: DropdownItem[] = [
            { key: 'none', label: t.epicModal.colorNone },
            { key: 'separator', label: <div style={{ height: 1, backgroundColor: 'var(--color-border-subtle)' }} />, disabled: true },
            ...EPIC_COLOR_KEYS.map((key) => {
                const scheme = getEpicAccentScheme(key)
                return {
                    key,
                    label: (
                        <span className="flex items-center gap-2">
                            <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: scheme?.DEFAULT ?? 'var(--color-text-muted)' }}
                            />
                            <span>{labelForEpicColor(key)}</span>
                        </span>
                    ),
                }
            }),
        ]
        return items
    }, [t.epicModal.colorNone])

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
            setError(t.epicModal.nameRequired)
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
    }, [saving, name, onSubmit, color, onClose, t.epicModal.nameRequired])

    const footer = (
        <>
            <button
                type="button"
                onClick={onClose}
                className="px-3 h-9 rounded border"
                style={{
                    backgroundColor: 'var(--color-bg-elevated)',
                    color: 'var(--color-text-primary)',
                    borderColor: 'var(--color-border-subtle)',
                }}
            >
                {t.epicModal.cancel}
            </button>
            <button
                type="button"
                onClick={() => { void handleSubmit() }}
                disabled={saving}
                className="px-3 h-9 rounded text-white disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                    backgroundColor: 'var(--color-accent-blue)',
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
                    <label style={{ color: 'var(--color-text-secondary)', fontSize: theme.fontSize.caption }}>{t.epicModal.name}</label>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-2 rounded border"
                        style={{
                            backgroundColor: 'var(--color-bg-secondary)',
                            color: 'var(--color-text-primary)',
                            borderColor: error ? 'var(--color-accent-red-border)' : 'var(--color-border-subtle)',
                        }}
                        placeholder={t.epicModal.namePlaceholder}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label style={{ color: 'var(--color-text-secondary)', fontSize: theme.fontSize.caption }}>{t.epicModal.colorOptional}</label>
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
                                    backgroundColor: 'var(--color-bg-secondary)',
                                    color: 'var(--color-text-primary)',
                                    borderColor: 'var(--color-border-subtle)',
                                }}
                            >
                                <span className="flex items-center gap-2">
                                    <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: selectedScheme?.DEFAULT ?? 'var(--color-text-muted)' }}
                                    />
                                    <span>{colorLabel}</span>
                                </span>
                                <span style={{ color: 'var(--color-text-muted)' }}>▾</span>
                            </button>
                        )}
                    </Dropdown>
                </div>

                {error && (
                    <div
                        className="rounded px-3 py-2 border"
                        style={{
                            backgroundColor: 'var(--color-accent-red-bg)',
                            borderColor: 'var(--color-accent-red-border)',
                            color: 'var(--color-accent-red-light)',
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
