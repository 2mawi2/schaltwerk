export const getAgentColorKey = (
    agent: string
): 'blue' | 'green' | 'orange' | 'violet' | 'red' | 'yellow' => {
    switch (agent) {
        case 'claude':
            return 'blue'
        case 'opencode':
            return 'green'
        case 'gemini':
            return 'orange'
        case 'droid':
            return 'violet'
        case 'codex':
            return 'red'
        case 'amp':
        case 'kilocode':
            return 'yellow'
        default:
            return 'red'
    }
}
