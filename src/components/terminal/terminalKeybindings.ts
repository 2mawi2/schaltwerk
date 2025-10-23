import { detectPlatformSafe } from '../../keyboardShortcuts/helpers';

export interface KeyBindingMatch {
    matches: boolean;
    commandId?: string;
}

export const enum TerminalCommand {
    NewSession = 'terminal.newSession',
    NewSpec = 'terminal.newSpec',
    MarkReady = 'terminal.markReady',
    Search = 'terminal.search',
    NewLine = 'terminal.newLine',
    ClaudeShiftEnter = 'terminal.claudeShiftEnter',
}

const COMMANDS_TO_SKIP_SHELL: TerminalCommand[] = [
    TerminalCommand.NewSession,
    TerminalCommand.NewSpec,
    TerminalCommand.MarkReady,
    TerminalCommand.Search,
    TerminalCommand.NewLine,
    TerminalCommand.ClaudeShiftEnter,
];

export function matchKeybinding(event: KeyboardEvent): KeyBindingMatch {
    const platform = detectPlatformSafe();
    const isMac = platform === 'mac';
    const modifierKey = isMac ? event.metaKey : event.ctrlKey;

    if (modifierKey && event.shiftKey && (event.key === 'n' || event.key === 'N')) {
        return { matches: true, commandId: TerminalCommand.NewSpec };
    }

    if (modifierKey && !event.shiftKey && (event.key === 'n' || event.key === 'N')) {
        return { matches: true, commandId: TerminalCommand.NewSession };
    }

    if (modifierKey && (event.key === 'r' || event.key === 'R')) {
        return { matches: true, commandId: TerminalCommand.MarkReady };
    }

    if (modifierKey && (event.key === 'f' || event.key === 'F')) {
        return { matches: true, commandId: TerminalCommand.Search };
    }

    if (modifierKey && event.key === 'Enter' && event.type === 'keydown') {
        return { matches: true, commandId: TerminalCommand.NewLine };
    }

    return { matches: false };
}

export function shouldSkipShell(commandId?: string): boolean {
    if (!commandId) return false;
    return COMMANDS_TO_SKIP_SHELL.includes(commandId as TerminalCommand);
}

export function shouldHandleClaudeShiftEnter(
    event: KeyboardEvent,
    agentType: string | undefined,
    isAgentTopTerminal: boolean,
    readOnly: boolean
): boolean {
    const platform = detectPlatformSafe();
    const isMac = platform === 'mac';
    const modifierKey = isMac ? event.metaKey : event.ctrlKey;

    return (
        agentType === 'claude' &&
        isAgentTopTerminal &&
        event.key === 'Enter' &&
        event.type === 'keydown' &&
        event.shiftKey &&
        !modifierKey &&
        !event.altKey &&
        !readOnly
    );
}

const isControlOnly = (event: KeyboardEvent): boolean => {
    return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
};

const isKey = (event: KeyboardEvent, expected: string): boolean => {
    return event.key?.toLowerCase() === expected.toLowerCase();
};

export function shouldEmitControlPaste(event: KeyboardEvent): boolean {
    const platform = detectPlatformSafe();
    if (platform !== 'mac') return false;
    if (event.type !== 'keydown') return false;
    return isControlOnly(event) && isKey(event, 'v');
}

export function shouldEmitControlNewline(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return false;
    return isControlOnly(event) && isKey(event, 'j');
}
