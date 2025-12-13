export enum FilterMode {
    Spec = 'spec',
    Running = 'running',
    Reviewed = 'reviewed'
}

export const FILTER_MODES = Object.values(FilterMode) as FilterMode[]

export function isValidFilterMode(value: unknown): value is FilterMode {
    return typeof value === 'string' && FILTER_MODES.includes(value as FilterMode)
}

export function getDefaultFilterMode(): FilterMode {
    return FilterMode.Running
}
