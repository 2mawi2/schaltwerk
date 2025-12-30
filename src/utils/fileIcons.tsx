import { 
  VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscFileBinary
} from 'react-icons/vsc'
import { isBinaryFileByExtension } from './binaryDetection'

export function getFileIcon(changeType: string, filePath: string) {
  if (isBinaryFileByExtension(filePath)) {
    return <VscFileBinary style={{ color: 'var(--color-text-tertiary)' }} />
  }
  
  switch (changeType) {
    case 'added': return <VscDiffAdded style={{ color: 'var(--color-accent-green)' }} />
    case 'modified': return <VscDiffModified style={{ color: 'var(--color-accent-amber)' }} />
    case 'deleted': return <VscDiffRemoved style={{ color: 'var(--color-accent-red)' }} />
    default: return <VscFile style={{ color: 'var(--color-accent-blue)' }} />
  }
}
