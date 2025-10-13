/// <reference types="vite/client" />

declare module '@tauri-apps/plugin-os' {
    export function platform(): Promise<'macos' | 'linux' | 'windows'>
}

declare global {
    interface Window {
        __cmdTPressed?: boolean
        __TAURI__?: boolean
    }
}

export {}
