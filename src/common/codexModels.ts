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

export const FALLBACK_CODEX_MODELS: CodexModelMetadata[] = [
    {
        id: 'gpt-5-codex',
        label: 'GPT-5 Codex',
        description: 'Optimized for coding tasks with many tools.',
        defaultReasoning: 'medium',
        isDefault: true,
        reasoningOptions: [
            {
                id: 'low',
                label: 'Low',
                description: 'Fastest responses with limited reasoning'
            },
            {
                id: 'medium',
                label: 'Medium',
                description: 'Dynamically adjusts reasoning based on the task'
            },
            {
                id: 'high',
                label: 'High',
                description: 'Maximizes reasoning depth for complex or ambiguous problems'
            }
        ]
    },
    {
        id: 'gpt-5',
        label: 'GPT-5',
        description: 'Broad world knowledge with strong general reasoning.',
        defaultReasoning: 'medium',
        isDefault: false,
        reasoningOptions: [
            {
                id: 'minimal',
                label: 'Minimal',
                description: 'Fastest responses with little reasoning'
            },
            {
                id: 'low',
                label: 'Low',
                description: 'Balances speed with some reasoning; great for straightforward queries'
            },
            {
                id: 'medium',
                label: 'Medium',
                description: 'Solid balance of reasoning depth and latency for general-purpose tasks'
            },
            {
                id: 'high',
                label: 'High',
                description: 'Maximizes reasoning depth for complex or ambiguous problems'
            }
        ]
    }
]

export function getCodexModelMetadata(
    modelId: string,
    models: CodexModelMetadata[] = FALLBACK_CODEX_MODELS
): CodexModelMetadata | undefined {
    return models.find(model => model.id === modelId)
}
