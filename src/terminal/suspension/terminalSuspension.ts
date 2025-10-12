import { Terminal as XTerm } from '@xterm/xterm';
import { logger } from '../../utils/logger';
import { TerminalVisibilityTracker, TerminalVisibility } from '../visibility/terminalVisibilityTracker';

interface SuspensionState {
    suspended: boolean;
    suspendedAt: number;
    bufferSnapshot?: string;
    scrollPosition?: { x: number; y: number };
}

export interface TerminalSuspensionOptions {
    suspendAfterMs?: number;
    maxSuspendedTerminals?: number;
    keepAliveTerminalIds?: Set<string>;
}

const DEFAULT_OPTIONS: Required<TerminalSuspensionOptions> = {
    suspendAfterMs: 5000,
    maxSuspendedTerminals: 100,
    keepAliveTerminalIds: new Set()
};

export class TerminalSuspensionManager {
    private static instance: TerminalSuspensionManager;
    private terminals = new Map<string, XTerm>();
    private states = new Map<string, SuspensionState>();
    private visibilityTracker: TerminalVisibilityTracker;
    private options: Required<TerminalSuspensionOptions>;
    private suspensionTimers = new Map<string, number>();

    private constructor(options: TerminalSuspensionOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.visibilityTracker = TerminalVisibilityTracker.getInstance();
    }

    static getInstance(options?: TerminalSuspensionOptions): TerminalSuspensionManager {
        if (!TerminalSuspensionManager.instance) {
            TerminalSuspensionManager.instance = new TerminalSuspensionManager(options);
        }
        return TerminalSuspensionManager.instance;
    }

    registerTerminal(terminalId: string, terminal: XTerm, element: HTMLElement): void {
        this.terminals.set(terminalId, terminal);
        this.states.set(terminalId, {
            suspended: false,
            suspendedAt: 0
        });

        this.visibilityTracker.registerTerminal(terminalId, element);
        this.visibilityTracker.onVisibilityChange(terminalId, (visibility) => {
            this.handleVisibilityChange(terminalId, visibility);
        });

        logger.debug(`[TerminalSuspension] Registered terminal ${terminalId}`);
    }

    unregisterTerminal(terminalId: string): void {
        this.clearSuspensionTimer(terminalId);
        this.terminals.delete(terminalId);
        this.states.delete(terminalId);
        this.visibilityTracker.unregisterTerminal(terminalId);
        logger.debug(`[TerminalSuspension] Unregistered terminal ${terminalId}`);
    }

    private handleVisibilityChange(terminalId: string, visibility: TerminalVisibility): void {
        const state = this.states.get(terminalId);
        if (!state) return;

        if (visibility === 'visible') {
            this.clearSuspensionTimer(terminalId);
            if (state.suspended) {
                this.resume(terminalId);
            }
        } else {
            if (!this.options.keepAliveTerminalIds.has(terminalId)) {
                this.scheduleSuspension(terminalId);
            }
        }
    }

    private scheduleSuspension(terminalId: string): void {
        this.clearSuspensionTimer(terminalId);

        const timer = window.setTimeout(() => {
            this.suspend(terminalId);
        }, this.options.suspendAfterMs);

        this.suspensionTimers.set(terminalId, timer);
    }

    private clearSuspensionTimer(terminalId: string): void {
        const timer = this.suspensionTimers.get(terminalId);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.suspensionTimers.delete(terminalId);
        }
    }

    suspend(terminalId: string): boolean {
        const terminal = this.terminals.get(terminalId);
        const state = this.states.get(terminalId);

        if (!terminal || !state || state.suspended) {
            return false;
        }

        try {
            state.scrollPosition = {
                x: terminal.buffer.active.viewportY,
                y: terminal.buffer.active.baseY
            };

            terminal.clear();
            terminal.write('\x1b[2J\x1b[H');

            state.suspended = true;
            state.suspendedAt = Date.now();

            logger.info(`[TerminalSuspension] Suspended terminal ${terminalId}`);
            return true;
        } catch (error) {
            logger.error(`[TerminalSuspension] Error suspending terminal ${terminalId}:`, error);
            return false;
        }
    }

    resume(terminalId: string): boolean {
        const terminal = this.terminals.get(terminalId);
        const state = this.states.get(terminalId);

        if (!terminal || !state || !state.suspended) {
            return false;
        }

        try {
            if (state.scrollPosition) {
                terminal.scrollToLine(state.scrollPosition.x);
            }

            state.suspended = false;
            state.suspendedAt = 0;
            state.scrollPosition = undefined;

            logger.info(`[TerminalSuspension] Resumed terminal ${terminalId}`);
            return true;
        } catch (error) {
            logger.error(`[TerminalSuspension] Error resuming terminal ${terminalId}:`, error);
            return false;
        }
    }

    isSuspended(terminalId: string): boolean {
        return this.states.get(terminalId)?.suspended || false;
    }

    getSuspendedTerminals(): string[] {
        return Array.from(this.states.entries())
            .filter(([_, state]) => state.suspended)
            .map(([id]) => id);
    }

    getActiveTerminals(): string[] {
        return Array.from(this.states.entries())
            .filter(([_, state]) => !state.suspended)
            .map(([id]) => id);
    }

    getStats(): { total: number; suspended: number; active: number } {
        const suspended = this.getSuspendedTerminals().length;
        const total = this.terminals.size;
        return {
            total,
            suspended,
            active: total - suspended
        };
    }

    dispose(): void {
        this.suspensionTimers.forEach(timer => clearTimeout(timer));
        this.suspensionTimers.clear();
        this.terminals.clear();
        this.states.clear();
    }
}
