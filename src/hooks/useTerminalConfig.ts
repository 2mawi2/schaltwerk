import { useRef, useMemo, useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  resolvedFontFamilyAtom,
  customFontFamilyAtom,
  smoothScrollingEnabledAtom,
  webglEnabledAtom,
  terminalSettingsInitializedReadAtom,
  initializeTerminalSettingsActionAtom,
  setTerminalFontFamilyActionAtom,
} from '../store/atoms/terminal'
import { terminalFontSizeAtom } from '../store/atoms/fontSize'

const SCROLLBACK_LINES = 20000
const ATLAS_CONTRAST_BASE = 1.1
const DEFAULT_FONT_FAMILY = 'Menlo, Monaco, ui-monospace, SFMono-Regular, monospace'

interface TerminalConfigOptions {
  readOnly: boolean
}

export interface TerminalConfig {
  scrollback: number
  fontSize: number
  fontFamily: string
  readOnly: boolean
  minimumContrastRatio: number
  smoothScrolling: boolean
}

export interface UseTerminalConfigResult {
  config: TerminalConfig
  configRef: React.MutableRefObject<TerminalConfig>
  resolvedFontFamily: string
  customFontFamily: string | null
  smoothScrollingEnabled: boolean
  webglEnabled: boolean
  terminalFontSize: number
  initialized: boolean
  resolvedFontFamilyRef: React.MutableRefObject<string>
  smoothScrollingEnabledRef: React.MutableRefObject<boolean>
  terminalFontSizeRef: React.MutableRefObject<number>
  readOnlyRef: React.MutableRefObject<boolean>
  setFontFamily: (fontFamily: string | null) => void
}

export function useTerminalConfig(options: TerminalConfigOptions): UseTerminalConfigResult {
  const { readOnly } = options

  const resolvedFontFamily = useAtomValue(resolvedFontFamilyAtom)
  const customFontFamily = useAtomValue(customFontFamilyAtom)
  const smoothScrollingEnabled = useAtomValue(smoothScrollingEnabledAtom)
  const webglEnabled = useAtomValue(webglEnabledAtom)
  const terminalFontSize = useAtomValue(terminalFontSizeAtom)
  const initialized = useAtomValue(terminalSettingsInitializedReadAtom)

  const initializeSettings = useSetAtom(initializeTerminalSettingsActionAtom)
  const setFontFamily = useSetAtom(setTerminalFontFamilyActionAtom)

  useEffect(() => {
    if (!initialized) {
      void initializeSettings()
    }
  }, [initialized, initializeSettings])

  const resolvedFontFamilyRef = useRef(resolvedFontFamily)
  resolvedFontFamilyRef.current = resolvedFontFamily

  const smoothScrollingEnabledRef = useRef(smoothScrollingEnabled)
  smoothScrollingEnabledRef.current = smoothScrollingEnabled

  const terminalFontSizeRef = useRef(terminalFontSize)
  terminalFontSizeRef.current = terminalFontSize

  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  const config = useMemo((): TerminalConfig => {
    return {
      scrollback: SCROLLBACK_LINES,
      fontSize: terminalFontSize,
      fontFamily: resolvedFontFamily || DEFAULT_FONT_FAMILY,
      readOnly,
      minimumContrastRatio: ATLAS_CONTRAST_BASE,
      smoothScrolling: smoothScrollingEnabled,
    }
  }, [
    terminalFontSize,
    resolvedFontFamily,
    readOnly,
    smoothScrollingEnabled,
  ])

  const configRef = useRef(config)
  configRef.current = config

  return {
    config,
    configRef,
    resolvedFontFamily,
    customFontFamily,
    smoothScrollingEnabled,
    webglEnabled,
    terminalFontSize,
    initialized,
    resolvedFontFamilyRef,
    smoothScrollingEnabledRef,
    terminalFontSizeRef,
    readOnlyRef,
    setFontFamily,
  }
}
