declare module '@tauri-apps/plugin-notification' {
  type PermissionStatus = 'granted' | 'denied' | 'restricted' | 'prompt' | string

  /**
   * Check whether notifications are already permitted.
   */
  export function isPermissionGranted(): Promise<boolean>

  /**
   * Ask the user for notification permission.
   */
  export function requestPermission(): Promise<PermissionStatus>

  const _default: {
    isPermissionGranted: typeof isPermissionGranted
    requestPermission: typeof requestPermission
  }

  export default _default
}
