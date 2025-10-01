export interface TerminalTransport {
  spawn(opts: { id: string; cwd: string; rows: number; cols: number; env?: Array<{ key: string; value: string }> }): Promise<{ termId: string }>
  write(termId: string, data: string): Promise<void>
  resize(termId: string, rows: number, cols: number): Promise<void>
  kill(termId: string): Promise<void>
  subscribe(
    termId: string,
    lastSeenSeq: number,
    onData: (message: { seq: number; bytes: Uint8Array }) => void,
  ): Promise<() => Promise<void> | void>
  ack(termId: string, seq: number, bytes: number): Promise<void>
}
