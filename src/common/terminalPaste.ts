import { isTuiAgent } from '../types/session'

export interface PasteSubmissionOptions {
  useBracketedPaste: boolean
  needsDelayedSubmit: boolean
}

export function getPasteSubmissionOptions(agentType: string | undefined | null): PasteSubmissionOptions {
  if (agentType === 'claude' || agentType === 'droid') {
    return { useBracketedPaste: false, needsDelayedSubmit: true }
  }

  if (isTuiAgent(agentType)) {
    return { useBracketedPaste: true, needsDelayedSubmit: true }
  }

  return { useBracketedPaste: true, needsDelayedSubmit: false }
}
