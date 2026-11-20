import { Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LANGUAGES } from '@/i18n'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

/**
 * Reads text aloud. Uses the phone's built-in voice for now (works offline when the
 * phone has a voice installed). Sarvam Bulbul voices replace this in Phase 2.
 */
export function SpeakButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation()
  const language = useUi((s) => s.language)
  const [speaking, setSpeaking] = useState(false)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  useEffect(() => () => {
    if (supported) window.speechSynthesis.cancel()
  }, [supported])

  if (!supported) return null

  function toggle() {
    const synth = window.speechSynthesis
    if (speaking) {
      synth.cancel()
      setSpeaking(false)
      return
    }
    const u = new SpeechSynthesisUtterance(text)
    u.lang = LANGUAGES.find((l) => l.code === language)?.voice ?? 'en-IN'
    u.rate = 0.95
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    synth.cancel()
    synth.speak(u)
    setSpeaking(true)
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
