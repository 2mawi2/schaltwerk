import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { Epic } from '../../types/session'
import { logger } from '../../utils/logger'
import { projectPathAtom } from './project'

interface EpicsState {
    projectPath: string | null
    items: Epic[]
    loading: boolean
    loaded: boolean
}

const epicsStateAtom = atom<EpicsState>({
    projectPath: null,
    items: [],
    loading: false,
    loaded: false,
})

export const epicsAtom = atom((get) => get(epicsStateAtom).items)
export const epicsLoadingAtom = atom((get) => get(epicsStateAtom).loading)

export const refreshEpicsActionAtom = atom(
    null,
    async (get, set) => {
        const projectPath = get(projectPathAtom)
        if (!projectPath) {
            set(epicsStateAtom, { projectPath: null, items: [], loading: false, loaded: false })
            return
        }

        set(epicsStateAtom, (prev) => ({
            projectPath,
            items: prev.projectPath === projectPath ? prev.items : [],
            loading: true,
            loaded: prev.projectPath === projectPath ? prev.loaded : false,
        }))

        try {
            const epics = await invoke<Epic[]>(TauriCommands.SchaltwerkCoreListEpics)
            const sorted = [...epics].sort((a, b) => a.name.localeCompare(b.name))
            set(epicsStateAtom, { projectPath, items: sorted, loading: false, loaded: true })
        } catch (error) {
            logger.error('[EpicsAtoms] Failed to load epics:', error)
            set(epicsStateAtom, (prev) => ({
                projectPath,
                items: prev.projectPath === projectPath ? prev.items : [],
                loading: false,
                loaded: prev.projectPath === projectPath ? prev.loaded : false,
            }))
            throw error
        }
    },
)

export const ensureEpicsLoadedActionAtom = atom(
    null,
    async (get, set) => {
        const projectPath = get(projectPathAtom)
        const state = get(epicsStateAtom)

        if (!projectPath) {
            if (state.projectPath !== null || state.items.length > 0) {
                set(epicsStateAtom, { projectPath: null, items: [], loading: false, loaded: false })
            }
            return
        }

        if (state.loaded && state.projectPath === projectPath) {
            return
        }

        await set(refreshEpicsActionAtom)
    },
)

export const createEpicActionAtom = atom(
    null,
    async (_get, set, input: { name: string; color: string | null }) => {
        const epic = await invoke<Epic>(TauriCommands.SchaltwerkCoreCreateEpic, {
            name: input.name,
            color: input.color,
        })

        set(epicsStateAtom, (prev) => {
            if (!prev.projectPath) {
                return prev
            }
            const next = [...prev.items.filter(item => item.id !== epic.id), epic].sort((a, b) => a.name.localeCompare(b.name))
            return { ...prev, items: next, loaded: true }
        })

        return epic
    },
)

export const updateEpicActionAtom = atom(
    null,
    async (_get, set, input: { id: string; name: string; color: string | null }) => {
        const epic = await invoke<Epic>(TauriCommands.SchaltwerkCoreUpdateEpic, {
            id: input.id,
            name: input.name,
            color: input.color,
        })

        set(epicsStateAtom, (prev) => {
            if (!prev.projectPath) {
                return prev
            }
            const next = [...prev.items.filter(item => item.id !== epic.id), epic].sort((a, b) => a.name.localeCompare(b.name))
            return { ...prev, items: next, loaded: true }
        })

        return epic
    },
)

export const deleteEpicActionAtom = atom(
    null,
    async (_get, set, id: string) => {
        await invoke<void>(TauriCommands.SchaltwerkCoreDeleteEpic, { id })

        set(epicsStateAtom, (prev) => {
            if (!prev.projectPath) {
                return prev
            }
            const next = prev.items.filter(item => item.id !== id)
            return { ...prev, items: next, loaded: true }
        })
    },
)

export const setItemEpicActionAtom = atom(
    null,
    async (_get, _set, input: { name: string; epicId: string | null }) => {
        await invoke<void>(TauriCommands.SchaltwerkCoreSetItemEpic, {
            name: input.name,
            epicId: input.epicId,
        })
    },
)

