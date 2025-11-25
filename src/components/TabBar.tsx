import { Tab } from './Tab'
import { ProjectTab } from '../common/projectTabs'
import { AddTabButton } from './AddTabButton'

interface TabBarProps {
  tabs: ProjectTab[]
  activeTabPath: string | null
  onSelectTab: (path: string) => void | Promise<void | boolean>
  onCloseTab: (path: string) => void | Promise<void>
  onOpenProjectSelector?: () => void
}

export function TabBar({ tabs, activeTabPath, onSelectTab, onCloseTab, onOpenProjectSelector }: TabBarProps) {
  if (tabs.length === 0) return null

  return (
    <div className="flex items-center h-full">
      {tabs.map((tab) => (
        <Tab
          key={tab.projectPath}
          projectPath={tab.projectPath}
          projectName={tab.projectName}
          attentionCount={tab.attentionCount}
          isActive={tab.projectPath === activeTabPath}
          onSelect={() => onSelectTab(tab.projectPath)}
          onClose={() => onCloseTab(tab.projectPath)}
        />
      ))}
      {onOpenProjectSelector && (
        <AddTabButton
          onClick={onOpenProjectSelector}
          title="Open another project"
          ariaLabel="Open another project"
          className="ml-1"
        />
      )}
    </div>
  )
}
