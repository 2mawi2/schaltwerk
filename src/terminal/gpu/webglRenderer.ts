import { Terminal as XTerm } from '@xterm/xterm';
import type { WebglAddon } from '@xterm/addon-webgl';
import { logger } from '../../utils/logger';
import { isWebGLSupported } from './webglCapability';
import { markWebglFailedGlobally } from './gpuFallbackState';
import { XtermAddonImporter } from '../xterm/xtermAddonImporter';

export interface RendererState {
    type: 'webgl' | 'canvas' | 'none';
    addon?: WebglAddon;
    contextLost: boolean;
}

export interface WebGLRendererCallbacks {
    onContextLost?: () => void;
    onWebGLLoaded?: () => void;
    onWebGLUnloaded?: () => void;
}

const addonImporter = new XtermAddonImporter();

async function loadWebglAddonCtor(): Promise<typeof WebglAddon> {
    return addonImporter.importAddon('webgl');
}

export class WebGLTerminalRenderer {
    private readonly terminal: XTerm;
    private readonly terminalId: string;
    private state: RendererState;
    private callbacks: WebGLRendererCallbacks;
    private initAttempted = false;
    private initializing = false;

    constructor(terminal: XTerm, terminalId: string, callbacks: WebGLRendererCallbacks = {}) {
        this.terminal = terminal;
        this.terminalId = terminalId;
        this.callbacks = callbacks;
        this.state = { type: 'none', contextLost: false };
    }

    async initialize(): Promise<RendererState> {
        if (this.state.type === 'webgl') {
            return this.state;
        }

        if (this.initializing || this.initAttempted) {
            return this.state;
        }

        if (!this.terminal.element) {
            logger.debug(`[GPU] Terminal element unavailable for ${this.terminalId}, deferring WebGL init`);
            return this.state;
        }

        this.initializing = true;
        this.initAttempted = true;

        if (!isWebGLSupported()) {
            logger.info(`[GPU] WebGL not supported for terminal ${this.terminalId}, using canvas renderer`);
            markWebglFailedGlobally('unsupported');
            this.state = { type: 'canvas', contextLost: false };
            this.initializing = false;
            return this.state;
        }

        try {
            const WebglAddonCtor = await loadWebglAddonCtor();
            const webglAddon = new WebglAddonCtor();
            webglAddon.onContextLoss(() => {
                logger.info(`[GPU] WebGL context lost for terminal ${this.terminalId}, disposing renderer`);
                this.state = { type: 'none', contextLost: true };
                this.initAttempted = false;
                try {
                    webglAddon.dispose();
                } catch (error) {
                    logger.debug(`[GPU] Error disposing WebGL addon after context loss (${this.terminalId})`, error);
                }
                markWebglFailedGlobally('context-loss');
                this.callbacks.onContextLost?.();
            });

            this.terminal.loadAddon(webglAddon);
            this.state = { type: 'webgl', addon: webglAddon, contextLost: false };
            logger.info(`[GPU] WebGL renderer initialized for terminal ${this.terminalId}`);
            this.callbacks.onWebGLLoaded?.();
            return this.state;
        } catch (error) {
            logger.warn(
                `[GPU] WebGL could not be loaded for terminal ${this.terminalId}. Falling back to DOM renderer for all terminals`,
                error
            );
            markWebglFailedGlobally('initialization-failed');
            this.state = { type: 'canvas', contextLost: false };
            return this.state;
        } finally {
            this.initializing = false;
        }
    }

    dispose(): void {
        const wasWebGL = this.state.type === 'webgl';
        if (this.state.addon) {
            try {
                this.state.addon.dispose();
            } catch (error) {
                logger.debug(`[GPU] Error disposing WebGL addon for terminal ${this.terminalId}:`, error);
            }
        }
        this.state = { type: 'none', contextLost: false };
        this.initAttempted = false;
        if (wasWebGL) {
            this.callbacks.onWebGLUnloaded?.();
        }
    }

    async ensureLoaded(): Promise<RendererState> {
        if (this.state.type === 'webgl' || this.initializing) {
            return this.state;
        }
        return this.initialize();
    }

    disposeIfLoaded(): void {
        if (this.state.type === 'webgl') {
            this.dispose();
        }
    }

    setCallbacks(callbacks: WebGLRendererCallbacks): void {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    getState(): RendererState {
        return this.state;
    }

    clearTextureAtlas(): void {
        if (this.state.type !== 'webgl') {
            return;
        }

        try {
            const terminalClear = (this.terminal as unknown as { clearTextureAtlas?: () => void }).clearTextureAtlas;
            if (typeof terminalClear === 'function') {
                terminalClear.call(this.terminal);
            } else if (this.state.addon && typeof this.state.addon.clearTextureAtlas === 'function') {
                this.state.addon.clearTextureAtlas();
            }
        } catch (error) {
            logger.debug(`[GPU] Error clearing texture atlas for terminal ${this.terminalId}:`, error);
        }
    }

    resetAttempt(): void {
        this.initAttempted = false;
    }
}
