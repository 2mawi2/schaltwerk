export enum FilterMode {
    All = 'all',
    Spec = 'spec',
    Running = 'running',
    Reviewed = 'reviewed'
}

export enum SortMode {
    Name = 'name',
    Created = 'created',
    LastEdited = 'last-edited'
}

export const FILTER_MODES = Object.values(FilterMode) as FilterMode[]
export const SORT_MODES = Object.values(SortMode) as SortMode[]

export function isValidFilterMode(value: unknown): value is FilterMode {
    return typeof value === 'string' && FILTER_MODES.includes(value as FilterMode)
}

export function isValidSortMode(value: unknown): value is SortMode {
    return typeof value === 'string' && SORT_MODES.includes(value as SortMode)
}

export function getDefaultFilterMode(): FilterMode {
    return FilterMode.All
}

export function getDefaultSortMode(): SortMode {
    return SortMode.Name
}