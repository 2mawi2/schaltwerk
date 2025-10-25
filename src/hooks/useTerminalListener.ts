import { useEffect, useRef } from 'react';
import { listenTerminalOutput } from '../common/eventSystem';
import { subscribeTerminalBackend, isPluginTerminal } from '../terminal/transport/backend';
import { logger } from '../utils/logger';

export interface TerminalListenerOptions {
  terminalId: string | null;
  onOutput: (output: string) => void;
  agentType?: string;
  enabled?: boolean;
  usePlugin?: boolean;
  initialSeq?: number;
}

export function useTerminalListener({
  terminalId,
  onOutput,
  agentType,
  enabled = true,
  usePlugin,
  initialSeq = 0
}: TerminalListenerOptions): void {
  const handlerRef = useRef(onOutput);
  handlerRef.current = onOutput;

  const textDecoderRef = useRef<TextDecoder | null>(null);
  const pluginSeqRef = useRef(initialSeq);

  useEffect(() => {
    if (!enabled || !terminalId) return;

    let mounted = true;
    let unlisten: (() => void) | undefined;

    const flushStreamingDecoder = () => {
      const decoder = textDecoderRef.current;
      if (!decoder) return;
      try {
        const tail = decoder.decode(new Uint8Array(0), { stream: false });
        if (tail && tail.length > 0) {
          handlerRef.current(tail);
        }
      } catch (error) {
        logger.debug('[useTerminalListener] decoder flush failed', { error });
      }
      textDecoderRef.current = null;
    };

    const setup = async () => {
      try {
        const pluginActive = usePlugin && isPluginTerminal(terminalId);

        if (pluginActive) {
          const unsubscribe = await subscribeTerminalBackend(
            terminalId,
            pluginSeqRef.current,
            (message) => {
              const decoder = textDecoderRef.current ??
                (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : null);

              if (!decoder) {
                logger.warn('[useTerminalListener] TextDecoder unavailable; dropping PTY chunk', {
                  terminalId
                });
                return;
              }

              textDecoderRef.current = decoder;
              pluginSeqRef.current = message.seq;

              const output = decoder.decode(message.bytes, { stream: true });
              if (output.length === 0) {
                return;
              }

              handlerRef.current(output);
            }
          );

          const pluginUnlisten = () => {
            try {
              flushStreamingDecoder();
              const result = unsubscribe?.() as unknown;
              if (result instanceof Promise) {
                void (result as Promise<void>).catch(err =>
                  logger.debug('[useTerminalListener] unsubscribe failed', { error: err })
                );
              }
            } catch (error) {
              logger.debug('[useTerminalListener] unsubscribe failed', { error });
            }
          };

          if (!mounted) {
            try {
              pluginUnlisten();
            } catch (error) {
              logger.debug('[useTerminalListener] Cleaned up plugin listener after unmount', {
                terminalId,
                error
              });
            }
            return;
          }

          unlisten = pluginUnlisten;
        } else {
          const listener = await listenTerminalOutput(terminalId, (output) => {
            if (!output) return;
            handlerRef.current(output.toString());
          });

          if (!mounted) {
            try {
              listener();
            } catch (error) {
              logger.debug('[useTerminalListener] Cleaned up listener after unmount', {
                terminalId,
                error
              });
            }
            return;
          }

          unlisten = listener;
        }
      } catch (error) {
        if (mounted) {
          logger.error('[useTerminalListener] Failed to setup listener', {
            terminalId,
            error
          });
        }
      }
    };

    setup();

    return () => {
      mounted = false;
      unlisten?.();
      flushStreamingDecoder();
      textDecoderRef.current = null;
    };
  }, [terminalId, agentType, enabled, usePlugin]);
}
