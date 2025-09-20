import { Tab } from './Tab'
import { ProjectTab } from '../common/projectTabs'

interface TabBarProps {
  tabs: ProjectTab[]
  activeTabPath: string | null
  onSelectTab: (path: string) => void | Promise<void | boolean>
  onCloseTab: (path: string) => void | Promise<void>
}

export function TabBar({ tabs, activeTabPath, onSelectTab, onCloseTab }: TabBarProps) {
  if (tabs.length === 0) return null
  
  return (
    <div className="flex items-center h-full">
      {tabs.map((tab) => (
        <Tab
          key={tab.projectPath}
          projectPath={tab.projectPath}
          projectName={tab.projectName}
          isActive={tab.projectPath === activeTabPath}
          onSelect={() => onSelectTab(tab.projectPath)}
          onClose={() => onCloseTab(tab.projectPath)}
        />
      ))}
    </div>
  )
}
