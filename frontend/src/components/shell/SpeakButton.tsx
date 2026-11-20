import { Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LANGUAGES } from '@/i18n'
import { cn } from '@/lib/utils'
import { speak, stopSpeaking } from '@/lib/voice'
import { useUi } from '@/stores/ui'

/** Reads text aloud: Sarvam voice when online, the phone's own voice offline. */
export function SpeakButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation()
  const language = useUi((s) => s.language)
  const [speaking, setSpeaking] = useState(false)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  useEffect(() => () => {
    if (speaking) stopSpeaking()
  }, [speaking])

  if (!supported && !navigator.onLine) return null

  function toggle() {
    if (speaking) {
      stopSpeaking()
      setSpeaking(false)
      return
    }
    setSpeaking(true)
    const voice = LANGUAGES.find((l) => l.code === language)?.voice ?? 'en-IN'
    void speak(text, language, voice, () => setSpeaking(false))
  }

  const label = speaking ? t('common.stopReading') : t('common.readAloud')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={speaking}
          onClick={toggle}
          className={cn('rounded-full text-muted-foreground hover:text-foreground', speaking && 'text-foreground', className)}
        >
          {speaking ? <VolumeX /> : <Volume2 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
