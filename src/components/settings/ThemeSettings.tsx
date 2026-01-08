import { useAtomValue, useSetAtom } from 'jotai'
import { currentThemeIdAtom, setThemeActionAtom } from '../../store/atoms/theme'
import { ThemeId } from '../../common/themes/types'
import { theme } from '../../common/theme'
import { useTranslation } from '../../common/i18n/useTranslation'

interface ThemeOption {
  id: ThemeId
  label: string
  description: string
  experimental?: boolean
  colors: {
    bg: string
    bgSecondary: string
    text: string
    accent: string
  }
}

const themeOptions: ThemeOption[] = [
  {
    id: 'dark',
    label: 'Dark',
    description: 'Default dark theme',
    colors: {
      bg: '#0f172a',
      bgSecondary: '#1e293b',
      text: '#e2e8f0',
      accent: '#22d3ee',
    },
  },
  {
    id: 'tokyonight',
    label: 'Tokyo Night',
    description: 'Based on the popular Neovim theme',
    experimental: true,
    colors: {
      bg: '#1a1b26',
      bgSecondary: '#24283b',
      text: '#c0caf5',
      accent: '#7aa2f7',
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    description: 'Retro groove color scheme',
    experimental: true,
    colors: {
      bg: '#282828',
      bgSecondary: '#3c3836',
      text: '#ebdbb2',
      accent: '#83a598',
    },
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin Mocha',
    description: 'Soothing pastel theme (darkest)',
    experimental: true,
    colors: {
      bg: '#1e1e2e',
      bgSecondary: '#313244',
      text: '#cdd6f4',
      accent: '#89b4fa',
    },
  },
  {
    id: 'catppuccin-macchiato',
    label: 'Catppuccin Macchiato',
    description: 'Soothing pastel theme (medium)',
    experimental: true,
    colors: {
      bg: '#24273a',
      bgSecondary: '#363a4f',
      text: '#cad3f5',
      accent: '#8aadf4',
    },
  },
  {
    id: 'everforest',
    label: 'Everforest',
    description: 'Green-based comfortable color scheme',
    experimental: true,
    colors: {
      bg: '#2d353b',
      bgSecondary: '#3d484d',
      text: '#d3c6aa',
      accent: '#a7c080',
    },
  },
  {
    id: 'ayu',
    label: 'Ayu Dark',
    description: 'Modern dark theme with warm accents',
    experimental: true,
    colors: {
      bg: '#0B0E14',
      bgSecondary: '#11151C',
      text: '#BFBDB6',
      accent: '#E6B450',
    },
  },
  {
    id: 'kanagawa',
    label: 'Kanagawa',
    description: 'Inspired by Hokusai\'s Great Wave',
    experimental: true,
    colors: {
      bg: '#1F1F28',
      bgSecondary: '#2A2A37',
      text: '#DCD7BA',
      accent: '#7E9CD8',
    },
  },
  {
    id: 'light',
    label: 'Light',
    description: 'Light theme for bright environments',
    experimental: true,
    colors: {
      bg: '#ffffff',
      bgSecondary: '#f6f8fa',
      text: '#1f2328',
      accent: '#2563eb',
    },
  },
  {
    id: 'system',
    label: 'System',
    description: 'Follows your OS preference',
    experimental: true,
    colors: {
      bg: 'linear-gradient(135deg, #0f172a 50%, #ffffff 50%)',
      bgSecondary: '#1e293b',
      text: '#e2e8f0',
      accent: '#22d3ee',
    },
  },
]

function ThemePreviewCard({
  option,
  isSelected,
  onClick,
}: {
  option: ThemeOption
  isSelected: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const isGradient = option.colors.bg.includes('gradient')

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className="flex flex-col rounded-lg border transition-all"
      style={{
        width: '140px',
        backgroundColor: isSelected
          ? 'var(--color-accent-blue-bg)'
          : 'var(--color-bg-elevated)',
        borderColor: isSelected
          ? 'var(--color-accent-blue)'
          : 'var(--color-border-subtle)',
        borderWidth: isSelected ? '2px' : '1px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '60px',
          background: isGradient ? option.colors.bg : option.colors.bg,
          backgroundColor: isGradient ? undefined : option.colors.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: '80%',
            height: '36px',
            backgroundColor: option.colors.bgSecondary,
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            gap: '6px',
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: option.colors.accent,
            }}
          />
          <div
            style={{
              flex: 1,
              height: '4px',
              backgroundColor: option.colors.text,
              borderRadius: '2px',
              opacity: 0.6,
            }}
          />
        </div>
      </div>

      <div
        style={{
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span
            style={{
              color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontSize: theme.fontSize.body,
              fontWeight: 500,
            }}
          >
            {option.label}
          </span>
          {option.experimental && (
            <span
              style={{
                fontSize: '9px',
                color: 'var(--color-accent-amber)',
                fontWeight: 500,
                padding: '1px 3px',
                borderRadius: '2px',
                backgroundColor: 'var(--color-accent-amber-bg)',
              }}
            >
              {t.settings.theme.beta}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function ThemeSettings() {
  const currentTheme = useAtomValue(currentThemeIdAtom)
  const setTheme = useSetAtom(setThemeActionAtom)
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <label
        style={{
          color: 'var(--color-text-secondary)',
          fontSize: theme.fontSize.label,
        }}
      >
        {t.settings.theme.label}
      </label>
      <div className="flex flex-wrap gap-3">
        {themeOptions.map((option) => (
          <ThemePreviewCard
            key={option.id}
            option={option}
            isSelected={currentTheme === option.id}
            onClick={() => { void setTheme(option.id) }}
          />
        ))}
      </div>
      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: theme.fontSize.caption,
          marginTop: '0.5rem',
        }}
      >
        {t.settings.theme.moreThemes}
      </p>
    </div>
  )
}
