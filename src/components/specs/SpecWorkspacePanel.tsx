import { useState } from 'react'
import { theme } from '../../common/theme'
import { typography } from '../../common/typography'
import { EnrichedSession } from '../../types/session'
import { VscFiles } from 'react-icons/vsc'
import { SpecEditor } from './SpecEditor'
import { SpecPickerOverlay } from './SpecPickerOverlay'
import { UnifiedTab } from '../UnifiedTab'
import { useTranslation } from '../../common/i18n'

interface Props {
  specs: EnrichedSession[]
  openTabs: string[]
  activeTab: string | null
  onTabChange: (specId: string) => void
  onTabClose: (specId: string) => void
  onOpenPicker: () => void
  onStart?: (specId: string) => void
  showPicker: boolean
  onPickerClose: () => void
  onReviewModeChange?: (isReviewing: boolean) => void
}

export function SpecWorkspacePanel({
  specs,
  openTabs,
  activeTab,
  onTabChange,
  onTabClose,
  onOpenPicker,
  onStart,
  showPicker,
  onPickerClose,
  onReviewModeChange
}: Props) {
  const { t } = useTranslation()
  const [unsavedTabs] = useState<Set<string>>(new Set())

  const activeSpec = specs.find(s => s.info.session_id === activeTab)

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <div
        className="h-8 max-h-8 flex-shrink-0 flex items-center overflow-x-auto overflow-y-hidden scrollbar-hide"
        style={{
          backgroundColor: 'var(--color-bg-tertiary)',
          borderBottom: '1px solid var(--color-border-subtle)',
          boxShadow: 'inset 0 -1px 0 var(--color-border-default)',
        }}
      >
        <button
          onClick={onOpenPicker}
          className="flex items-center justify-center shrink-0 cursor-pointer h-full"
          style={{
            width: '32px',
            color: 'var(--color-text-tertiary)',
            backgroundColor: 'transparent',
            borderRight: '1px solid var(--color-border-subtle)'
          }}
          title={t.specWorkspacePanel.openSpec}
        >
          <VscFiles size={16} />
        </button>

        {openTabs.map(specId => {
          const spec = specs.find(s => s.info.session_id === specId)
          if (!spec) return null

          const displayName = spec.info.display_name || spec.info.session_id
          const isActive = specId === activeTab
          const hasUnsaved = unsavedTabs.has(specId)

          return (
            <UnifiedTab
              key={specId}
              id={specId}
              label={displayName}
              isActive={isActive}
              onSelect={() => onTabChange(specId)}
              onClose={() => onTabClose(specId)}
              onMiddleClick={() => onTabClose(specId)}
              showCloseButton={true}
              className="h-full flex-shrink-0"
              style={{
                maxWidth: '150px',
                minWidth: '100px'
              }}
              badgeContent={hasUnsaved ? (
                <span
                  style={{
                    ...typography.caption,
                    lineHeight: theme.lineHeight.compact,
                    backgroundColor: 'var(--color-accent-amber-bg)',
                    color: 'var(--color-accent-amber)',
                    padding: '0 4px',
                    borderRadius: '4px'
                  }}
                >
                  {t.specWorkspacePanel.edited}
                </span>
              ) : undefined}
            />
          )
        })}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeSpec ? (
          <SpecEditor
            key={activeTab}
            sessionName={activeTab!}
            onStart={() => onStart?.(activeTab!)}
            disableFocusShortcut={true}
            onReviewModeChange={onReviewModeChange}
          />
        ) : (
          <div
            className="h-full flex flex-col items-center justify-center gap-4"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            <p style={{ fontSize: theme.fontSize.body }}>{t.specWorkspacePanel.noSpecSelected}</p>
            <button
              onClick={onOpenPicker}
              className="px-4 py-2 rounded transition-colors"
              style={{
                backgroundColor: 'var(--color-bg-elevated)',
                color: 'var(--color-text-primary)',
                fontSize: theme.fontSize.button
              }}
            >
              {t.specWorkspacePanel.openSpecButton}
            </button>
          </div>
        )}
      </div>

      {showPicker && (
        <SpecPickerOverlay
          specs={specs}
          onSelect={specId => {
            onTabChange(specId)
            onPickerClose()
          }}
          onClose={onPickerClose}
        />
      )}
    </div>
  )
}
