import { Terminal as XTerm } from '@xterm/xterm';
import { logger } from '../../utils/logger';
import { TerminalVisibilityTracker, TerminalVisibility } from '../visibility/terminalVisibilityTracker';

interface SuspensionSnapshot {
    data: string;
    size: number;
    width: number;
    height: number;
    capturedAt: number;
}

interface SuspensionState {
    suspended: boolean;
    suspendedAt: number;
    bufferSnapshot?: SuspensionSnapshot;
    scrollPosition?: { x: number; y: number };
}

export interface TerminalSuspensionOptions {
    suspendAfterMs?: number;
    maxSuspendedTerminals?: number;
    keepAliveTerminalIds?: Set<string>;
    snapshotSizeLimitBytes?: number;
}

const DEFAULT_OPTIONS: Required<TerminalSuspensionOptions> = {
    suspendAfterMs: 5000,
    maxSuspendedTerminals: 100,
    keepAliveTerminalIds: new Set(),
    snapshotSizeLimitBytes: 2 * 1024 * 1024
};

export class TerminalSuspensionManager {
    private static instance: TerminalSuspensionManager;
    private terminals = new Map<string, XTerm>();
    private states = new Map<string, SuspensionState>();
    private visibilityTracker: TerminalVisibilityTracker;
    private options: Required<TerminalSuspensionOptions>;
    private suspensionTimers = new Map<string, number>();
    private encoder = new TextEncoder();

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

            const snapshotResult = this.captureSnapshot(terminalId, terminal);
            if (snapshotResult.type === 'error') {
                logger.warn(`[TerminalSuspension] Snapshot failed for ${terminalId}, skipping buffer clear.`);
            } else if (snapshotResult.type === 'skipped') {
                logger.warn(
                    `[TerminalSuspension] Snapshot for ${terminalId} skipped (${snapshotResult.reason}). Terminal left active.`
                );
            } else {
                this.enforceSuspensionLimit(terminalId);
                state.bufferSnapshot = snapshotResult.snapshot;
                terminal.clear();
                terminal.write('\x1b[2J\x1b[H');
            }

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

        this.restoreTerminal(terminalId, terminal, state);
        return true;
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

    getSuspensionDebugInfo(): {
        totalRegistered: number;
        suspendedWithSnapshots: number;
        suspendedWithoutSnapshots: number;
        totalSnapshotBytes: number;
        maxSuspendedTerminals: number;
        snapshotSizeLimitBytes: number;
    } {
        let suspendedWithSnapshots = 0;
        let suspendedWithoutSnapshots = 0;
        let totalSnapshotBytes = 0;

        this.states.forEach(state => {
            if (!state.suspended) return;
            if (state.bufferSnapshot) {
                suspendedWithSnapshots++;
                totalSnapshotBytes += state.bufferSnapshot.size;
            } else {
                suspendedWithoutSnapshots++;
            }
        });

        return {
            totalRegistered: this.terminals.size,
            suspendedWithSnapshots,
            suspendedWithoutSnapshots,
            totalSnapshotBytes,
            maxSuspendedTerminals: this.options.maxSuspendedTerminals,
            snapshotSizeLimitBytes: this.options.snapshotSizeLimitBytes
        };
    }

    dispose(): void {
        this.suspensionTimers.forEach(timer => clearTimeout(timer));
        this.suspensionTimers.clear();
        this.terminals.clear();
        this.states.clear();
    }

    private captureSnapshot(terminalId: string, terminal: XTerm):
        | { type: 'captured'; snapshot: SuspensionSnapshot }
        | { type: 'skipped'; reason: 'size_limit' }
        | { type: 'error' } {
        try {
            const buffer = terminal.buffer.active;
            const length = buffer.length ?? 0;
            if (length <= 0) {
                return {
                    type: 'captured',
                    snapshot: {
                        data: '',
                        size: 0,
                        width: terminal.cols ?? 0,
                        height: terminal.rows ?? 0,
                        capturedAt: Date.now()
                    }
                };
            }

            const lines: string[] = [];
            for (let i = 0; i < length; i++) {
                const line = buffer.getLine(i);
                if (!line) {
                    lines.push('');
                    continue;
                }
                lines.push(line.translateToString(true));
            }

            const data = lines.join('\n');
            const size = this.encoder.encode(data).length;

            if (size > this.options.snapshotSizeLimitBytes) {
                logger.warn(
                    `[TerminalSuspension] Snapshot for ${terminalId} is ${size} bytes, exceeding limit ${this.options.snapshotSizeLimitBytes}.`
                );
                return { type: 'skipped', reason: 'size_limit' };
            }

            return {
                type: 'captured',
                snapshot: {
                    data,
                    size,
                    width: terminal.cols ?? 0,
                    height: terminal.rows ?? 0,
                    capturedAt: Date.now()
                }
            };
        } catch (error) {
            logger.error(`[TerminalSuspension] Failed to capture snapshot for ${terminalId}:`, error);
            return { type: 'error' };
        }
    }

    private enforceSuspensionLimit(currentId: string): void {
        if (this.options.maxSuspendedTerminals <= 0) {
            return;
        }

        const suspendedWithSnapshots = Array.from(this.states.entries())
            .filter(([id, state]) => id !== currentId && state.suspended && state.bufferSnapshot)
            .sort((a, b) => a[1].suspendedAt - b[1].suspendedAt);

        while (suspendedWithSnapshots.length >= this.options.maxSuspendedTerminals) {
            const [evictId, state] = suspendedWithSnapshots.shift()!;
            const terminal = this.terminals.get(evictId);
            if (!terminal || !state) continue;
            logger.info(`[TerminalSuspension] Evicting snapshot for ${evictId} to respect max suspended limit.`);
            this.restoreTerminal(evictId, terminal, state);
        }
    }

    private restoreTerminal(terminalId: string, terminal: XTerm, state: SuspensionState): void {
        const snapshot = state.bufferSnapshot;
        const scrollPosition = state.scrollPosition;

        state.bufferSnapshot = undefined;
        state.scrollPosition = undefined;

        const finalize = () => {
            state.suspended = false;
            state.suspendedAt = 0;
        };

        const replay = async () => {
            try {
                if (snapshot) {
                    await this.writeSnapshot(terminal, snapshot.data);
                }

                if (scrollPosition) {
                    try {
                        if (typeof terminal.scrollToLine === 'function') {
                            terminal.scrollToLine(scrollPosition.x);
                        } else if (typeof terminal.scrollLines === 'function') {
                            terminal.scrollLines(scrollPosition.x - terminal.buffer.active.viewportY);
                        }
                    } catch (error) {
                        logger.warn(`[TerminalSuspension] Failed to restore scroll position for ${terminalId}:`, error);
                    }
                }

                finalize();
                logger.info(`[TerminalSuspension] Resumed terminal ${terminalId}`);
            } catch (error) {
                finalize();
                logger.error(`[TerminalSuspension] Error resuming terminal ${terminalId}:`, error);
            }
        };

        void replay();
    }

    private writeSnapshot(terminal: XTerm, snapshot: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                if (!snapshot) {
                    resolve();
                    return;
                }
                terminal.write(snapshot, () => resolve());
            } catch (error) {
                reject(error);
            }
        });
    }
}
