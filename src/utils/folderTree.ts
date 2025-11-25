import type { ChangedFile } from '../common/events'

export interface FileNode {
  type: 'file'
  name: string
  path: string
  file: ChangedFile
}

export interface FolderNode {
  type: 'folder'
  name: string
  path: string
  children: TreeNode[]
  fileCount: number
  additions: number
  deletions: number
  isCompressed: boolean
}

export type TreeNode = FileNode | FolderNode

interface TreeBuilder {
  [key: string]: {
    files: ChangedFile[]
    folders: Set<string>
  }
}

export function buildFolderTree(files: ChangedFile[]): FolderNode {
  const root: FolderNode = {
    type: 'folder',
    name: '',
    path: '',
    children: [],
    fileCount: 0,
    additions: 0,
    deletions: 0,
    isCompressed: false,
  }

  if (files.length === 0) {
    return root
  }

  const builder: TreeBuilder = { '': { files: [], folders: new Set() } }

  for (const file of files) {
    const parts = file.path.split('/')

    if (parts.length === 1) {
      builder[''].files.push(file)
      continue
    }

    let currentPath = ''

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      const parentPath = currentPath
      currentPath = currentPath ? `${currentPath}/${part}` : part

      if (!builder[currentPath]) {
        builder[currentPath] = { files: [], folders: new Set() }
      }

      if (!builder[parentPath]) {
        builder[parentPath] = { files: [], folders: new Set() }
      }

      builder[parentPath].folders.add(currentPath)
    }

    const filePath = parts.slice(0, -1).join('/')
    if (!builder[filePath]) {
      builder[filePath] = { files: [], folders: new Set() }
    }
    builder[filePath].files.push(file)
  }

  root.children = buildNode('', builder)
  updateFolderStats(root)

  return root
}

function buildNode(path: string, builder: TreeBuilder): TreeNode[] {
  const node = builder[path]
  if (!node) return []

  const children: TreeNode[] = []

  for (const file of node.files) {
    const fileName = file.path.split('/').pop() || file.path
    children.push({
      type: 'file',
      name: fileName,
      path: file.path,
      file,
    })
  }

  for (const folderPath of node.folders) {
    const folderName = folderPath.split('/').pop() || folderPath
    const folderChildren = buildNode(folderPath, builder)

    const folder: FolderNode = {
      type: 'folder',
      name: folderName,
      path: folderPath,
      children: folderChildren,
      fileCount: 0,
      additions: 0,
      deletions: 0,
      isCompressed: false,
    }

    children.push(compressSingleChildFolders(folder))
  }

  return children.sort((a, b) => {
    if (a.type === 'folder' && b.type === 'file') return -1
    if (a.type === 'file' && b.type === 'folder') return 1
    return a.name.localeCompare(b.name)
  })
}

function compressSingleChildFolders(folder: FolderNode): FolderNode {
  if (folder.children.length !== 1 || folder.children[0].type !== 'folder') {
    return folder
  }

  const child = folder.children[0] as FolderNode

  const fileChildren = folder.children.filter(c => c.type === 'file')
  if (fileChildren.length > 0) {
    return folder
  }

  const compressedChild = compressSingleChildFolders(child)

  return {
    type: 'folder',
    name: `${folder.name}/${compressedChild.name}`,
    path: compressedChild.path,
    children: compressedChild.children,
    fileCount: 0,
    additions: 0,
    deletions: 0,
    isCompressed: true,
  }
}

function updateFolderStats(node: TreeNode): { fileCount: number; additions: number; deletions: number } {
  if (node.type === 'file') {
    return {
      fileCount: 1,
      additions: node.file.additions || 0,
      deletions: node.file.deletions || 0,
    }
  }

  let totalFiles = 0
  let totalAdditions = 0
  let totalDeletions = 0

  for (const child of node.children) {
    const stats = updateFolderStats(child)
    totalFiles += stats.fileCount
    totalAdditions += stats.additions
    totalDeletions += stats.deletions
  }

  node.fileCount = totalFiles
  node.additions = totalAdditions
  node.deletions = totalDeletions

  return { fileCount: totalFiles, additions: totalAdditions, deletions: totalDeletions }
}

export function getAllFolderPaths(node: FolderNode): Set<string> {
  const paths = new Set<string>()

  for (const child of node.children) {
    if (child.type === 'folder') {
      paths.add(child.path)
      const childPaths = getAllFolderPaths(child)
      childPaths.forEach(p => paths.add(p))
    }
  }

  return paths
}

export function getVisualFileOrder(node: FolderNode): string[] {
  const result: string[] = []

  for (const child of node.children) {
    if (child.type === 'file') {
      result.push(child.path)
    } else {
      result.push(...getVisualFileOrder(child))
    }
  }

  return result
}
