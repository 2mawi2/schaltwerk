import { 
  VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscFileBinary
} from 'react-icons/vsc'
import { isBinaryFileByExtension } from './binaryDetection'
import { theme } from '../common/theme'

export function getFileIcon(changeType: string, filePath: string) {
  if (isBinaryFileByExtension(filePath)) {
    return <VscFileBinary style={{ color: theme.colors.text.tertiary }} />
  }
  
  switch (changeType) {
    case 'added': return <VscDiffAdded style={{ color: theme.colors.accent.green.DEFAULT }} />
    case 'modified': return <VscDiffModified style={{ color: theme.colors.accent.amber.DEFAULT }} />
    case 'deleted': return <VscDiffRemoved style={{ color: theme.colors.accent.red.DEFAULT }} />
    default: return <VscFile style={{ color: theme.colors.accent.blue.DEFAULT }} />
  }
}