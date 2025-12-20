import { atomFamily, atomWithStorage } from 'jotai/utils'
import { layoutStorage } from './layout'

export type CopyContextChangedFilesSelection = {
  /**
   * `null` means "all changed files are selected".
   * An empty array means "no files selected".
   */
  selectedFilePaths: string[] | null
}

export type CopyContextBundleSelection = {
  spec: boolean
  diff: boolean
  files: boolean
}

const encodeKeyPart = (value: string) => encodeURIComponent(value)

export const buildCopyContextChangedFilesSelectionKey = (
  projectPath: string | null | undefined,
  sessionName: string
) => {
  const projectKey = encodeKeyPart(projectPath ?? 'unknown-project')
  const sessionKey = encodeKeyPart(sessionName)
  return `schaltwerk:copyContext:selectedChangedFiles:${projectKey}:${sessionKey}`
}

export const copyContextChangedFilesSelectionAtomFamily = atomFamily((storageKey: string) =>
  atomWithStorage<CopyContextChangedFilesSelection>(
    storageKey,
    { selectedFilePaths: null },
    layoutStorage,
    { getOnInit: true }
  )
)

export const buildCopyContextBundleSelectionKey = (projectPath: string | null | undefined, sessionName: string) => {
  const projectKey = encodeKeyPart(projectPath ?? 'unknown-project')
  const sessionKey = encodeKeyPart(sessionName)
  return `schaltwerk:copyContext:bundleSelection:${projectKey}:${sessionKey}`
}

export const copyContextBundleSelectionAtomFamily = atomFamily((storageKey: string) =>
  atomWithStorage<CopyContextBundleSelection>(
    storageKey,
    { spec: false, diff: false, files: false },
    layoutStorage,
    { getOnInit: true }
  )
)
