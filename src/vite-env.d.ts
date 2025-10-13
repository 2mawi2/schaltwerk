/// <reference types="vite/client" />

declare global {
    interface Window {
        __cmdTPressed?: boolean
        __TAURI__?: boolean
    }
}

export {}
