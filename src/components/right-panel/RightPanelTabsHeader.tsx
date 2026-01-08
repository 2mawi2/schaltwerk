import React from 'react'
import clsx from 'clsx'
import { VscDiff, VscGitCommit, VscInfo, VscNotebook, VscPreview } from 'react-icons/vsc'
import type { TabKey } from './RightPanelTabs.types'
import { useTranslation } from '../../common/i18n'
import './RightPanelTabsHeader.css'

interface RightPanelTabsHeaderProps {
  activeTab: TabKey
  localFocus: boolean
  showChangesTab: boolean
  showInfoTab: boolean
  showHistoryTab: boolean
  showSpecTab: boolean
  showSpecsTab: boolean
  showPreviewTab: boolean
  onSelectTab: (tab: TabKey) => void
}

const baseTabIconClass = 'w-4 h-4 shrink-0 text-base leading-none'
const specTabIconClass = baseTabIconClass

const buildButtonClass = (active: boolean, localFocus: boolean) => (
  clsx(
    'right-panel-tab h-full flex-1 px-3 text-xs font-medium flex items-center justify-center gap-1.5',
    active && 'right-panel-tab--active',
    localFocus && 'right-panel-tab--focus'
  )
)

interface TabDescriptor {
  key: TabKey
  label: string
  title: string
  icon: React.JSX.Element
  dataAttrs?: Record<string, string>
}

export const RightPanelTabsHeader = ({
  activeTab,
  localFocus,
  showChangesTab,
  showHistoryTab,
  showInfoTab,
  showSpecTab,
  showSpecsTab,
  showPreviewTab,
  onSelectTab
}: RightPanelTabsHeaderProps) => {
  const { t } = useTranslation()

  const descriptors: TabDescriptor[] = []

  if (showChangesTab) {
    descriptors.push({
      key: 'changes',
      label: t.rightPanelTabs.changes,
      title: t.rightPanelTabs.changesTitle,
      icon: <VscDiff className={baseTabIconClass} />
    })
  }

  if (showInfoTab) {
    descriptors.push({
      key: 'info',
      label: t.rightPanelTabs.info,
      title: t.rightPanelTabs.infoTitle,
      icon: <VscInfo className={baseTabIconClass} />
    })
  }

  if (showHistoryTab) {
    descriptors.push({
      key: 'history',
      label: t.rightPanelTabs.history,
      title: t.rightPanelTabs.historyTitle,
      icon: <VscGitCommit className={baseTabIconClass} />
    })
  }

  if (showSpecTab) {
    descriptors.push({
      key: 'agent',
      label: t.rightPanelTabs.spec,
      title: t.rightPanelTabs.specTitle,
      icon: <VscNotebook className={specTabIconClass} />,
      dataAttrs: { 'data-onboarding': 'specs-workspace-tab' }
    })
  }

  if (showSpecsTab) {
    descriptors.push({
      key: 'specs',
      label: t.rightPanelTabs.specs,
      title: t.rightPanelTabs.specsTitle,
      icon: <VscNotebook className={specTabIconClass} />,
      dataAttrs: { 'data-onboarding': 'specs-workspace-tab' }
    })
  }

  if (showPreviewTab) {
    descriptors.push({
      key: 'preview',
      label: t.rightPanelTabs.preview,
      title: t.rightPanelTabs.previewTitle,
      icon: <VscPreview className={baseTabIconClass} />
    })
  }

  if (descriptors.length === 0) return null

  return (
    <div className="right-panel-tabs-header h-8 flex items-center">
      {descriptors.map(({ key, label, title, icon, dataAttrs }) => (
        <button
          key={key}
          onClick={() => onSelectTab(key)}
          className={buildButtonClass(activeTab === key, localFocus)}
          data-active={activeTab === key || undefined}
          title={title}
          {...dataAttrs}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
