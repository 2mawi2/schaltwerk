export type QueueConfig = {
  maxQueueBytes: number
  targetAfterDrop: number
  lowWaterMark: number
  maxWriteChunk: number
}

export type EnqueueState = {
  queue: string[]
  queuedBytes: number
  droppedBytes: number
  overflowActive: boolean
}

/**
 * Apply enqueue policy with overflow gating. When queue exceeds maxQueueBytes,
 * drop from the head until targetAfterDrop is reached. A single overflow note
 * should be emitted per overflow episode; callers can use `overflowActive` to
 * decide when to show the note and reset once the queue drains below lowWaterMark.
 */
export function applyEnqueuePolicy(
  state: EnqueueState,
  incoming: string,
  cfg: QueueConfig
): EnqueueState {
  let { queue, queuedBytes, droppedBytes, overflowActive } = state

  queue.push(incoming)
  queuedBytes += incoming.length

  if (queuedBytes > cfg.maxQueueBytes) {
    let toDrop = queuedBytes - cfg.targetAfterDrop
    while (toDrop > 0 && queue.length > 0) {
      const head = queue[0]
      if (head.length <= toDrop) {
        queue.shift()
        queuedBytes -= head.length
        droppedBytes += head.length
        toDrop -= head.length
      } else {
        queue[0] = head.slice(toDrop)
        queuedBytes -= toDrop
        droppedBytes += toDrop
        toDrop = 0
      }
    }
    overflowActive = true
  }

  // Clear overflow episode once we drain well below the target to avoid flapping
  if (overflowActive && queuedBytes <= cfg.lowWaterMark) {
    overflowActive = false
    droppedBytes = 0
  }

  return { queue, queuedBytes, droppedBytes, overflowActive }
}

export function makeAgentQueueConfig(): QueueConfig {
  const maxQueueBytes = 32 * 1024 * 1024 // 32MB
  const targetAfterDrop = 16 * 1024 * 1024 // 16MB
  return {
    maxQueueBytes,
    targetAfterDrop,
    lowWaterMark: Math.floor(targetAfterDrop / 2),
    maxWriteChunk: 512 * 1024, // 512KB drain chunks for faster catch-up
  }
}

export function makeDefaultQueueConfig(): QueueConfig {
  const maxQueueBytes = 8 * 1024 * 1024 // 8MB default (up from 4MB)
  const targetAfterDrop = 4 * 1024 * 1024 // 4MB
  return {
    maxQueueBytes,
    targetAfterDrop,
    lowWaterMark: Math.floor(targetAfterDrop / 2),
    maxWriteChunk: 128 * 1024, // 128KB
  }
}

