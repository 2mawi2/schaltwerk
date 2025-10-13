import { Tab } from './Tab'
import { ProjectTab } from '../common/projectTabs'
import { VscAdd } from 'react-icons/vsc'
import { theme } from '../common/theme'

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
          isActive={tab.projectPath === activeTabPath}
          onSelect={() => onSelectTab(tab.projectPath)}
          onClose={() => onCloseTab(tab.projectPath)}
        />
      ))}
      {onOpenProjectSelector && (
        <button
          onClick={onOpenProjectSelector}
          className="h-6 w-6 inline-flex items-center justify-center rounded ml-1 transition-colors"
          style={{
            color: theme.colors.text.tertiary,
            backgroundColor: 'transparent'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = theme.colors.text.secondary
            e.currentTarget.style.backgroundColor = `${theme.colors.background.elevated}80`
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = theme.colors.text.tertiary
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
          title="Open another project"
          aria-label="Open another project"
          data-no-drag
        >
          <VscAdd className="text-[14px]" />
        </button>
      )}
    </div>
  )
}
