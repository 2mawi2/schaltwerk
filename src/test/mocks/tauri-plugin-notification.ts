export async function isPermissionGranted(): Promise<boolean> {
  return true
}

export async function requestPermission(): Promise<'granted'> {
  return 'granted'
}

export default {
  isPermissionGranted,
  requestPermission,
}
