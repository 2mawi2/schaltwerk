import clsx from 'clsx'

interface SimpleDiffViewerProps {
  oldContent: string
  newContent: string
  viewMode?: 'split' | 'unified'
  leftTitle?: string
  rightTitle?: string
}

export function SimpleDiffViewer({
  oldContent,
  newContent,
  viewMode = 'split',
  leftTitle = 'Before',
  rightTitle = 'After'
}: SimpleDiffViewerProps) {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const maxLines = Math.max(oldLines.length, newLines.length)

  if (viewMode === 'split') {
    return (
      <div className="h-full flex flex-col animate-fadeIn">
        <div className="flex border-b border-slate-800">
          <div className="flex-1 px-3 py-2 text-xs text-slate-400 border-r border-slate-800">
            {leftTitle}
          </div>
          <div className="flex-1 px-3 py-2 text-xs text-slate-400">
            {rightTitle}
          </div>
        </div>
        <div className="flex-1 flex overflow-auto">
          <div className="flex-1 border-r border-slate-800">
            <pre className="text-xs text-slate-300 p-3 whitespace-pre-wrap">
              {oldContent || '(empty)'}
            </pre>
          </div>
          <div className="flex-1">
            <pre className="text-xs text-slate-300 p-3 whitespace-pre-wrap">
              {newContent || '(empty)'}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto animate-fadeIn">
      <div className="border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
        {leftTitle} → {rightTitle}
      </div>
      <div className="p-3">
        {Array.from({ length: maxLines }, (_, i) => {
          const oldLine = oldLines[i] || ''
          const newLine = newLines[i] || ''
          const isDifferent = oldLine !== newLine
          
          return (
            <div key={i} className="flex">
              <div className="w-8 text-xs text-slate-500 text-right pr-2">
                {i + 1}
              </div>
              <div className={clsx(
                'flex-1 text-xs whitespace-pre-wrap',
                isDifferent ? 'bg-green-900/20 text-green-300' : 'text-slate-300'
              )}>
                {newLine || oldLine}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}