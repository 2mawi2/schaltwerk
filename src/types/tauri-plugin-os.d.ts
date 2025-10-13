declare module '@tauri-apps/plugin-os' {
  export function platform(): Promise<'macos' | 'linux' | 'windows'>
}
