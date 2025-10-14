import { useCallback, useRef, useEffect } from 'react';

const RUN_EXIT_SENTINEL_PREFIX = '__SCHALTWERK_RUN_EXIT__=';
const RUN_EXIT_SENTINEL_TERMINATORS = ['\r', '\n'] as const;
const MAX_BUFFER_SIZE = 2048;

export interface StreamingDecoderOptions {
  onSentinel?: (exitCode: string) => void;
}

export interface StreamingDecoderResult {
  processChunk: (chunk: string) => void;
  flushDecoder: () => void;
}

export function useStreamingDecoder({
  onSentinel
}: StreamingDecoderOptions): StreamingDecoderResult {
  const outputBufferRef = useRef('');
  const onSentinelRef = useRef(onSentinel);

  onSentinelRef.current = onSentinel;

  const processChunk = useCallback((chunk: string) => {
    if (chunk.length > 0) {
      outputBufferRef.current = (outputBufferRef.current + chunk).slice(-MAX_BUFFER_SIZE);
    }

    const trimmed = chunk.trim();
    const containsSentinel = chunk.includes(RUN_EXIT_SENTINEL_PREFIX);

    if (trimmed.length === 0 && !containsSentinel) {
      return;
    }

    let searchIndex = outputBufferRef.current.indexOf(RUN_EXIT_SENTINEL_PREFIX);

    while (searchIndex !== -1) {
      const start = searchIndex + RUN_EXIT_SENTINEL_PREFIX.length;
      const terminatorIndex = RUN_EXIT_SENTINEL_TERMINATORS
        .map(term => ({ term, index: outputBufferRef.current.indexOf(term, start) }))
        .filter(({ index }) => index !== -1)
        .sort((a, b) => a.index - b.index)[0]?.index ?? -1;

      if (terminatorIndex === -1) {
        outputBufferRef.current = outputBufferRef.current.slice(searchIndex);
        return;
      }

      const exitCode = outputBufferRef.current.slice(start, terminatorIndex);

      if (onSentinelRef.current) {
        onSentinelRef.current(exitCode);
      }

      outputBufferRef.current = outputBufferRef.current.slice(terminatorIndex + 1);
      searchIndex = outputBufferRef.current.indexOf(RUN_EXIT_SENTINEL_PREFIX);
    }
  }, []);

  const flushDecoder = useCallback(() => {
    outputBufferRef.current = '';
  }, []);

  useEffect(() => {
    return () => {
      flushDecoder();
    };
  }, [flushDecoder]);

  return { processChunk, flushDecoder };
}
