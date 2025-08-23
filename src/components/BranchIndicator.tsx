import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscSourceControl } from 'react-icons/vsc'

interface DevelopmentInfo {
  isDevelopment: boolean
  branch: string | null
}

export function BranchIndicator() {
  const [devInfo, setDevInfo] = useState<DevelopmentInfo | null>(null)

  useEffect(() => {
    const loadDevInfo = async () => {
      try {
        const info = await invoke<DevelopmentInfo>('get_development_info')
        setDevInfo(info)
      } catch (error) {
        console.error('Failed to get development info:', error)
      }
    }
    loadDevInfo()
  }, [])

  // Only show in development mode with a valid branch
  if (!devInfo?.isDevelopment || !devInfo.branch) {
    return null
  }

  return (
    <div className="flex items-center mr-3 px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400">
      <VscSourceControl className="mr-1" />
      <span className="font-mono">{devInfo.branch}</span>
    </div>
  )
}