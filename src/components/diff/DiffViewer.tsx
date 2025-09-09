import React from 'react'
import clsx from 'clsx'
import { VscComment } from 'react-icons/vsc'
import { getFileIcon } from '../../utils/fileIcons'
import { DiffLineRow } from './DiffLineRow'
import { ChangedFile } from './DiffFileExplorer'
import { FileDiffData } from './loadDiffs'
import { AnimatedText } from '../common/AnimatedText'
import { ReviewComment } from '../../types/review'
import { LineSelection } from '../../hooks/useLineSelection'

export interface DiffViewerProps {
  files: ChangedFile[]
  selectedFile: string | null
  allFileDiffs: Map<string, FileDiffData>
  fileError: string | null
  branchInfo: {
    currentBranch: string
    baseBranch: string
    baseCommit: string
    headCommit: string
  } | null
  expandedSections: Set<string>
  isLargeDiffMode: boolean
  visibleFileSet: Set<string>
  loadingFiles: Set<string>
  observerRef: React.MutableRefObject<IntersectionObserver | null>
  scrollContainerRef: React.RefObject<HTMLDivElement>
  fileRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  getCommentsForFile: (filePath: string) => ReviewComment[]
  getCommentForLine: (lineNum: number | undefined, side: 'old' | 'new') => ReviewComment | undefined
  highlightCode: (code: string) => string
  toggleCollapsed: (idx: string | number) => void
  handleLineMouseDown: (lineNum: number, side: 'old' | 'new', event: React.MouseEvent) => void
  handleLineMouseEnter: (lineNum: number, side: 'old' | 'new') => void
  handleLineMouseLeave: () => void
  handleLineMouseUp: (event: React.MouseEvent) => void
  lineSelection: {
    isLineSelected: (lineNum: number, side: 'old' | 'new') => boolean
    selection: LineSelection | null
  }
}

