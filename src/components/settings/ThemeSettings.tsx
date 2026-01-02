import { useAtomValue, useSetAtom } from 'jotai'
import { currentThemeIdAtom, setThemeActionAtom, resolvedThemeAtom } from '../../store/atoms/theme'
import { ThemeId } from '../../common/themes/types'
import { theme } from '../../common/theme'

const themeOptions: { id: ThemeId; label: string; icon: string; experimental?: boolean }[] = [
  { id: 'dark', label: 'Dark', icon: '\u{1F319}' },
  { id: 'light', label: 'Light', icon: '\u2600\uFE0F', experimental: true },
  { id: 'system', label: 'System', icon: '\u{1F4BB}', experimental: true },
]

export function ThemeSettings() {
  const currentTheme = useAtomValue(currentThemeIdAtom)
  const resolvedTheme = useAtomValue(resolvedThemeAtom)
  const setTheme = useSetAtom(setThemeActionAtom)
  const resolvedLabel = resolvedTheme === 'dark' ? 'Dark' : 'Light'
  const statusLabel = currentTheme === 'system'
    ? `Follows system (${resolvedLabel})`
    : `Currently ${resolvedLabel}`

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: theme.fontSize.label,
          }}
        >
          Theme
        </label>
        <span
          style={{
            color: 'var(--color-text-muted)',
            fontSize: theme.fontSize.caption,
          }}
        >
          {statusLabel}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {themeOptions.map((option) => {
          const isSelected = currentTheme === option.id

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => { void setTheme(option.id) }}
              aria-pressed={isSelected}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors"
              style={{
                backgroundColor: isSelected
                  ? 'var(--color-accent-blue-bg)'
                  : 'var(--color-bg-elevated)',
                borderColor: isSelected
                  ? 'var(--color-accent-blue)'
                  : 'var(--color-border-subtle)',
                color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontSize: theme.fontSize.body,
              }}
            >
              <span role="img" aria-hidden="true">
                {option.icon}
              </span>
              <span>{option.label}</span>
              {option.experimental && (
                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--color-accent-amber)',
                    fontWeight: 500,
                    padding: '1px 4px',
                    borderRadius: '3px',
                    backgroundColor: 'var(--color-accent-amber-bg)',
                  }}
                >
                  Experimental
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: theme.fontSize.caption,
          marginTop: '0.5rem',
        }}
      >
        Light and System themes are experimental and may have visual inconsistencies.
      </p>
    </div>
  )
}
