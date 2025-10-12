import { logger } from '../../utils/logger';

export type TerminalVisibility = 'visible' | 'hidden' | 'background';

interface VisibilityState {
    visibility: TerminalVisibility;
    lastVisibleAt: number;
    renderCount: number;
}

export class TerminalVisibilityTracker {
    private static instance: TerminalVisibilityTracker;
    private visibilityMap = new Map<string, VisibilityState>();
    private listeners = new Map<string, Set<(visibility: TerminalVisibility) => void>>();
    private observers = new Map<string, IntersectionObserver>();

    private constructor() {}

    static getInstance(): TerminalVisibilityTracker {
        if (!TerminalVisibilityTracker.instance) {
            TerminalVisibilityTracker.instance = new TerminalVisibilityTracker();
        }
        return TerminalVisibilityTracker.instance;
    }

    registerTerminal(terminalId: string, element: HTMLElement): void {
        if (!this.visibilityMap.has(terminalId)) {
            this.visibilityMap.set(terminalId, {
                visibility: 'hidden',
                lastVisibleAt: 0,
                renderCount: 0
            });
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const visibility: TerminalVisibility = entry.isIntersecting ? 'visible' : 'hidden';
                    this.updateVisibility(terminalId, visibility);
                });
            },
            { threshold: 0.1 }
        );

        observer.observe(element);
        this.observers.set(terminalId, observer);
        logger.debug(`[TerminalVisibility] Registered terminal ${terminalId}`);
    }

    unregisterTerminal(terminalId: string): void {
        const observer = this.observers.get(terminalId);
        if (observer) {
            observer.disconnect();
            this.observers.delete(terminalId);
        }
        this.visibilityMap.delete(terminalId);
        this.listeners.delete(terminalId);
        logger.debug(`[TerminalVisibility] Unregistered terminal ${terminalId}`);
    }

    updateVisibility(terminalId: string, visibility: TerminalVisibility): void {
        const state = this.visibilityMap.get(terminalId);
        if (!state) return;

        if (state.visibility !== visibility) {
            state.visibility = visibility;
            if (visibility === 'visible') {
                state.lastVisibleAt = Date.now();
                state.renderCount++;
            }

            logger.debug(`[TerminalVisibility] Terminal ${terminalId} visibility changed to ${visibility}`);
            this.notifyListeners(terminalId, visibility);
        }
    }

    getVisibility(terminalId: string): TerminalVisibility {
        return this.visibilityMap.get(terminalId)?.visibility || 'hidden';
    }

    isVisible(terminalId: string): boolean {
        return this.getVisibility(terminalId) === 'visible';
    }

    getVisibleTerminals(): string[] {
        return Array.from(this.visibilityMap.entries())
            .filter(([_, state]) => state.visibility === 'visible')
            .map(([id]) => id);
    }

    getHiddenTerminals(): string[] {
        return Array.from(this.visibilityMap.entries())
            .filter(([_, state]) => state.visibility !== 'visible')
            .map(([id]) => id);
    }

    onVisibilityChange(terminalId: string, callback: (visibility: TerminalVisibility) => void): () => void {
        if (!this.listeners.has(terminalId)) {
            this.listeners.set(terminalId, new Set());
        }
        this.listeners.get(terminalId)!.add(callback);

        return () => {
            const callbacks = this.listeners.get(terminalId);
            if (callbacks) {
                callbacks.delete(callback);
            }
        };
    }

    private notifyListeners(terminalId: string, visibility: TerminalVisibility): void {
        const callbacks = this.listeners.get(terminalId);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(visibility);
                } catch (error) {
                    logger.error(`[TerminalVisibility] Error in visibility callback for ${terminalId}:`, error);
                }
            });
        }
    }

    getStats(): { visible: number; hidden: number; background: number } {
        const stats = { visible: 0, hidden: 0, background: 0 };
        this.visibilityMap.forEach(state => {
            stats[state.visibility]++;
        });
        return stats;
    }

    dispose(): void {
        this.observers.forEach(observer => observer.disconnect());
        this.observers.clear();
        this.visibilityMap.clear();
        this.listeners.clear();
    }
}
