import { KeepAwakeState } from '../store/atoms/powerSettings'
import { ToastOptions } from './toast/ToastProvider'

export function buildKeepAwakeToast(state: KeepAwakeState, idleMinutes: number): ToastOptions {
  if (state === 'disabled') {
    return {
      tone: 'info',
      title: 'Keep-awake disabled',
      description: 'Sleep prevention turned off',
      durationMs: 2500,
    }
  }

  if (state === 'auto_paused') {
    return {
      tone: 'info',
      title: 'Keep-awake enabled (idle)',
      description: `Auto-paused until sessions become active — idle timeout ${idleMinutes}m`,
      durationMs: 3000,
    }
  }

  return {
    tone: 'success',
    title: 'Keep-awake enabled',
    description: 'Sleep prevention active while agents run',
    durationMs: 3000,
  }
}
