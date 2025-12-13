import { useCallback, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import type { Epic } from '../types/session'
import {
    epicsAtom,
    epicsLoadingAtom,
    refreshEpicsActionAtom,
    ensureEpicsLoadedActionAtom,
    createEpicActionAtom,
    updateEpicActionAtom,
    deleteEpicActionAtom,
    setItemEpicActionAtom,
} from '../store/atoms/epics'

export interface UseEpicsResult {
    epics: Epic[]
    loading: boolean
    ensureLoaded: () => Promise<void>
    refresh: () => Promise<void>
    createEpic: (name: string, color: string | null) => Promise<Epic>
    updateEpic: (id: string, name: string, color: string | null) => Promise<Epic>
    deleteEpic: (id: string) => Promise<void>
    setItemEpic: (name: string, epicId: string | null) => Promise<void>
}

export function useEpics(): UseEpicsResult {
    const epics = useAtomValue(epicsAtom)
    const loading = useAtomValue(epicsLoadingAtom)
    const ensureLoadedAtom = useSetAtom(ensureEpicsLoadedActionAtom)
    const refreshAtom = useSetAtom(refreshEpicsActionAtom)
    const createEpicAtom = useSetAtom(createEpicActionAtom)
    const updateEpicAtom = useSetAtom(updateEpicActionAtom)
    const deleteEpicAtom = useSetAtom(deleteEpicActionAtom)
    const setItemEpicAtom = useSetAtom(setItemEpicActionAtom)

    const ensureLoaded = useCallback(async () => {
        await ensureLoadedAtom()
    }, [ensureLoadedAtom])

    const refresh = useCallback(async () => {
        await refreshAtom()
    }, [refreshAtom])

    const createEpic = useCallback(async (name: string, color: string | null) => {
        return createEpicAtom({ name, color })
    }, [createEpicAtom])

    const updateEpic = useCallback(async (id: string, name: string, color: string | null) => {
        return updateEpicAtom({ id, name, color })
    }, [updateEpicAtom])

    const deleteEpic = useCallback(async (id: string) => {
        await deleteEpicAtom(id)
    }, [deleteEpicAtom])

    const setItemEpic = useCallback(async (name: string, epicId: string | null) => {
        await setItemEpicAtom({ name, epicId })
    }, [setItemEpicAtom])

    return useMemo(() => ({
        epics,
        loading,
        ensureLoaded,
        refresh,
        createEpic,
        updateEpic,
        deleteEpic,
        setItemEpic,
    }), [epics, loading, ensureLoaded, refresh, createEpic, updateEpic, deleteEpic, setItemEpic])
}

