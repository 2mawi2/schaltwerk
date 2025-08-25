import { 
  VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscFileBinary
} from 'react-icons/vsc'
import { isBinaryFileByExtension } from './binaryDetection'

export function getFileIcon(changeType: string, filePath: string) {
  if (isBinaryFileByExtension(filePath)) {
    return <VscFileBinary className="text-slate-400" />
  }
  
  switch (changeType) {
    case 'added': return <VscDiffAdded className="text-green-500" />
    case 'modified': return <VscDiffModified className="text-yellow-500" />
    case 'deleted': return <VscDiffRemoved className="text-red-500" />
    default: return <VscFile className="text-blue-500" />
  }
}