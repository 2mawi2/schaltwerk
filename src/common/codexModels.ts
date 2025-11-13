import codexModelConfig from './config/codexModels.json'

export interface CodexReasoningOption {
    id: string
    label: string
    description: string
}

export interface CodexModelMetadata {
    id: string
    label: string
    description: string
    defaultReasoning: string
    reasoningOptions: CodexReasoningOption[]
    isDefault?: boolean
}

export interface CodexModelCatalogDefinition {
    defaultModelId: string
    models: CodexModelMetadata[]
}

interface CodexModelConfiguration {
    latest: CodexModelCatalogDefinition
    legacy: CodexModelCatalogDefinition
}

const RAW_CODEX_MODEL_CONFIGURATION = codexModelConfig as CodexModelConfiguration

function cloneModel(model: CodexModelMetadata): CodexModelMetadata {
    return {
        ...model,
        reasoningOptions: model.reasoningOptions.map(option => ({ ...option }))
    }
}

export function cloneCodexCatalog(config: CodexModelCatalogDefinition): CodexModelCatalogDefinition {
    return {
        defaultModelId: config.defaultModelId,
        models: config.models.map(cloneModel)
    }
}

export const LATEST_CODEX_CATALOG: CodexModelCatalogDefinition = cloneCodexCatalog(
    RAW_CODEX_MODEL_CONFIGURATION.latest
)
export const LEGACY_CODEX_CATALOG: CodexModelCatalogDefinition = cloneCodexCatalog(
    RAW_CODEX_MODEL_CONFIGURATION.legacy
)

export const FALLBACK_CODEX_MODELS: CodexModelMetadata[] = cloneCodexCatalog(
    LATEST_CODEX_CATALOG
).models

export function getCodexModelMetadata(
    modelId: string,
    models: CodexModelMetadata[] = FALLBACK_CODEX_MODELS
): CodexModelMetadata | undefined {
    return (
        models.find(model => model.id === modelId) ||
        LEGACY_CODEX_CATALOG.models.find(model => model.id === modelId)
    )
}

export function getAllCodexModels(): CodexModelMetadata[] {
    return [...LATEST_CODEX_CATALOG.models, ...LEGACY_CODEX_CATALOG.models].map(cloneModel)
}
