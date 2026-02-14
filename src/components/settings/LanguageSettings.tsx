import { useAtomValue, useSetAtom } from 'jotai'
import { currentLanguageAtom, setLanguageActionAtom } from '../../store/atoms/language'
import type { Language } from '../../common/i18n/types'
import { theme } from '../../common/theme'
import { useTranslation } from '../../common/i18n/useTranslation'

const languageOptions: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
]

export function LanguageSettings() {
  const currentLanguage = useAtomValue(currentLanguageAtom)
  const setLanguage = useSetAtom(setLanguageActionAtom)
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: theme.fontSize.label,
          }}
        >
          {t.settings.language.label}
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {languageOptions.map((option) => {
          const isSelected = currentLanguage === option.id

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => { void setLanguage(option.id) }}
              aria-pressed={isSelected}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 ${isSelected ? 'settings-binary-item-selected' : 'settings-binary-item'}`}
              style={{
                color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontSize: theme.fontSize.body,
              }}
            >
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
