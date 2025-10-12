import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { logger } from '../../utils/logger';
import { isWebGLSupported } from './webglCapability';

export interface RendererState {
    type: 'webgl' | 'canvas' | 'none';
    addon?: WebglAddon;
    contextLost: boolean;
}

export class WebGLTerminalRenderer {
    private terminal: XTerm;
    private terminalId: string;
    private state: RendererState;
    private contextLostHandler?: () => void;
    private initAttempted = false;

    constructor(terminal: XTerm, terminalId: string) {
        this.terminal = terminal;
        this.terminalId = terminalId;
        this.state = { type: 'none', contextLost: false };
    }

    async initialize(): Promise<RendererState> {
        if (this.initAttempted) {
            return this.state;
        }
        this.initAttempted = true;

        if (!isWebGLSupported()) {
            logger.info(`[GPU] WebGL not supported for terminal ${this.terminalId}, using Canvas renderer`);
            this.state = { type: 'canvas', contextLost: false };
            return this.state;
        }

        try {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => {
                logger.warn(`[GPU] WebGL context lost for terminal ${this.terminalId}, falling back to Canvas`);
                this.state.contextLost = true;
                this.state.type = 'canvas';
                if (this.contextLostHandler) {
                    this.contextLostHandler();
                }
            });

            this.terminal.loadAddon(webglAddon);
            this.state = { type: 'webgl', addon: webglAddon, contextLost: false };
            logger.info(`[GPU] WebGL renderer initialized for terminal ${this.terminalId}`);
            return this.state;
        } catch (error) {
            logger.warn(`[GPU] Failed to initialize WebGL for terminal ${this.terminalId}:`, error);
            this.state = { type: 'canvas', contextLost: false };
            return this.state;
        }
    }

    dispose(): void {
        if (this.state.addon) {
            try {
                this.state.addon.dispose();
            } catch (error) {
                logger.debug(`[GPU] Error disposing WebGL addon for terminal ${this.terminalId}:`, error);
            }
        }
        this.state = { type: 'none', contextLost: false };
        this.initAttempted = false;
    }

    onContextLost(handler: () => void): void {
        this.contextLostHandler = handler;
    }

    getState(): RendererState {
        return this.state;
    }

    clearTextureAtlas(): void {
        if (this.state.addon && this.state.type === 'webgl') {
            try {
                this.state.addon.clearTextureAtlas();
            } catch (error) {
                logger.debug(`[GPU] Error clearing texture atlas for terminal ${this.terminalId}:`, error);
            }
        }
    }
}
