import { describe, it, expect } from 'vitest'
import { buildFolderTree, type FolderNode, type FileNode } from './folderTree'
import type { ChangedFile } from '../common/events'

describe('buildFolderTree', () => {
  it('should build a simple tree from flat file list', () => {
    const files: ChangedFile[] = [
      { path: 'src/App.tsx', change_type: 'modified', additions: 10, deletions: 5, changes: 15 },
      { path: 'src/utils/helper.ts', change_type: 'added', additions: 20, deletions: 0, changes: 20 },
    ]

    const tree = buildFolderTree(files)

    expect(tree.type).toBe('folder')
    expect(tree.children).toHaveLength(1)

    const srcFolder = tree.children[0] as FolderNode
    expect(srcFolder.type).toBe('folder')
    expect(srcFolder.name).toBe('src')
    expect(srcFolder.fileCount).toBe(2)
    expect(srcFolder.children).toHaveLength(2)
  })

  it('should compress single-child folder chains', () => {
    const files: ChangedFile[] = [
      { path: 'src/main/java/com/company/App.java', change_type: 'modified', additions: 5, deletions: 2, changes: 7 },
      { path: 'src/main/java/com/company/util/Helper.java', change_type: 'added', additions: 10, deletions: 0, changes: 10 },
    ]

    const tree = buildFolderTree(files)

    const rootFolder = tree.children[0] as FolderNode
    expect(rootFolder.name).toBe('src/main/java/com/company')
    expect(rootFolder.isCompressed).toBe(true)
  })

  it('should not compress when there are multiple children at intermediate levels', () => {
    const files: ChangedFile[] = [
      { path: 'src/components/App.tsx', change_type: 'modified', additions: 5, deletions: 2, changes: 7 },
      { path: 'src/utils/helper.ts', change_type: 'added', additions: 10, deletions: 0, changes: 10 },
    ]

    const tree = buildFolderTree(files)

    const srcFolder = tree.children[0] as FolderNode
    expect(srcFolder.name).toBe('src')
    expect(srcFolder.isCompressed).toBe(false)
    expect(srcFolder.children).toHaveLength(2)
  })

  it('should handle files at root level', () => {
    const files: ChangedFile[] = [
      { path: 'README.md', change_type: 'modified', additions: 3, deletions: 1, changes: 4 },
      { path: 'package.json', change_type: 'modified', additions: 2, deletions: 0, changes: 2 },
    ]

    const tree = buildFolderTree(files)

    expect(tree.children).toHaveLength(2)
    expect(tree.children.every(child => child.type === 'file')).toBe(true)
  })

  it('should calculate folder statistics correctly', () => {
    const files: ChangedFile[] = [
      { path: 'src/App.tsx', change_type: 'modified', additions: 10, deletions: 5, changes: 15 },
      { path: 'src/utils/helper.ts', change_type: 'added', additions: 20, deletions: 0, changes: 20 },
      { path: 'src/utils/formatter.ts', change_type: 'deleted', additions: 0, deletions: 15, changes: 15 },
    ]

    const tree = buildFolderTree(files)
    const srcFolder = tree.children[0] as FolderNode

    expect(srcFolder.fileCount).toBe(3)
    expect(srcFolder.additions).toBe(30)
    expect(srcFolder.deletions).toBe(20)
  })

  it('should handle empty file list', () => {
    const tree = buildFolderTree([])
    expect(tree.children).toHaveLength(0)
  })

  it('should handle nested folders with mixed depths', () => {
    const files: ChangedFile[] = [
      { path: 'README.md', change_type: 'modified', additions: 1, deletions: 0, changes: 1 },
      { path: 'src/index.ts', change_type: 'modified', additions: 5, deletions: 2, changes: 7 },
      { path: 'src/components/deep/nested/Component.tsx', change_type: 'added', additions: 50, deletions: 0, changes: 50 },
    ]

    const tree = buildFolderTree(files)

    expect(tree.children).toHaveLength(2)

    const readmeFile = tree.children.find(child => child.type === 'file') as FileNode
    expect(readmeFile?.name).toBe('README.md')

    const srcFolder = tree.children.find(child => child.type === 'folder') as FolderNode
    expect(srcFolder?.fileCount).toBe(2)
  })

  it('should sort folders before files', () => {
    const files: ChangedFile[] = [
      { path: 'zebra.txt', change_type: 'modified', additions: 1, deletions: 0, changes: 1 },
      { path: 'src/app.ts', change_type: 'modified', additions: 5, deletions: 2, changes: 7 },
      { path: 'apple.txt', change_type: 'added', additions: 3, deletions: 0, changes: 3 },
    ]

    const tree = buildFolderTree(files)

    expect(tree.children[0].type).toBe('folder')
    expect((tree.children[0] as FolderNode).name).toBe('src')
    expect(tree.children[1].type).toBe('file')
    expect(tree.children[2].type).toBe('file')
  })

  it('should handle very deep Java-style paths', () => {
    const files: ChangedFile[] = [
      {
        path: 'src/main/java/com/example/project/module/service/impl/UserServiceImpl.java',
        change_type: 'modified',
        additions: 25,
        deletions: 10,
        changes: 35
      },
      {
        path: 'src/main/java/com/example/project/module/service/impl/AuthServiceImpl.java',
        change_type: 'added',
        additions: 100,
        deletions: 0,
        changes: 100
      },
    ]

    const tree = buildFolderTree(files)

    const rootFolder = tree.children[0] as FolderNode
    expect(rootFolder.name).toBe('src/main/java/com/example/project/module/service/impl')
    expect(rootFolder.isCompressed).toBe(true)
    expect(rootFolder.fileCount).toBe(2)
    expect(rootFolder.children).toHaveLength(2)
  })
})
