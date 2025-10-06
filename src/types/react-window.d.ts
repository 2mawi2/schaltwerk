import type { ComponentType, CSSProperties } from 'react'

declare module 'react-window' {
  export interface ListChildComponentProps<T = unknown> {
    index: number
    style: CSSProperties
    data: T
    isScrolling?: boolean
  }

  export interface FixedSizeListProps<T = unknown> {
    children: ComponentType<ListChildComponentProps<T>>
    className?: string
    height: number | string
    itemCount: number
    itemSize: number
    itemData?: T
    width: number | string
  }

  export const FixedSizeList: ComponentType<FixedSizeListProps>
}
