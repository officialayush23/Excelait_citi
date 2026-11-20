/* eslint-disable react-refresh/only-export-components */
import { Building2, CalendarDays, Compass, Flag, Loader2, Mic, Send, Sparkles, Square, Users, Wallet } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useFacts } from '@/data/facts'
import { profileComplete } from '@/data/insights'
import { cn } from '@/lib/utils'
import { startRecording, transcribe } from '@/lib/voice'
import { useUi } from '@/stores/ui'

import { tileClass, type TileTone } from './kit'

/** Saathi's face: a soft highlight circle with a spark. */
export function SaathiAvatar({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-highlight text-highlight-foreground', className)}>
      <Sparkles className="size-[55%]" />
    </span>
  )
}

export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export type Suggestion = { key: string; label: string; message: string; icon: ReactNode; tone: TileTone }

/** Six starting points, worded around what the app already knows about the student. */
export function useSaathiSuggestions(): Suggestion[] {
  const { t } = useTranslation()
  const facts = useFacts((s) => s.facts)
  const done = profileComplete(facts)
  const district = typeof facts.district === 'string' ? facts.district : null
  const state = typeof facts.state === 'string' && facts.state !== 'Other' ? facts.state : null
  const place = district ?? state
  const cls = typeof facts.class_level === 'number' ? facts.class_level : null
  return [
    {
      key: 'careers',
      label: t('saathi.suggest.careers'),
      message: done ? t('saathi.suggest.careersMsg') : t('saathi.suggest.careersNewMsg'),
      icon: <Compass />,
      tone: 'lilac',
    },
    { key: 'money', label: t('saathi.suggest.money'), message: t('saathi.suggest.moneyMsg'), icon: <Wallet />, tone: 'peach' },
    {
      key: 'colleges',
      label: place ? t('saathi.suggest.collegesIn', { place }) : t('saathi.suggest.colleges'),
      message: place ? t('saathi.suggest.collegesInMsg', { place }) : t('saathi.suggest.collegesMsg'),
      icon: <Building2 />,
      tone: 'rose',
    },
    { key: 'plan', label: t('saathi.suggest.plan'), message: t('saathi.suggest.planMsg'), icon: <Flag />, tone: 'mint' },
    {
      key: 'exams',
      label: t('saathi.suggest.exams'),
      message: cls ? t('saathi.suggest.examsClassMsg', { n: cls > 12 ? 12 : cls }) : t('saathi.suggest.examsMsg'),
      icon: <CalendarDays />,
      tone: 'sky',
    },
    { key: 'seniors', label: t('saathi.suggest.seniors'), message: t('saathi.suggest.seniorsMsg'), icon: <Users />, tone: 'lilac' },
  ]
}

export function SuggestionChips({ onPick, disabled, className }: { onPick: (message: string) => void; disabled?: boolean; className?: string }) {
  const suggestions = useSaathiSuggestions()
  return (
    <motion.ul
      initial="hidden"
      animate="show"
      transition={{ staggerChildren: 0.04 }}
      className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3', className)}
    >
      {suggestions.map((s) => (
        <motion.li key={s.key} variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(s.message)}
            className="flex h-full min-h-14 w-full items-center gap-2.5 rounded-2xl border bg-card px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 sm:text-base"
          >
            <span aria-hidden="true" className={cn('grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-[18px]', tileClass[s.tone])}>
              {s.icon}
            </span>
            <span className="leading-snug">{s.label}</span>
          </button>
        </motion.li>
      ))}
    </motion.ul>
  )
}

type ComposerProps = {
  onSend: (text: string) => void
  busy?: boolean
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}

/** Big mic, a text box and send. Speaking is the first choice for many students. */
export function Composer({ onSend, busy, disabled, autoFocus, className }: ComposerProps) {
  const { t } = useTranslation()
  const language = useUi((s) => s.language)
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null)
  const blocked = Boolean(busy || disabled)

  useEffect(() => () => void rec.current?.stop(), [])

  function submit(value: string) {
    const v = value.trim()
    if (!v || blocked) return
    setText('')
    setError(null)
    onSend(v)
  }

  async function toggleMic() {
    setError(null)
    if (recording) {
      setRecording(false)
      const blob = await rec.current?.stop()
      rec.current = null
      if (!blob) return
      setListening(true)
      try {
        const said = (await transcribe(blob, language)).trim()
        if (said) submit(said)
        else setError(t('saathi.notHeard'))
      } catch {
        setError(t('saathi.notHeard'))
      } finally {
        setListening(false)
      }
      return
    }
    try {
      rec.current = await startRecording()
      setRecording(true)
    } catch {
      setError(t('saathi.noMic'))
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
      >
        <Button
          type="button"
          size="icon"
          onClick={() => void toggleMic()}
          disabled={blocked || listening}
          aria-label={recording ? t('saathi.stopSpeaking') : t('saathi.speak')}
          aria-pressed={recording}
          className={cn('size-14 shrink-0 rounded-full', recording && 'animate-pulse bg-destructive text-white hover:bg-destructive')}
        >
          {listening ? <Loader2 className="size-6 animate-spin" /> : recording ? <Square className="size-5" /> : <Mic className="size-6" />}
        </Button>
        <label className="sr-only" htmlFor="saathi-input">
          {t('saathi.typeHere')}
        </label>
        <input
          id="saathi-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={recording ? t('saathi.listening') : t('saathi.typeHere')}
          disabled={disabled || recording || listening}
          autoFocus={autoFocus}
          maxLength={1000}
          autoComplete="off"
          enterKeyHint="send"
          className="h-14 min-w-0 flex-1 rounded-full border border-input bg-card px-5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60"
        />
        <Button
          type="submit"
          size="icon"
          variant="outline"
          className="size-14 shrink-0 rounded-full"
          disabled={blocked || !text.trim()}
          aria-label={t('saathi.send')}
        >
          <Send className="size-5" />
        </Button>
      </form>
      <p aria-live="polite" className={cn('px-4 text-sm', error ? 'text-destructive' : 'sr-only')}>
        {error ?? (recording ? t('saathi.listening') : '')}
      </p>
    </div>
  )
}
