import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { TauriCommands } from '../../common/tauriCommands'

type NotificationType = 'success' | 'error' | 'info'

type ArchivedSpec = {
    id: string
    session_name: string
    repository_path: string
    repository_name: string
    content: string
    archived_at: number | string
}

interface Props {
    onClose: () => void
    onOpenSpec: (spec: { name: string; content: string }) => void
    onNotify: (message: string, type: NotificationType) => void
}

export function SettingsArchivesSection({ onClose: _onClose, onOpenSpec, onNotify }: Props) {
    const [archives, setArchives] = useState<ArchivedSpec[]>([])
    const [archiveMax, setArchiveMax] = useState<number>(50)
    const [archivesLoading, setArchivesLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [savingLimit, setSavingLimit] = useState(false)

    const isMountedRef = useRef(true)

    void _onClose

    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
        }
    }, [])

    const formatTimestamp = useCallback((value: number | string) => {
        let timestamp: number
        if (typeof value === 'number') {
            timestamp = value > 1e12 ? value : value * 1000
        } else {
            const parsed = Date.parse(value)
            timestamp = Number.isNaN(parsed) ? Date.now() : parsed
        }
        return new Date(timestamp).toLocaleString()
    }, [])

    const fetchArchives = useCallback(async () => {
        if (!isMountedRef.current) {
            return
        }

        setArchivesLoading(true)
        try {
            const list = await invoke<ArchivedSpec[]>(TauriCommands.SchaltwerkCoreListArchivedSpecs)
            const max = await invoke<number>(TauriCommands.SchaltwerkCoreGetArchiveMaxEntries)

            if (isMountedRef.current) {
                setArchives(list)
                setArchiveMax(max)
                setLoadError(null)
            }
        } catch (error) {
            logger.error('Failed to load archived specs', error)
            if (isMountedRef.current) {
                setLoadError('Failed to load archived specs.')
            }
        } finally {
            if (isMountedRef.current) {
                setArchivesLoading(false)
            }
        }
    }, [])

    useEffect(() => {
        fetchArchives()
    }, [fetchArchives])

    const handleSaveLimit = useCallback(async () => {
        if (savingLimit) return

        setSavingLimit(true)
        try {
            await invoke(TauriCommands.SchaltwerkCoreSetArchiveMaxEntries, { limit: archiveMax })
            onNotify('Archive limit saved', 'success')
        } catch (error) {
            logger.error('Failed to save archive limit', error)
            onNotify('Failed to save archive limit', 'error')
        } finally {
            setSavingLimit(false)
        }
    }, [archiveMax, onNotify, savingLimit])

    const handleRestore = useCallback(async (spec: ArchivedSpec) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreRestoreArchivedSpec, { id: spec.id, newName: null })
            await fetchArchives()
            onNotify('Restored to specs', 'success')
        } catch (error) {
            logger.error('Failed to restore archived spec', error)
            onNotify('Failed to restore', 'error')
        }
    }, [fetchArchives, onNotify])

    const handleDelete = useCallback(async (spec: ArchivedSpec) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreDeleteArchivedSpec, { id: spec.id })
            await fetchArchives()
        } catch (error) {
            logger.error('Failed to delete archived spec', error)
            onNotify('Failed to delete', 'error')
        }
    }, [fetchArchives, onNotify])

    const archiveDisplay = useMemo(() => {
        if (archivesLoading) {
            return (
                <div className="py-6">
                    <AnimatedText text="loading" colorClassName="text-slate-500" size="sm" />
                </div>
            )
        }

        if (loadError) {
            return <div className="text-body text-red-300">{loadError}</div>
        }

        if (archives.length === 0) {
            return <div className="text-slate-400 text-body">No archived specs.</div>
        }

        return (
            <div className="space-y-3 w-full">
                {archives.map(item => (
                    <div
                        key={item.id}
                        className="w-full border border-slate-800 rounded p-3 bg-slate-900/40 flex items-start justify-between gap-3 min-w-0"
                    >
                        <div
                            className="flex-1 min-w-0 overflow-hidden pr-2 cursor-pointer hover:opacity-80 transition-opacity"
                            style={{ maxWidth: 'calc(100% - 140px)' }}
                            onClick={() => onOpenSpec({ name: item.session_name, content: item.content })}
                        >
                            <div className="text-slate-200 text-body truncate">{item.session_name}</div>
                            <div className="text-caption text-slate-500">{formatTimestamp(item.archived_at)}</div>
                            <div className="text-caption text-slate-500 line-clamp-2 mt-1 break-all overflow-hidden max-w-full">{item.content}</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                                onClick={() => handleRestore(item)}
                                className="px-2 py-1 border border-slate-700 rounded text-slate-200 text-caption bg-slate-800 hover:bg-slate-700"
                            >
                                Restore
                            </button>
                            <button
                                onClick={() => handleDelete(item)}
                                className="px-2 py-1 border border-red-700 rounded text-red-200 text-caption bg-red-900/30 hover:bg-red-900/50"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        )
    }, [archives, archivesLoading, formatTimestamp, handleDelete, handleRestore, loadError, onOpenSpec])

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-body font-medium text-slate-200 mb-2">Archived Specs</h3>
                        <div className="text-body text-slate-400 mb-4">Recover deleted prompts back to specs.</div>
                        <div className="mb-4 flex items-center gap-3">
                            <label className="text-body text-slate-300">Max entries</label>
                            <input
                                type="number"
                                value={archiveMax}
                                onChange={(event) => {
                                    const nextValue = parseInt(event.target.value || '0', 10)
                                    setArchiveMax(Number.isNaN(nextValue) ? 0 : nextValue)
                                }}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                            />
                            <button
                                onClick={handleSaveLimit}
                                disabled={savingLimit}
                                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-200 text-body disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                Save
                            </button>
                        </div>
                        {archiveDisplay}
                    </div>
                </div>
            </div>
        </div>
    )
}
