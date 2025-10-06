import type { ComponentType, CSSProperties } from 'react'

declare module 'react-window' {
  export interface ListChildComponentProps<T = unknown> {
    index: number
    style: CSSProperties
    data: T
    isScrolling?: boolean
  }

  export const FixedSizeList: ComponentType<any>
}
