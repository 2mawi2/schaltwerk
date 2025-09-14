import { EnrichedSession } from '../types/session'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'

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
  const displayNameMap = new Map<string, string>() // Map base (group key) to display_name base
  
  // Group sessions by base name
  for (const session of sessions) {
    const sessionName = session.info.session_id
    const displayName = session.info.display_name
    const hasDbGroup = !!session.info.version_group_id
    const groupKey = hasDbGroup ? session.info.version_group_id! : getBaseSessionName(sessionName)
    const versionNumber = session.info.version_number ?? parseVersionFromSessionName(sessionName)
    
    // If we have a display name, extract its base name for the group header
    // For version groups, we want to use the display name from any session in the group
    if (displayName) {
      const displayBaseName = getBaseSessionName(displayName)
      if (!displayNameMap.has(groupKey) || versionNumber === null) {
        displayNameMap.set(groupKey, displayBaseName)
      }
    }
    
    // If no version number, this is a standalone session (not part of a version group)
    if (hasDbGroup) {
      if (!groups.has(groupKey)) groups.set(groupKey, [])
      groups.get(groupKey)!.push({ session, versionNumber: versionNumber ?? 1 })
    } else {
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
        // Part of a version group (name-based)
        if (!groups.has(groupKey)) {
          groups.set(groupKey, [])
        }
        groups.get(groupKey)!.push({
          session,
          versionNumber
        })
      }
    }
  }
  
  // Convert to SessionVersionGroup array and sort versions within each group
  const result: SessionVersionGroup[] = []
  
  for (const [groupKey, versions] of groups) {
    // Sort versions by number (1, 2, 3, 4)
    versions.sort((a, b) => a.versionNumber - b.versionNumber)
    
    // Use display name base if available, otherwise use session_id base
    const displayBaseName = displayNameMap.get(groupKey) || getBaseSessionName(versions[0]?.session.info.display_name || versions[0]?.session.info.session_id)
    
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
 * 1. Cancels all non-selected session versions
 * 2. Reloads sessions to reflect changes
 * 
 * Note: The selected version keeps its current name (e.g., feature_v2) as renaming
 * running sessions is not supported by the backend.
 */
export async function selectBestVersionAndCleanup(
  versionGroup: SessionVersionGroup,
  selectedSessionId: string,
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
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
    const versionsToCancel = versionGroup.versions.filter(v => 
      v.session.info.session_id !== selectedSessionId
    )
    
    for (const version of versionsToCancel) {
      await invoke(TauriCommands.SchaltwerkCoreCancelSession, { 
        name: version.session.info.session_id 
      })
    }

    // Reload sessions to reflect all changes
    await reloadSessions()
    
  } catch (error) {
    logger.error('Error during version cleanup:', error)
    throw new Error('Failed to cleanup session versions: ' + (error as Error).message)
  }
}
