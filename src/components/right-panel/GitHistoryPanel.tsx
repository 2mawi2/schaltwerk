import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from '../../contexts/SelectionContext'
import clsx from 'clsx'
import { SimpleDiffViewer } from '../diff/SimpleDiffViewer'
import { VscGitCommit, VscChevronLeft } from 'react-icons/vsc'

interface CommitInfo {
  hash: string
  parents: string[]
  author: string
  email: string
  date: string
  message: string
}

interface CommitChangedFile { path: string; change_type: string }

export function GitHistoryPanel() {
  const { selection } = useSelection()
  const sessionName = selection.kind === 'session' ? selection.payload : null

  // History pagination and data
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileList, setFileList] = useState<CommitChangedFile[]>([])
  const [fileDiff, setFileDiff] = useState<{ oldText: string; newText: string } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const loadPage = useCallback(async (page: number) => {
    if (isLoading || !hasMore) return
    setIsLoading(true)
    try {
      const pageSize = 400 // large but manageable, virtualized render
      const next = await invoke<CommitInfo[]>(
        'get_git_history',
        { sessionName, skip: page * pageSize, limit: pageSize }
      )
      setCommits(prev => prev.concat(next))
      setHasMore(next.length === pageSize)
    } catch (e) {
      console.error('Failed to load git history', e)
      setHasMore(false)
    } finally {
      setIsLoading(false)
    }
  }, [sessionName, isLoading, hasMore])

  // Initial load and reset on context change
  useEffect(() => {
    setCommits([])
    setHasMore(true)
    setSelectedCommit(null)
    setSelectedFile(null)
    setFileDiff(null)
    // Reset first page synchronously
    ;(async () => {
      await loadPage(0)
    })()
  }, [sessionName, selection.kind])

  // Infinite scroll for history
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    let page = 0
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
        page += 1
        loadPage(page)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [loadPage])

  // Compute lanes for a simplified graph similar to VS Code
  const lanesForCommit = useMemo(() => {
    // Map commit hash to lane index, assign greedily to keep few lanes
    const laneByHash = new Map<string, number>()
    const freeLanes: number[] = []
    let nextLane = 0

    const assigned: number[] = []
    for (const c of commits) {
      let lane: number
      if (laneByHash.has(c.hash)) {
        lane = laneByHash.get(c.hash) as number
      } else if (freeLanes.length) {
        lane = freeLanes.shift() as number
      } else {
        lane = nextLane++
      }
      assigned.push(lane)
      // Parent reservations: keep branch continuation visually
      for (const p of c.parents) {
        if (!laneByHash.has(p)) laneByHash.set(p, lane)
      }
      // If no parents, free lane on next iteration
      if (c.parents.length === 0) {
        freeLanes.push(lane)
      }
    }
    return assigned
  }, [commits])

  const maxLane = useMemo(() => (lanesForCommit.length ? Math.max(...lanesForCommit) : 0), [lanesForCommit])

  const handleSelectCommit = useCallback(async (c: CommitInfo) => {
    setSelectedCommit(c)
    setSelectedFile(null)
    setFileDiff(null)
    try {
      const files = await invoke<CommitChangedFile[]>('get_commit_files', { sessionName, commit: c.hash })
      setFileList(files)
    } catch (e) {
      console.error('Failed to load commit files', e)
      setFileList([])
    }
  }, [sessionName])

  const handleSelectFile = useCallback(async (filePath: string) => {
    if (!selectedCommit) return
    setSelectedFile(filePath)
    try {
      const [oldText, newText] = await invoke<[string, string]>('get_commit_file_contents', {
        sessionName,
        commit: selectedCommit.hash,
        filePath,
      })
      setFileDiff({ oldText, newText })
    } catch (e) {
      console.error('Failed to load file contents', e)
      setFileDiff(null)
    }
  }, [sessionName, selectedCommit])

  // Colors aligned with theme
  const laneColors = useMemo(() => {
    const palette = [
      '#60a5fa', // blue-400
      '#f472b6', // pink-400
      '#34d399', // emerald-400
      '#fbbf24', // amber-400
      '#a78bfa', // violet-400
      '#f87171', // red-400
      '#22d3ee', // cyan-400
    ]
    return (index: number) => palette[index % palette.length]
  }, [])

  const historyView = (
    <div ref={listRef} className="flex-1 overflow-auto bg-panel">
      <div className="divide-y divide-slate-800">
        {commits.length === 0 && !isLoading && (
          <div className="p-3 text-xs text-slate-500">No commits found</div>
        )}
        {commits.map((c, i) => {
          const lane = lanesForCommit[i] || 0
          return (
            <button
              key={c.hash}
              className={clsx(
                'w-full text-left flex items-stretch gap-3 px-3 py-2 hover:bg-slate-800/40 transition-colors',
                selectedCommit?.hash === c.hash && 'bg-slate-800/50'
              )}
              onClick={() => handleSelectCommit(c)}
            >
              {/* Graph column */}
              <div className="relative" style={{ width: Math.max(1, (maxLane + 1)) * 12 }}>
                {/* vertical lane lines */}
                <svg width={Math.max(1, (maxLane + 1)) * 12} height={32}>
                  {/* current commit dot */}
                  <circle cx={lane * 12 + 6} cy={16} r={4} fill={laneColors(lane)} />
                  {/* draw edges to parents (simple lines to same lane when reserved) */}
                  {c.parents.slice(0, 2).map((_, idx) => (
                    <line key={idx} x1={lane * 12 + 6} y1={16} x2={lane * 12 + 6} y2={32} stroke={laneColors(lane)} strokeWidth={2} />
                  ))}
                </svg>
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <VscGitCommit className="text-slate-400" />
                  <div className="truncate text-slate-200 text-sm font-medium">{c.message || '(no message)'}</div>
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {c.author} • {new Date(c.date).toLocaleString()} • {c.hash.substring(0, 7)}
                </div>
              </div>
            </button>
          )
        })}
        {isLoading && (
          <div className="p-3 text-xs text-slate-500">Loading…</div>
        )}
        {!hasMore && commits.length > 0 && (
          <div className="p-3 text-xs text-slate-500">End of history</div>
        )}
      </div>
    </div>
  )

  const filesView = selectedCommit && (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center gap-1"
            onClick={() => { setSelectedCommit(null); setSelectedFile(null); setFileDiff(null) }}
            title="Back to history"
          >
            <VscChevronLeft /> Back
          </button>
          <div className="text-xs text-slate-400 truncate">{selectedCommit.message} • {selectedCommit.hash.substring(0, 7)}</div>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-2 min-h-0">
        <div className="border-r border-slate-800 overflow-auto">
          <div className="p-2">
            {fileList.length === 0 && (
              <div className="text-xs text-slate-500 px-2 py-3">No file changes in this commit</div>
            )}
            {fileList.map(f => (
              <div
                key={f.path}
                className={clsx(
                  'px-2 py-1.5 rounded cursor-pointer hover:bg-slate-800/50 text-sm truncate',
                  selectedFile === f.path && 'bg-slate-800/30'
                )}
                onClick={() => handleSelectFile(f.path)}
                title={f.path}
              >
                <span className="text-xs text-slate-500 mr-2">{f.change_type}</span>
                {f.path}
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden">
          {!fileDiff ? (
            <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
              Select a file to view diff
            </div>
          ) : (
            <SimpleDiffViewer
              oldContent={fileDiff.oldText}
              newContent={fileDiff.newText}
              viewMode="split"
              leftTitle="Parent"
              rightTitle="Commit"
            />
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-panel">
      <div className="h-8 flex items-center border-b border-slate-800 px-3 text-xs text-slate-400">
        Git History
      </div>
      <div className="flex-1 min-h-0 flex">
        {!selectedCommit ? historyView : filesView}
      </div>
    </div>
  )
}
