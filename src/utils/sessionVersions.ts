import { EnrichedSession } from '../types/session'

export { type EnrichedSession }

export interface SessionVersion {
  session: EnrichedSession
  versionNumber: number // 1 for base, 2-4 for _v2, _v3, _v4
}

export interface SessionVersionGroup {
  baseName: string
  versions: SessionVersion[]
  isVersionGroup: boolean // true if multiple versions exist
}

/**
 * Extracts version number from session name if it follows the _v{n} pattern
 * Returns null if no valid version suffix found
 */
export function parseVersionFromSessionName(sessionName: string): number | null {
  const match = sessionName.match(/_v(\d+)$/)
  if (!match) return null
  
  const version = parseInt(match[1], 10)
  // Support versions 1-4 (all with _v{n} suffix)
  if (version >= 1 && version <= 4) {
    return version
  }
  
  return null
}

/**
 * Gets the base session name by removing version suffix if present
 */
export function getBaseSessionName(sessionName: string): string {
  const version = parseVersionFromSessionName(sessionName)
  if (version === null) return sessionName
  
  return sessionName.replace(/_v\d+$/, '')
}

/**
 * Groups sessions by their base name, identifying version groups
 */
export function groupSessionsByVersion(sessions: EnrichedSession[]): SessionVersionGroup[] {
  const groups = new Map<string, SessionVersion[]>()
  const displayNameMap = new Map<string, string>() // Map base session_id to display_name base
  
  // Group sessions by base name
  for (const session of sessions) {
    const sessionName = session.info.session_id
    const displayName = session.info.display_name
    const baseName = getBaseSessionName(sessionName)
    const versionNumber = parseVersionFromSessionName(sessionName)
    
    // If we have a display name, extract its base name for the group header
    if (displayName && versionNumber !== null) {
      const displayBaseName = getBaseSessionName(displayName)
      displayNameMap.set(baseName, displayBaseName)
    }
    
    // If no version number, this is a standalone session (not part of a version group)
    if (versionNumber === null) {
      // Treat as a standalone session with version 1
      if (!groups.has(sessionName)) {
        groups.set(sessionName, [])
      }
      groups.get(sessionName)!.push({
        session,
        versionNumber: 1
      })
    } else {
      // Part of a version group
      if (!groups.has(baseName)) {
        groups.set(baseName, [])
      }
      groups.get(baseName)!.push({
        session,
        versionNumber
      })
    }
  }
  
  // Convert to SessionVersionGroup array and sort versions within each group
  const result: SessionVersionGroup[] = []
  
  for (const [baseName, versions] of groups) {
    // Sort versions by number (1, 2, 3, 4)
    versions.sort((a, b) => a.versionNumber - b.versionNumber)
    
    // Use display name base if available, otherwise use session_id base
    const displayBaseName = displayNameMap.get(baseName) || baseName
    
    result.push({
      baseName: displayBaseName,
      versions,
      isVersionGroup: versions.length > 1
    })
  }
  
  return result
}

/**
 * Selects the best version from a version group and cleans up the rest
 * This function:
 * 1. If selected version has a suffix, creates a new session with the base name and same properties
 * 2. Cancels all non-selected session versions (including the original selected one if renamed)  
 * 3. Reloads sessions to reflect changes
 */
export async function selectBestVersionAndCleanup(
  versionGroup: SessionVersionGroup,
  selectedSessionId: string,
  invoke: (command: string, args: any) => Promise<any>,
  reloadSessions: () => Promise<void>
): Promise<void> {
  if (!versionGroup.isVersionGroup) {
    throw new Error('Cannot select best version from a non-version group')
  }

  // Find the selected session in the group
  const selectedVersion = versionGroup.versions.find(v => v.session.info.session_id === selectedSessionId)
  if (!selectedVersion) {
    throw new Error('Selected session not found in version group')
  }

  try {
    // Cancel all other versions (not the selected one)
    // Note: We keep the selected version with its current name (e.g., base_v2)
    // Renaming running sessions is not supported by the backend
    const versionsToCancel = versionGroup.versions.filter(v => 
      v.session.info.session_id !== selectedSessionId
    )
    
    for (const version of versionsToCancel) {
      await invoke('schaltwerk_core_cancel_session', { 
        name: version.session.info.session_id 
      })
    }

    // Reload sessions to reflect all changes
    await reloadSessions()
    
  } catch (error) {
    console.error('Error during version cleanup:', error)
    throw new Error('Failed to cleanup session versions: ' + (error as Error).message)
  }
}