import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { loadCodexModelCatalog } from './codexModelCatalog'
import { TauriCommands } from '../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

const mockInvoke = invoke as unknown as Mock

describe('codexModelCatalog', () => {
    beforeEach(() => {
        mockInvoke.mockReset()
    })

    test('fetches supported models from backend command', async () => {
        mockInvoke.mockResolvedValue({
            models: [
                {
                    id: 'gpt-5.3-codex',
                    label: 'GPT-5.4 Codex',
                    description: 'General purpose',
                    defaultReasoning: 'high',
                    reasoningOptions: [
                        { id: 'low', label: 'Low', description: 'Low effort' },
                        { id: 'xhigh', label: '', description: '' }
                    ]
                }
            ],
            defaultModelId: 'gpt-5.3-codex'
        })

        const catalog = await loadCodexModelCatalog()

        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreListCodexModels)
        expect(catalog.defaultModelId).toBe('gpt-5.3-codex')
        expect(catalog.models).toHaveLength(1)
        expect(catalog.models[0].id).toBe('gpt-5.3-codex')
        expect(catalog.models[0].reasoningOptions[0].id).toBe('low')
        expect(catalog.models[0].reasoningOptions[1]).toEqual({
            id: 'xhigh',
            label: 'Extra high',
            description: 'Extra high reasoning effort'
        })
    })

    test('falls back to defaults when command fails', async () => {
        mockInvoke.mockRejectedValue(new Error('boom'))

        const catalog = await loadCodexModelCatalog()

        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreListCodexModels)
        expect(catalog.models.length).toBeGreaterThan(0)
        expect(catalog.models[0]?.id).toBe('gpt-5.6-sol')
        expect(catalog.defaultModelId).toBe(catalog.models[0]?.id ?? '')
    })

    test('fallback catalog includes the GPT-5.6 family with current reasoning efforts', async () => {
        mockInvoke.mockRejectedValue(new Error('backend unavailable'))

        const catalog = await loadCodexModelCatalog()
        const sol = catalog.models.find(model => model.id === 'gpt-5.6-sol')
        const terra = catalog.models.find(model => model.id === 'gpt-5.6-terra')
        const luna = catalog.models.find(model => model.id === 'gpt-5.6-luna')

        expect(catalog.defaultModelId).toBe('gpt-5.6-sol')
        expect(sol?.defaultReasoning).toBe('low')
        expect(terra?.defaultReasoning).toBe('medium')
        expect(luna?.defaultReasoning).toBe('medium')
        expect(sol?.reasoningOptions.map(option => option.id)).toEqual([
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
            'ultra',
        ])
        expect(luna?.reasoningOptions.map(option => option.id)).toEqual([
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
        ])
        expect(catalog.models.some(model => model.id === 'gpt-5.3-codex')).toBe(false)
    })
})
