import { AnimatedText } from '../common/AnimatedText'

type Props = {
  visible: boolean
}

export function TerminalLoadingOverlay({ visible }: Props) {
  if (!visible) return null

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background-secondary z-20">
      <AnimatedText
        text="loading"
        colorClassName="text-slate-500"
        size="md"
        speedMultiplier={3}
      />
    </div>
  )
}
