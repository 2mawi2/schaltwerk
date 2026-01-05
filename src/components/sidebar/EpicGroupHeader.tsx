import clsx from 'clsx'
import { theme } from '../../common/theme'
import { type Epic } from '../../types/session'
import { getEpicAccentScheme } from '../../utils/epicColors'
import { Dropdown } from '../inputs/Dropdown'
import { useTranslation } from '../../common/i18n'

type EpicGroupHeaderProps = {
    epic: Epic
    collapsed: boolean
    countLabel: string
    menuOpen: boolean
    onMenuOpenChange: (open: boolean) => void
    onToggleCollapsed: () => void
    onEdit: () => void
    onDelete: () => void
}

export function EpicGroupHeader({
    epic,
    collapsed,
    countLabel,
    menuOpen,
    onMenuOpenChange,
    onToggleCollapsed,
    onEdit,
    onDelete,
}: EpicGroupHeaderProps) {
    const { t } = useTranslation()
    const scheme = getEpicAccentScheme(epic.color)

    return (
        <div
            data-testid={`epic-header-${epic.id}`}
            className="mt-3 mb-2 rounded border"
            style={{
                backgroundColor: 'var(--color-bg-tertiary)',
                borderColor: 'var(--color-border-default)',
            }}
        >
            <div className="flex items-center justify-between px-2 py-1.5">
                <button
                    type="button"
                    onClick={onToggleCollapsed}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    style={{ color: 'var(--color-text-primary)' }}
                >
                    <span
                        className={clsx('transition-transform', collapsed ? 'rotate-0' : 'rotate-90')}
                        aria-hidden="true"
                    >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path
                                fillRule="evenodd"
                                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                                clipRule="evenodd"
                            />
                        </svg>
                    </span>
                    <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: scheme?.DEFAULT ?? 'var(--color-text-muted)' }}
                    />
                    <span className="truncate">{epic.name}</span>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <span style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}>
                        {countLabel}
                    </span>
                    <Dropdown
                        open={menuOpen}
                        onOpenChange={onMenuOpenChange}
                        items={[
                            { key: 'edit', label: t.epicGroup.editEpic },
                            { key: 'delete', label: t.epicGroup.deleteEpic },
                        ]}
                        onSelect={(key) => {
                            if (key === 'edit') {
                                onEdit()
                            } else if (key === 'delete') {
                                onDelete()
                            }
                        }}
                        align="right"
                    >
                        {({ toggle }) => (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    toggle()
                                }}
                                className="p-1 rounded hover:opacity-80"
                                style={{
                                    color: 'var(--color-text-muted)',
                                    backgroundColor: 'transparent',
                                }}
                                title={t.epicGroup.epicActions}
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                            </button>
                        )}
                    </Dropdown>
                </div>
            </div>
        </div>
    )
}
