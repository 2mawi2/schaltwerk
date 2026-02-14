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
                    label: 'GPT-5.3 Codex',
                    description: 'General purpose',
                    defaultReasoning: 'high',
                    reasoningOptions: [
                        { id: 'low', label: 'Low', description: 'Low effort' }
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
    })

    test('falls back to defaults when command fails', async () => {
        mockInvoke.mockRejectedValue(new Error('boom'))

        const catalog = await loadCodexModelCatalog()

        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreListCodexModels)
        expect(catalog.models.length).toBeGreaterThan(0)
        expect(catalog.models[0]?.id).toBe('gpt-5.3-codex')
        expect(catalog.defaultModelId).toBe(catalog.models[0]?.id ?? '')
    })

    test('fallback catalog includes gpt-5.1-codex-max with extra high reasoning', async () => {
        mockInvoke.mockRejectedValue(new Error('backend unavailable'))

        const catalog = await loadCodexModelCatalog()
        const max = catalog.models.find(model => model.id === 'gpt-5.1-codex-max')

        expect(max).toBeDefined()
        expect(max?.defaultReasoning).toBe('medium')
        expect(max?.reasoningOptions.map(option => option.id)).toContain('xhigh')
    })
})
