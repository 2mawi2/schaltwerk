import { useState, useEffect } from 'react'
import { theme } from '../../common/theme'
import { EnrichedSession } from '../../types/session'
import { VscFiles, VscClose } from 'react-icons/vsc'
import { SpecEditor } from '../plans/SpecEditor'
import { SpecPickerOverlay } from './SpecPickerOverlay'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { logger } from '../../utils/logger'

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
  onPickerClose
}: Props) {
  const [unsavedTabs] = useState<Set<string>>(new Set())
  const [, setRefreshTrigger] = useState(0)

  useEffect(() => {
    const cleanup = listenEvent(SchaltEvent.SessionsRefreshed, () => {
      logger.info('[SpecWorkspacePanel] Sessions refreshed - triggering re-render for spec updates')
      setRefreshTrigger(prev => prev + 1)
    })

    return () => {
      cleanup.then(unlisten => unlisten())
    }
  }, [])

  const activeSpec = specs.find(s => s.info.session_id === activeTab)

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: theme.colors.background.secondary }}>
      <div
        className="flex items-center border-b overflow-hidden"
        style={{ borderColor: theme.colors.border.default }}
      >
        <button
          onClick={onOpenPicker}
          className="flex items-center justify-center p-1.5 rounded-none transition-colors shrink-0 cursor-pointer sticky left-0 z-10"
          style={{
            color: theme.colors.text.tertiary,
            backgroundColor: theme.colors.background.secondary,
            borderRight: `1px solid ${theme.colors.border.default}`
          }}
          title="Open spec"
        >
          <VscFiles size={16} />
        </button>

        <div
          className="flex items-center gap-1 px-2 py-1 overflow-x-auto flex-1"
          style={{}}
        >
          {openTabs.map(specId => {
            const spec = specs.find(s => s.info.session_id === specId)
            if (!spec) return null

            const displayName = spec.info.display_name || spec.info.session_id
            const isActive = specId === activeTab
            const hasUnsaved = unsavedTabs.has(specId)

            return (
              <div
                key={specId}
                className="flex items-center gap-1 px-3 py-1.5 rounded transition-colors cursor-pointer group"
                style={{
                  backgroundColor: isActive
                    ? theme.colors.background.elevated
                    : 'transparent',
                  borderColor: isActive ? theme.colors.border.subtle : 'transparent',
                  color: isActive ? theme.colors.text.primary : theme.colors.text.secondary,
                  fontSize: theme.fontSize.label
                }}
                onClick={() => onTabChange(specId)}
                onMouseDown={event => {
                  if (event.button === 1) {
                    event.stopPropagation()
                    event.preventDefault()
                    onTabClose(specId)
                  }
                }}
              >
                <span className="max-w-[120px] truncate">{displayName}</span>
                {hasUnsaved && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px]"
                    style={{
                      backgroundColor: theme.colors.accent.amber.bg,
                      color: theme.colors.accent.amber.DEFAULT
                    }}
                  >
                    Edited
                  </span>
                )}
                <button
                  onClick={e => {
                    e.stopPropagation()
                    onTabClose(specId)
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-opacity-80"
                  style={{
                    color: theme.colors.text.tertiary,
                    backgroundColor: 'transparent'
                  }}
                  title="Close tab"
                >
                  <VscClose size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeSpec ? (
          <SpecEditor
            key={activeTab}
            sessionName={activeTab!}
            onStart={() => onStart?.(activeTab!)}
            disableFocusShortcut={true}
          />
        ) : (
          <div
            className="h-full flex flex-col items-center justify-center gap-4"
            style={{ color: theme.colors.text.tertiary }}
          >
            <p style={{ fontSize: theme.fontSize.body }}>No spec selected</p>
            <button
              onClick={onOpenPicker}
              className="px-4 py-2 rounded transition-colors"
              style={{
                backgroundColor: theme.colors.background.elevated,
                color: theme.colors.text.primary,
                fontSize: theme.fontSize.button
              }}
            >
              Open Spec
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
