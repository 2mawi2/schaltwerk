import React from 'react'
import clsx from 'clsx'
import { VscDiff, VscGitCommit, VscInfo, VscNotebook } from 'react-icons/vsc'
import type { TabKey } from './RightPanelTabs.types'

interface RightPanelTabsHeaderProps {
  activeTab: TabKey
  localFocus: boolean
  showChangesTab: boolean
  showInfoTab: boolean
  showHistoryTab: boolean
  showSpecTab: boolean
  showSpecsTab: boolean
  onSelectTab: (tab: TabKey) => void
}

const baseTabIconClass = 'w-4 h-4 shrink-0 text-base leading-none'
const specTabIconClass = baseTabIconClass

const buildButtonClass = (active: boolean, localFocus: boolean) => (
  clsx(
    'h-full flex-1 px-3 text-xs font-medium flex items-center justify-center gap-1.5',
    active
      ? localFocus
        ? 'text-cyan-200 bg-cyan-800/30'
        : 'text-slate-200 bg-slate-800/50'
      : localFocus
        ? 'text-cyan-300 hover:text-cyan-200 hover:bg-cyan-800/20'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
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
  showSpecsTab
}: Pick<RightPanelTabsHeaderProps, 'showChangesTab' | 'showHistoryTab' | 'showInfoTab' | 'showSpecTab' | 'showSpecsTab'>): TabDescriptor[] => {
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
  onSelectTab
}: RightPanelTabsHeaderProps) => {
  const descriptors = buildDescriptors({ showChangesTab, showHistoryTab, showInfoTab, showSpecTab, showSpecsTab })

  if (descriptors.length === 0) return null

  return (
    <div className="h-8 flex items-center border-b border-slate-800">
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
