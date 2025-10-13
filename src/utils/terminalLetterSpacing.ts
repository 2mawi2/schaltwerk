import { Terminal as XTerm } from '@xterm/xterm';
import { WebGLTerminalRenderer } from '../terminal/gpu/webglRenderer';
import { logger } from './logger';

export const DEFAULT_LETTER_SPACING = 0;
export const GPU_LETTER_SPACING = 0.6;

interface ApplyOptions {
    terminal: XTerm | null;
    renderer: WebGLTerminalRenderer | null;
    relaxed: boolean;
    terminalId: string;
    onWebglRefresh?: () => void;
}

export function applyTerminalLetterSpacing({
    terminal,
    renderer,
    relaxed,
    terminalId,
    onWebglRefresh,
}: ApplyOptions): void {
    if (!terminal) {
        return;
    }

    const nextSpacing = relaxed ? GPU_LETTER_SPACING : DEFAULT_LETTER_SPACING;
    if (terminal.options.letterSpacing === nextSpacing) {
        return;
    }

    terminal.options.letterSpacing = nextSpacing;

    if (relaxed && renderer?.getState().type === 'webgl') {
        onWebglRefresh?.();
        return;
    }

    const runRefresh = () => {
        try {
            const rows = Math.max(0, terminal.rows - 1);
            (terminal as unknown as { refresh?: (start: number, end: number) => void })?.refresh?.(0, rows);
        } catch (error) {
            logger.debug(`[Terminal ${terminalId}] Failed to refresh terminal after letter-spacing change:`, error);
        }
    };

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(runRefresh);
    } else {
        setTimeout(runRefresh, 0);
    }
}
