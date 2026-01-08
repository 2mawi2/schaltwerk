import { AnimatedText } from '../common/AnimatedText'
import { useTranslation } from '../../common/i18n'

type Props = {
  visible: boolean
}

export function TerminalLoadingOverlay({ visible }: Props) {
  const { t } = useTranslation()

  if (!visible) return null

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-background-secondary z-20"
      role="status"
      aria-live="polite"
      aria-label={t.terminalComponents.loading}
    >
      <AnimatedText
        text={t.terminalComponents.loading}
        colorClassName="text-slate-500"
        speedMultiplier={3}
      />
    </div>
  )
}
