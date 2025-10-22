import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscFolder, VscChevronDown, VscCheck, VscChevronRight, VscCode, VscTerminal } from 'react-icons/vsc'
import { logger } from '../utils/logger'

export type OpenApp = {
  id: 'finder' | 'cursor' | 'vscode' | 'code' | 'ghostty' | 'warp' | 'terminal' | 'intellij' | 'zed'
  name: string
  kind: 'editor' | 'terminal' | 'system'
}

interface OpenInSplitButtonProps {
  resolvePath: () => Promise<string | undefined>
  onOpenReady?: (openHandler: () => Promise<void>) => void
  filter?: (app: OpenApp) => boolean
}

export function OpenInSplitButton({ resolvePath, onOpenReady, filter }: OpenInSplitButtonProps) {
  const [apps, setApps] = useState<OpenApp[]>([])
  const [defaultApp, setDefaultApp] = useState<OpenApp['id']>('finder')
  const [open, setOpen] = useState(false)
  const [isOpening, setIsOpening] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const [available, def] = await Promise.all([
          invoke<OpenApp[]>(TauriCommands.ListAvailableOpenApps),
          invoke<string>(TauriCommands.GetDefaultOpenApp),
        ])
        if (!mounted) return
        setApps(available)
        if (def && ['finder','cursor','vscode','code','ghostty','warp','terminal','intellij','zed'].includes(def)) {
          setDefaultApp(def as OpenApp['id'])
        }
      } catch (e) {
        logger.error('Failed to get available apps', e)
        if (!mounted) return
        setApps([{ id: 'finder', name: 'Finder', kind: 'system' }])
        setDefaultApp('finder')
      }
    }
    void load()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const filteredApps = useMemo(() => {
    if (!filter) return apps
    return apps.filter(app => filter(app))
  }, [apps, filter])

  const effectiveDefaultApp = useMemo<OpenApp['id']>(() => {
    if (filteredApps.length === 0) return defaultApp
    return filteredApps.some(app => app.id === defaultApp) ? defaultApp : filteredApps[0].id
  }, [filteredApps, defaultApp])
  const hasVisibleApps = filteredApps.length > 0 || !filter

  const defaultAppLabel = useMemo(() => {
    const searchPool = filteredApps.length > 0 ? filteredApps : apps
    const targetId = filteredApps.length > 0 ? effectiveDefaultApp : defaultApp
    const a = searchPool?.find?.(candidate => candidate.id === targetId)
    return a?.name ?? 'Open'
  }, [apps, filteredApps, effectiveDefaultApp, defaultApp])

  const openWithApp = useCallback(async (appId: OpenApp['id'], showError = true) => {
    const path = await resolvePath()
    if (!path) return
    
    setIsOpening(true)
    try {
      await invoke(TauriCommands.OpenInApp, { appId, worktreePath: path })
    } catch (e: unknown) {
      logger.error('Failed to open in app', appId, e)
      if (showError) {
        const errorMessage = typeof e === 'string' ? e : ((e as Error)?.message || String(e) || 'Unknown error')
        alert(errorMessage)
      }
    } finally {
      setIsOpening(false)
    }
  }, [resolvePath])

  const handleMainClick = useCallback(async () => {
    await openWithApp(effectiveDefaultApp, true)
  }, [effectiveDefaultApp, openWithApp])

  useEffect(() => {
    if (!onOpenReady) return
    if (!hasVisibleApps) return
    onOpenReady(handleMainClick)
  }, [onOpenReady, handleMainClick, hasVisibleApps])

  const handleSelectApp = async (app: OpenApp) => {
    setOpen(false)
    const path = await resolvePath()
    if (!path) return
    
    setIsOpening(true)
    try {
      await invoke(TauriCommands.OpenInApp, { appId: app.id, worktreePath: path })
      // Only set as default if opening succeeded
      try {
        await invoke(TauriCommands.SetDefaultOpenApp, { appId: app.id })
        setDefaultApp(app.id)
      } catch (e) {
        logger.warn('Failed to persist default app, continuing', e)
      }
    } catch (e: unknown) {
      logger.error('Failed to open in app', app.id, e)
      const errorMessage = typeof e === 'string' ? e : ((e as Error)?.message || String(e) || 'Unknown error')
      alert(errorMessage)
    } finally {
      setIsOpening(false)
    }
  }

  const iconFor = (id: OpenApp['id']) => {
    if (id === 'vscode' || id === 'code') return <VscCode className="text-[14px]" />
    if (id === 'cursor') return <VscCode className="text-[14px]" />
    if (id === 'intellij') return <VscCode className="text-[14px]" />
    if (id === 'zed') return <VscCode className="text-[14px]" />
    if (id === 'finder') return <VscFolder className="text-[14px]" />
    return <VscTerminal className="text-[14px]" />
  }

  if (filter && filteredApps.length === 0) {
    return null
  }

  return (
    <div className="relative" ref={menuRef}>
      <div className="flex rounded overflow-hidden border border-slate-700/60 bg-slate-800/50 h-[22px]">
        <button
          onClick={handleMainClick}
          disabled={isOpening}
          className="flex items-center gap-1.5 px-2 text-xs text-slate-200 hover:bg-slate-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
          title={`Open in ${defaultAppLabel}`}
        >
          <VscFolder className="text-[12px] opacity-90" />
          <span>{isOpening ? 'Opening...' : 'Open'}</span>
        </button>
        <div className="w-px bg-slate-700/60" />
        <button
          onClick={() => setOpen(v => !v)}
          disabled={isOpening}
          className="px-1.5 text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <VscChevronDown className="text-[12px]" />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 min-w-[200px] z-20 rounded-xl border border-slate-700/60 bg-slate-900 shadow-xl p-1"
        >
          {filteredApps.map(app => (
            <button
              key={app.id}
              onClick={() => void handleSelectApp(app)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-slate-200 hover:bg-slate-700/40"
              role="menuitem"
              title={`Open in ${app.name}`}
            >
              <span className="w-4 inline-flex items-center justify-center">{iconFor(app.id)}</span>
              <span className="flex-1">{app.name}</span>
              {app.id === effectiveDefaultApp ? (
                <VscCheck className="text-[14px] text-slate-400" />
              ) : (
                <VscChevronRight className="text-[14px] text-slate-500 opacity-60" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
