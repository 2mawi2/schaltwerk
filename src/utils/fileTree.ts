export interface SimpleFileNode {
  type: 'file'
  name: string
  path: string
}

export interface SimpleFolderNode {
  type: 'folder'
  name: string
  path: string
  children: SimpleTreeNode[]
  fileCount: number
}

export type SimpleTreeNode = SimpleFolderNode | SimpleFileNode

export function buildFileTree(files: string[]): SimpleFolderNode {
  const root: SimpleFolderNode = {
    type: 'folder',
    name: '',
    path: '',
    children: [],
    fileCount: 0,
  }

  if (files.length === 0) {
    return root
  }

  const folderMap = new Map<string, SimpleFolderNode>()
  folderMap.set('', root)

  const getOrCreateFolder = (folderPath: string): SimpleFolderNode => {
    if (folderMap.has(folderPath)) {
      return folderMap.get(folderPath)!
    }

    const parts = folderPath.split('/')
    const folderName = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')

    const folder: SimpleFolderNode = {
      type: 'folder',
      name: folderName,
      path: folderPath,
      children: [],
      fileCount: 0,
    }

    folderMap.set(folderPath, folder)

    const parent = getOrCreateFolder(parentPath)
    parent.children.push(folder)

    return folder
  }

  for (const filePath of files) {
    const parts = filePath.split('/')
    const fileName = parts[parts.length - 1]

    const fileNode: SimpleFileNode = {
      type: 'file',
      name: fileName,
      path: filePath,
    }

    const parentFolder = parts.length > 1 ? getOrCreateFolder(parts.slice(0, -1).join('/')) : root
    parentFolder.children.push(fileNode)
  }

  const sortChildren = (node: SimpleFolderNode) => {
    node.children.sort((a, b) => {
      if (a.type === 'folder' && b.type === 'file') return -1
      if (a.type === 'file' && b.type === 'folder') return 1
      return a.name.localeCompare(b.name)
    })
    for (const child of node.children) {
      if (child.type === 'folder') {
        sortChildren(child)
      }
    }
  }

  const countFiles = (node: SimpleFolderNode): number => {
    let count = 0
    for (const child of node.children) {
      if (child.type === 'file') {
        count++
      } else {
        count += countFiles(child)
      }
    }
    node.fileCount = count
    return count
  }

  sortChildren(root)
  countFiles(root)

  return root
}
