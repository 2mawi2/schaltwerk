import { useAtomValue } from 'jotai'
import { translationsAtom, currentLanguageAtom } from '../../store/atoms/language'

export function useTranslation() {
  const t = useAtomValue(translationsAtom)
  const currentLanguage = useAtomValue(currentLanguageAtom)

  return { t, currentLanguage }
}
