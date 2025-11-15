import { useState, useMemo, useEffect, useCallback, ReactNode } from 'react'
import { VscFolder, VscFolderOpened } from 'react-icons/vsc'
import { buildFolderTree, getAllFolderPaths, type TreeNode, type FolderNode, type FileNode } from '../../utils/folderTree'
import { theme } from '../../common/theme'
import type { ChangedFile } from '../../common/events'

interface FileTreeProps {
  files: ChangedFile[]
  renderFileNode: (node: FileNode, depth: number) => ReactNode
  renderFolderContent?: (node: FolderNode) => ReactNode
}

export function FileTree({ files, renderFileNode, renderFolderContent }: FileTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildFolderTree(files), [files])

  useEffect(() => {
    setExpandedFolders(getAllFolderPaths(tree))
  }, [tree])

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const renderFolderNode = (node: FolderNode, depth: number): ReactNode => {
    const isExpanded = expandedFolders.has(node.path)

    return (
      <div key={node.path}>
        <div
          className="cursor-pointer hover:bg-slate-800/30 flex items-center gap-1.5"
          style={{ paddingLeft: `${depth * 12 + 12}px`, paddingTop: '4px', paddingBottom: '4px' }}
          onClick={() => toggleFolder(node.path)}
        >
          {isExpanded ? (
            <VscFolderOpened size={14} style={{ color: theme.colors.accent.blue.light }} />
          ) : (
            <VscFolder size={14} style={{ color: theme.colors.text.muted }} />
          )}
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate" style={{ color: theme.colors.text.secondary }}>
              {node.name}
            </span>
            {renderFolderContent ? (
              renderFolderContent(node)
            ) : (
              <span className="text-xs flex-shrink-0" style={{ color: theme.colors.text.muted }}>
                ({node.fileCount})
              </span>
            )}
          </div>
        </div>
        {isExpanded && (
          <div>
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const renderTreeNode = (node: TreeNode, depth: number): ReactNode => {
    if (node.type === 'file') {
      return renderFileNode(node, depth)
    }
    return renderFolderNode(node, depth)
  }

  return (
    <>
      {tree.children.map(node => renderTreeNode(node, 0))}
    </>
  )
}
