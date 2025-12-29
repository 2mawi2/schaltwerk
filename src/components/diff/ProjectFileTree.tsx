import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscFile, VscFolder, VscFolderOpened, VscFileCode, VscSymbolFile, VscFileBinary, VscGoToFile } from 'react-icons/vsc'
import clsx from 'clsx'
import { isBinaryFileByExtension } from '../../utils/binaryDetection'
import { logger } from '../../utils/logger'
import { theme } from '../../common/theme'
import { useAtomValue } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'
import { useOpenInEditor } from '../../hooks/useOpenInEditor'
import { getFileCategoryFromPath } from '../../utils/fileTypes'
import { buildFileTree, type SimpleFolderNode, type SimpleFileNode, type SimpleTreeNode } from '../../utils/fileTree'

interface ProjectFileTreeProps {
  onFileSelect: (filePath: string) => void
  sessionNameOverride?: string
  isCommander?: boolean
  scrollPosition?: number
  onScrollPositionChange?: (position: number) => void
}

function getFileIcon(filePath: string) {
  if (isBinaryFileByExtension(filePath)) {
    return <VscFileBinary style={{ color: theme.colors.text.muted }} />
  }

  const category = getFileCategoryFromPath(filePath)

  switch (category) {
    case 'code':
      return <VscFileCode style={{ color: theme.colors.accent.cyan.DEFAULT }} />
    case 'config':
      return <VscSymbolFile style={{ color: theme.colors.accent.yellow.DEFAULT }} />
    case 'doc':
      return <VscFile style={{ color: theme.colors.accent.blue.DEFAULT }} />
    default:
      return <VscFile style={{ color: theme.colors.text.secondary }} />
  }
}

export function ProjectFileTree({ onFileSelect, sessionNameOverride, isCommander, scrollPosition, onScrollPositionChange }: ProjectFileTreeProps) {
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const currentProjectPath = useAtomValue(projectPathAtom)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { openInEditor } = useOpenInEditor({ sessionNameOverride, isCommander })

  const loadProjectFiles = useCallback(async () => {
    setIsLoading(true)
    try {
      const projectFiles = await invoke<string[]>(TauriCommands.SchaltwerkCoreListProjectFiles, { forceRefresh: false })
      setFiles(projectFiles)

      const foldersToExpand = new Set<string>()
      for (const file of projectFiles.slice(0, 50)) {
        const parts = file.split('/')
        let currentPath = ''
        for (let i = 0; i < parts.length - 1 && i < 2; i++) {
          currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
          foldersToExpand.add(currentPath)
        }
      }
      setExpandedFolders(foldersToExpand)
    } catch (error) {
      logger.error('Failed to load project files:', error)
      setFiles([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProjectFiles()
  }, [loadProjectFiles, currentProjectPath])

  const tree = useMemo(() => buildFileTree(files), [files])

  useLayoutEffect(() => {
    if (!isLoading && scrollPosition !== undefined && scrollPosition > 0 && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollPosition
    }
  }, [scrollPosition, isLoading])

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

  const handleFileClick = useCallback((filePath: string) => {
    if (scrollContainerRef.current && onScrollPositionChange) {
      onScrollPositionChange(scrollContainerRef.current.scrollTop)
    }
    setSelectedFile(filePath)
    onFileSelect(filePath)
  }, [onFileSelect, onScrollPositionChange])

  const renderFolderNode = (node: SimpleFolderNode, depth: number) => {
    const isExpanded = expandedFolders.has(node.path)

    return (
      <div key={node.path || 'root'}>
        {node.path && (
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
              <span className="text-xs flex-shrink-0" style={{ color: theme.colors.text.muted }}>
                ({node.fileCount})
              </span>
            </div>
          </div>
        )}
        {(isExpanded || !node.path) && (
          <div>
            {node.children.map(child => renderTreeNode(child, node.path ? depth + 1 : depth))}
          </div>
        )}
      </div>
    )
  }

  const renderFileNode = (node: SimpleFileNode, depth: number) => {
    return (
      <div
        key={node.path}
        className={clsx(
          'group flex items-center gap-2 rounded cursor-pointer',
          'hover:bg-slate-800/50',
          selectedFile === node.path && 'bg-slate-800/30'
        )}
        style={{ paddingLeft: `${depth * 12 + 12}px`, paddingTop: '4px', paddingBottom: '4px', paddingRight: '8px' }}
        onClick={() => handleFileClick(node.path)}
        data-selected={selectedFile === node.path}
        data-file-path={node.path}
      >
        {getFileIcon(node.path)}
        <span className="flex-1 text-sm truncate" style={{ color: theme.colors.text.primary }}>
          {node.name}
        </span>
        <button
          title="Open in editor"
          aria-label={`Open ${node.path} in editor`}
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-700 transition-opacity"
          style={{ color: theme.colors.text.secondary }}
          onClick={(e) => {
            e.stopPropagation()
            void openInEditor(node.path)
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = theme.colors.text.primary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = theme.colors.text.secondary
          }}
        >
          <VscGoToFile className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  const renderTreeNode = (node: SimpleTreeNode, depth: number) => {
    if (node.type === 'folder') {
      return renderFolderNode(node, depth)
    }
    return renderFileNode(node, depth)
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center" style={{ color: theme.colors.text.muted }}>
          <div className="text-sm">Loading files...</div>
        </div>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center" style={{ color: theme.colors.text.muted }}>
          <VscFile className="mx-auto mb-2 text-4xl opacity-50" />
          <div className="text-sm">No files found</div>
          <div className="text-xs mt-1">This project appears to be empty</div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium" style={{ color: theme.colors.text.secondary }}>
            Project Files
          </span>
          <span className="text-xs" style={{ color: theme.colors.text.muted }}>
            {files.length} files
          </span>
        </div>
      </div>
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-2 py-1">
        {renderFolderNode(tree, 0)}
      </div>
    </div>
  )
}