export function DiffViewer({
  files,
  selectedFile,
  allFileDiffs,
  fileError,
  branchInfo,
  expandedSections,
  isLargeDiffMode,
  visibleFileSet,
  loadingFiles,
  observerRef,
  scrollContainerRef,
  fileRefs,
  getCommentsForFile,
  getCommentForLine,
  highlightCode,
  toggleCollapsed,
  handleLineMouseDown,
  handleLineMouseEnter,
  handleLineMouseLeave,
  handleLineMouseUp,
  lineSelection
}: DiffViewerProps) {
  
  if (!selectedFile && files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <AnimatedText text="loading" colorClassName="text-slate-500" size="md" />
      </div>
    )
  }

  if (fileError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-8">
          <div className="text-6xl mb-4 text-slate-600">⚠️</div>
          <div className="text-lg font-medium text-slate-400 mb-2">Cannot Display Diff</div>
          <div className="text-sm text-slate-500">{fileError}</div>
          <div className="text-xs text-slate-600 mt-4">
            This file type cannot be compared in the diff viewer.
          </div>
        </div>
      </div>
    )
  }

  if (selectedFile && allFileDiffs.get(selectedFile)?.isBinary) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-8">
          <div className="text-6xl mb-4 text-slate-500">📄</div>
          <div className="text-lg font-medium text-slate-300 mb-2">Binary File</div>
          <div className="text-sm text-slate-400 mb-4">
            {allFileDiffs.get(selectedFile)?.unsupportedReason || "This file cannot be displayed in the diff viewer"}
          </div>
          <div className="text-xs text-slate-500">
            Binary files are not shown to prevent performance issues.
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {branchInfo && (
        <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-700 bg-slate-950">
          {branchInfo.baseBranch} ({branchInfo.baseCommit.slice(0, 7)}) → {branchInfo.currentBranch} ({branchInfo.headCommit.slice(0, 7)})
        </div>
      )}

      {/* Skeleton placeholder for initial frame to avoid flash of empty content */}
      {allFileDiffs.size === 0 && files.length > 0 && (
        <div className="p-4 text-slate-600">Preparing preview…</div>
      )}

      <div className="flex-1 overflow-auto font-mono text-sm" ref={scrollContainerRef}>
        {/* In large diff mode, only render the selected file */}
        {isLargeDiffMode ? (
          files.filter(f => f.path === selectedFile).map((file) => {
            const fileDiff = allFileDiffs.get(file.path)
            const commentCount = getCommentsForFile(file.path).length
            const isCurrentFile = true
            
            return (
              <div 
                key={file.path} 
                ref={(el) => {
                  if (el) fileRefs.current.set(file.path, el)
                }}
                className="border-b border-slate-800 last:border-b-0"
              >
                {/* File header */}
                <div 
                  className={clsx(
                    "sticky top-0 z-10 bg-slate-950 border-b border-slate-700 px-4 py-3 flex items-center justify-between",
                    isCurrentFile && "bg-slate-900"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {getFileIcon(file.change_type, file.path)}
                    <div>
                      <div className="font-medium text-sm text-slate-100">{file.path}</div>
                      <div className="text-xs text-slate-400">
                        {file.change_type === 'added' && 'New file'}
                        {file.change_type === 'deleted' && 'Deleted file'}
                        {file.change_type === 'modified' && 'Modified'}
                        {file.change_type === 'renamed' && 'Renamed'}
                      </div>
                    </div>
                  </div>
                  {commentCount > 0 && (
                    <div className="flex items-center gap-1 text-sm text-blue-400">
                      <VscComment />
                      <span>{commentCount} comment{commentCount > 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
                
                {/* File diff content or loading placeholder */}
                {!fileDiff ? (
                  <div className="px-4 py-8 text-center text-slate-500">
                    <AnimatedText text="loading" colorClassName="text-slate-500" size="sm" />
                  </div>
                ) : (
                <table className="w-full" style={{ tableLayout: 'fixed' }}>
                  <tbody>
                    {('diffResult' in fileDiff ? fileDiff.diffResult : []).flatMap((line, idx) => {
                      const globalIdx = `${file.path}-${idx}`
                      const isExpanded = expandedSections.has(globalIdx)
                      const lineNum = line.oldLineNumber || line.newLineNumber
                      const side: 'old' | 'new' = line.type === 'removed' ? 'old' : 'new'
                      
                      if (line.isCollapsible) {
                        const rows = []
                        rows.push(
                          <DiffLineRow
                            key={globalIdx}
                            line={line}
                            index={globalIdx}
                            isSelected={false}
                            onLineMouseDown={handleLineMouseDown}
                            onLineMouseEnter={handleLineMouseEnter}
                            onLineMouseLeave={handleLineMouseLeave}
                            onLineMouseUp={handleLineMouseUp}
                            onToggleCollapse={() => toggleCollapsed(globalIdx)}
                            isCollapsed={!isExpanded}
                            highlightedContent={undefined}
                            filePath={file.path}
                          />
                        )
                        
                        if (isExpanded && line.collapsedLines) {
                          line.collapsedLines.forEach((collapsedLine, collapsedIdx) => {
                            const collapsedLineNum = collapsedLine.oldLineNumber || collapsedLine.newLineNumber
                            const collapsedSide: 'old' | 'new' = collapsedLine.type === 'removed' ? 'old' : 'new'
                            const collapsedComment = getCommentForLine(collapsedLineNum, collapsedSide)
                             rows.push(
                              <DiffLineRow
                                key={`${globalIdx}-expanded-${collapsedIdx}`}
                                line={collapsedLine}
                                index={`${globalIdx}-${collapsedIdx}`}
                                isSelected={collapsedLineNum ? lineSelection.isLineSelected(collapsedLineNum, collapsedSide) : false}
                                onLineMouseDown={handleLineMouseDown}
                                onLineMouseEnter={handleLineMouseEnter}
                                onLineMouseLeave={handleLineMouseLeave}
                                onLineMouseUp={handleLineMouseUp}
                                highlightedContent={collapsedLine.content ? highlightCode(collapsedLine.content) : undefined}
                                hasComment={!!collapsedComment}
                                commentText={collapsedComment?.comment}
                                filePath={file.path}
                              />
                            )
                          })
                        }
                        
                        return rows
                      }
                      
                      const comment = getCommentForLine(lineNum, side)
                      return (
                        <DiffLineRow
                          key={globalIdx}
                          line={line}
                          index={globalIdx}
                          isSelected={lineNum ? lineSelection.isLineSelected(lineNum, side) : false}
                          onLineMouseDown={handleLineMouseDown}
                          onLineMouseEnter={handleLineMouseEnter}
                          onLineMouseLeave={handleLineMouseLeave}
                          onLineMouseUp={handleLineMouseUp}
                          highlightedContent={line.content ? highlightCode(line.content) : undefined}
                          hasComment={!!comment}
                          commentText={comment?.comment}
                          filePath={file.path}
                        />
                      )
                    })}
                  </tbody>
                </table>
                )}
              </div>
            )
          })
        ) : (
          /* For continuous scroll mode, render all files with placeholders */
          files.map((file) => {
            const fileDiff = allFileDiffs.get(file.path)
            const commentCount = getCommentsForFile(file.path).length
            const isCurrentFile = file.path === selectedFile
            const isLoading = loadingFiles.has(file.path)
            const isVisible = visibleFileSet.has(file.path)
            // Only highlight syntax for visible files to avoid blocking
            const shouldHighlight = isVisible || isCurrentFile
          
          return (
            <div 
              key={file.path} 
              data-file-path={file.path}
              ref={(el) => {
                if (el) {
                  fileRefs.current.set(file.path, el)
                  // Observe element for intersection if observer exists
                  if (observerRef.current && !isLargeDiffMode) {
                    observerRef.current.observe(el)
                  }
                }
              }}
              className="border-b border-slate-800 last:border-b-0"
              style={{ minHeight: '200px' }}
            >
              {/* File header */}
              <div 
                className={clsx(
                  "sticky top-0 z-10 bg-slate-950 border-b border-slate-700 px-4 py-3 flex items-center justify-between",
                  isCurrentFile && "bg-slate-900"
                )}
              >
                <div className="flex items-center gap-3">
                  {getFileIcon(file.change_type, file.path)}
                  <div>
                    <div className="font-medium text-sm text-slate-100">{file.path}</div>
                    <div className="text-xs text-slate-400">
                      {file.change_type === 'added' && 'New file'}
                      {file.change_type === 'deleted' && 'Deleted file'}
                      {file.change_type === 'modified' && 'Modified'}
                      {file.change_type === 'renamed' && 'Renamed'}
                    </div>
                  </div>
                </div>
                {commentCount > 0 && (
                  <div className="flex items-center gap-1 text-sm text-blue-400">
                    <VscComment />
                    <span>{commentCount} comment{commentCount > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
              
              {/* File diff content with smart loading */}
              {!fileDiff ? (
                <div className="px-4 py-8 text-center text-slate-500">
                  {isLoading ? (
                    <AnimatedText text="loading" colorClassName="text-slate-500" size="sm" />
                  ) : (
                    <div className="text-slate-600">
                      {/* Placeholder maintains scroll position */}
                      <div className="h-20" />
                    </div>
                  )}
                </div>
              ) : (
              <table className="w-full" style={{ tableLayout: 'fixed' }}>
                <tbody>
                  {('diffResult' in fileDiff ? fileDiff.diffResult : []).flatMap((line, idx) => {
                    const globalIdx = `${file.path}-${idx}`
                    const isExpanded = expandedSections.has(globalIdx)
                    const lineNum = line.oldLineNumber || line.newLineNumber
                    const side: 'old' | 'new' = line.type === 'removed' ? 'old' : 'new'
                    
                    if (line.isCollapsible) {
                      const rows = []
                      rows.push(
                        <DiffLineRow
                          key={globalIdx}
                          line={line}
                          index={globalIdx}
                          isSelected={false}
                          onLineMouseDown={handleLineMouseDown}
                          onLineMouseEnter={handleLineMouseEnter}
                          onLineMouseLeave={handleLineMouseLeave}
                          onLineMouseUp={handleLineMouseUp}
                          onToggleCollapse={() => toggleCollapsed(globalIdx)}
                          isCollapsed={!isExpanded}
                          highlightedContent={undefined}
                          filePath={file.path}
                        />
                      )
                      
                      if (isExpanded && line.collapsedLines) {
                        line.collapsedLines.forEach((collapsedLine, collapsedIdx) => {
                          const collapsedLineNum = collapsedLine.oldLineNumber || collapsedLine.newLineNumber
                          const collapsedSide: 'old' | 'new' = collapsedLine.type === 'removed' ? 'old' : 'new'
                          const collapsedComment = getCommentForLine(collapsedLineNum, collapsedSide)
                           rows.push(
                            <DiffLineRow
                              key={`${globalIdx}-expanded-${collapsedIdx}`}
                              line={collapsedLine}
                              index={`${globalIdx}-${collapsedIdx}`}
                              isSelected={collapsedLineNum ? lineSelection.isLineSelected(collapsedLineNum, collapsedSide) : false}
                              onLineMouseDown={handleLineMouseDown}
                              onLineMouseEnter={handleLineMouseEnter}
                              onLineMouseLeave={handleLineMouseLeave}
                              onLineMouseUp={handleLineMouseUp}
                              highlightedContent={shouldHighlight && collapsedLine.content ? highlightCode(collapsedLine.content) : undefined}
                              hasComment={!!collapsedComment}
                              commentText={collapsedComment?.comment}
                              filePath={file.path}
                            />
                          )
                        })
                      }
                      
                      return rows
                    }
                    
                    const comment = getCommentForLine(lineNum, side)
                    return (
                      <DiffLineRow
                        key={globalIdx}
                        line={line}
                        index={globalIdx}
                        isSelected={lineNum ? lineSelection.isLineSelected(lineNum, side) : false}
                        onLineMouseDown={handleLineMouseDown}
                        onLineMouseEnter={handleLineMouseEnter}
                        onLineMouseLeave={handleLineMouseLeave}
                        onLineMouseUp={handleLineMouseUp}
                        highlightedContent={shouldHighlight && line.content ? highlightCode(line.content) : undefined}
                        hasComment={!!comment}
                        commentText={comment?.comment}
                        filePath={file.path}
                      />
                    )
                  })}
                </tbody>
              </table>
              )}
            </div>
          )
        })
        )}
      </div>
    </>
  )
}