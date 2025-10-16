import { describe, it, expect, vi } from 'vitest';
import { matchKeybinding, shouldSkipShell, shouldHandleClaudeShiftEnter, TerminalCommand } from './terminalKeybindings';

vi.mock('../../keyboardShortcuts/helpers', () => ({
    detectPlatformSafe: vi.fn(() => 'mac'),
}));

describe('terminalKeybindings', () => {
    describe('matchKeybinding', () => {
        it('should match Cmd+Shift+N as NewSpec on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'N',
                metaKey: true,
                shiftKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.NewSpec);
        });

        it('should match Cmd+N as NewSession on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'N',
                metaKey: true,
                shiftKey: false,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.NewSession);
        });

        it('should match Cmd+R as MarkReady on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'R',
                metaKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.MarkReady);
        });

        it('should match Cmd+F as Search on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'F',
                metaKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.Search);
        });

        it('should match Cmd+Enter as NewLine on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                metaKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.NewLine);
        });

        it('should NOT match Cmd+C (allow it to pass through)', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'c',
                metaKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(false);
            expect(result.commandId).toBeUndefined();
        });

        it('should NOT match Ctrl+C (allow it to pass through)', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'c',
                ctrlKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(false);
            expect(result.commandId).toBeUndefined();
        });

        it('should NOT match plain C key', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'c',
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(false);
            expect(result.commandId).toBeUndefined();
        });
    });

    describe('shouldSkipShell', () => {
        it('should return true for commands in skip list', () => {
            expect(shouldSkipShell(TerminalCommand.NewSession)).toBe(true);
            expect(shouldSkipShell(TerminalCommand.NewSpec)).toBe(true);
            expect(shouldSkipShell(TerminalCommand.MarkReady)).toBe(true);
            expect(shouldSkipShell(TerminalCommand.Search)).toBe(true);
            expect(shouldSkipShell(TerminalCommand.NewLine)).toBe(true);
        });

        it('should return false for undefined command', () => {
            expect(shouldSkipShell(undefined)).toBe(false);
        });

        it('should return false for unknown command', () => {
            expect(shouldSkipShell('unknown.command' as TerminalCommand)).toBe(false);
        });
    });

    describe('shouldHandleClaudeShiftEnter', () => {
        it('should return true for Claude agent with Shift+Enter', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'claude', true, false);
            expect(result).toBe(true);
        });

        it('should return false if not Claude agent', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'codex', true, false);
            expect(result).toBe(false);
        });

        it('should return false if not top terminal', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'claude', false, false);
            expect(result).toBe(false);
        });

        it('should return false if terminal is read-only', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'claude', true, true);
            expect(result).toBe(false);
        });

        it('should return false if Cmd/Ctrl key is pressed', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
                metaKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'claude', true, false);
            expect(result).toBe(false);
        });

        it('should return false if not Enter key', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'A',
                shiftKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'claude', true, false);
            expect(result).toBe(false);
        });
    });

    describe('Ctrl+C behavior (critical for TUI compatibility)', () => {
        it('should allow Ctrl+C to pass through to xterm (not in skip list)', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'c',
                ctrlKey: true,
            });
            const match = matchKeybinding(event);
            expect(match.matches).toBe(false);
            expect(shouldSkipShell(match.commandId)).toBe(false);
        });

        it('should allow Cmd+C to pass through to xterm on Mac (not in skip list)', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'c',
                metaKey: true,
            });
            const match = matchKeybinding(event);
            expect(match.matches).toBe(false);
            expect(shouldSkipShell(match.commandId)).toBe(false);
        });
    });
});
