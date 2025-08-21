import React from 'react'
import { VscClose } from 'react-icons/vsc'

interface TabProps {
  projectPath: string
  projectName: string
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

export function Tab({ projectPath, projectName, isActive, onSelect, onClose }: TabProps) {
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClose()
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.stopPropagation()
      onClose()
    }
  }
  
  return (
    <div
      className={`
        h-full px-2.5 inline-flex items-center gap-1.5 cursor-pointer group relative transition-colors
        ${isActive 
          ? 'bg-slate-900 text-slate-100' 
          : 'bg-slate-950 text-slate-400 hover:bg-slate-900/50'
        }
      `}
      onClick={onSelect}
      onMouseDown={handleMouseDown}
      title={projectPath}
      style={{ 
        minWidth: '100px', 
        maxWidth: '180px',
        borderRight: '1px solid rgba(30, 41, 59, 0.5)',
        borderTop: isActive ? '1px solid #06b6d4' : '1px solid transparent',
        WebkitAppRegion: 'no-drag'
      } as React.CSSProperties}
    >
      <span className="text-[11px] truncate flex-1">
        {projectName}
      </span>
      <button
        onClick={handleClose}
        className={`
          rounded hover:bg-slate-700/60 transition-all p-0.5
          ${isActive 
            ? 'opacity-60 hover:opacity-100 text-slate-300 hover:text-slate-100' 
            : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-slate-400 hover:text-slate-200'
          }
        `}
        aria-label={`Close ${projectName}`}
      >
        <VscClose className="text-[10px]" />
      </button>
    </div>
  )
}