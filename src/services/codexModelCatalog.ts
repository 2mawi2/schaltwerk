import { invoke } from '@tauri-apps/api/core'
import { FALLBACK_CODEX_MODELS } from '../common/codexModels'
import type { CodexModelMetadata, CodexReasoningOption } from '../common/codexModels'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'

export interface CodexModelCatalog {
    models: CodexModelMetadata[]
    defaultModelId: string
}

interface CodexModelCatalogResponse {
    models: CodexModelMetadata[]
    defaultModelId?: string
}

const FALLBACK_CATALOG: CodexModelCatalog = {
    models: [...FALLBACK_CODEX_MODELS],
    defaultModelId: FALLBACK_CODEX_MODELS[0]?.id ?? ''
}

function toTitleCase(value: string): string {
    if (!value) return ''
    const lower = value.toLowerCase()
    return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function normalizeReasoningOption(option: CodexReasoningOption): CodexReasoningOption {
    const id = option.id.trim()
    const label = option.label?.trim() || toTitleCase(id)
    const description =
        option.description?.trim() || `${label} reasoning effort`
    return {
        id,
        label,
        description
    }
}

function normalizeModel(model: CodexModelMetadata): CodexModelMetadata | null {
    const id = model.id?.trim()
    if (!id) {
        return null
    }

    const reasoningOptions = Array.isArray(model.reasoningOptions)
        ? model.reasoningOptions
              .filter(option => option?.id)
              .map(normalizeReasoningOption)
        : []

    const defaultReasoning =
        model.defaultReasoning?.trim() ||
        reasoningOptions[0]?.id ||
        'medium'

    return {
        id,
        label: model.label?.trim() || id,
        description: model.description?.trim() || '',
        defaultReasoning,
        reasoningOptions,
        isDefault: model.isDefault ?? false
    }
}

export async function loadCodexModelCatalog(): Promise<CodexModelCatalog> {
    try {
        const response = await invoke<CodexModelCatalogResponse>(
            TauriCommands.SchaltwerkCoreListCodexModels
        )

        if (response && Array.isArray(response.models) && response.models.length > 0) {
            const uniqueIds = new Set<string>()
            const normalizedModels = response.models
                .map(normalizeModel)
                .filter((model): model is CodexModelMetadata => model !== null)
                .filter(model => {
                    if (uniqueIds.has(model.id)) {
                        return false
                    }
                    uniqueIds.add(model.id)
                    return true
                })

            if (normalizedModels.length > 0) {
                const defaultModelId =
                    response.defaultModelId?.trim() ||
                    normalizedModels.find(model => model.isDefault)?.id ||
                    normalizedModels[0].id

                return {
                    models: normalizedModels,
                    defaultModelId
                }
            }
        }
    } catch (error) {
        logger.warn('[codexModelCatalog] Failed to load Codex models via backend command', error)
    }

    return FALLBACK_CATALOG
}
