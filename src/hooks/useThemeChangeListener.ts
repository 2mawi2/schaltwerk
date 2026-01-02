import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { themeModeValueAtom } from '../store/atoms/themeMode'
import { refreshAllTerminalThemes } from '../terminal/xterm/XtermTerminal'

export function useThemeChangeListener(): void {
  const themeMode = useAtomValue(themeModeValueAtom)

  useEffect(() => {
    refreshAllTerminalThemes()
  }, [themeMode])
}
