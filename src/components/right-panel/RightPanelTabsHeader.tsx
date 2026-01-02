import React from 'react'
import clsx from 'clsx'
import { VscDiff, VscGitCommit, VscInfo, VscNotebook, VscPreview } from 'react-icons/vsc'
import type { TabKey } from './RightPanelTabs.types'

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
    'h-full flex-1 px-3 text-xs font-medium flex items-center justify-center gap-1.5',
    active
      ? localFocus
        ? 'text-accent-blue bg-accent-blue/20'
        : 'text-secondary bg-elevated'
      : localFocus
        ? 'text-accent-blue hover:text-accent-blue hover:bg-accent-blue/10'
        : 'text-muted hover:text-secondary hover:bg-hover'
  )
)

interface TabDescriptor {
  key: TabKey
  label: string
  title: string
  icon: React.JSX.Element
  dataAttrs?: Record<string, string>
}

const buildDescriptors = ({
  showChangesTab,
  showHistoryTab,
  showInfoTab,
  showSpecTab,
  showSpecsTab,
  showPreviewTab
}: Pick<RightPanelTabsHeaderProps, 'showChangesTab' | 'showHistoryTab' | 'showInfoTab' | 'showSpecTab' | 'showSpecsTab' | 'showPreviewTab'>): TabDescriptor[] => {
  const descriptors: TabDescriptor[] = []

  if (showChangesTab) {
    descriptors.push({
      key: 'changes',
      label: 'Changes',
      title: 'Changes',
      icon: <VscDiff className={baseTabIconClass} />
    })
  }

  if (showInfoTab) {
    descriptors.push({
      key: 'info',
      label: 'Info',
      title: 'Spec Info',
      icon: <VscInfo className={baseTabIconClass} />
    })
  }

  if (showHistoryTab) {
    descriptors.push({
      key: 'history',
      label: 'History',
      title: 'Git History',
      icon: <VscGitCommit className={baseTabIconClass} />
    })
  }

  if (showSpecTab) {
    descriptors.push({
      key: 'agent',
      label: 'Spec',
      title: 'Spec',
      icon: <VscNotebook className={specTabIconClass} />,
      dataAttrs: { 'data-onboarding': 'specs-workspace-tab' }
    })
  }

  if (showSpecsTab) {
    descriptors.push({
      key: 'specs',
      label: 'Specs',
      title: 'Specs Workspace',
      icon: <VscNotebook className={specTabIconClass} />,
      dataAttrs: { 'data-onboarding': 'specs-workspace-tab' }
    })
  }

  if (showPreviewTab) {
    descriptors.push({
      key: 'preview',
      label: 'Preview',
      title: 'Web Preview',
      icon: <VscPreview className={baseTabIconClass} />
    })
  }

  return descriptors
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
  const descriptors = buildDescriptors({ showChangesTab, showHistoryTab, showInfoTab, showSpecTab, showSpecsTab, showPreviewTab })

  if (descriptors.length === 0) return null

  return (
    <div className="h-8 flex items-center border-b border-default">
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
