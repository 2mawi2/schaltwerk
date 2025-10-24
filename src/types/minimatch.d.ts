declare module 'minimatch' {
  export interface MinimatchOptions {
    cwd?: string
    dot?: boolean
    matchBase?: boolean
    nocase?: boolean
    nobrace?: boolean
    noglobstar?: boolean
    noext?: boolean
    partial?: boolean
    nocomment?: boolean
    [key: string]: unknown
  }

  export default function minimatch(
    path: string,
    pattern: string,
    options?: MinimatchOptions
  ): boolean
}
