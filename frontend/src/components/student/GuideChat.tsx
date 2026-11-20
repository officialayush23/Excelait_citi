import { Loader2, Mic, Send, Square } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/AuthProvider'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFacts } from '@/data/facts'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { startRecording, transcribe } from '@/lib/voice'
import { useUi } from '@/stores/ui'

type Msg = { role: 'user' | 'assistant'; content: string }

/**
 * Talk to the guide by voice or text. The guide only asks questions and records what the
 * student says; scholarships and careers are still decided by the rules on the phone.
 */
export function GuideChat() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const language = useUi((s) => s.language)
  const load = useFacts((s) => s.load)
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', content: t('guide.opening') }])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null)
  const online = navigator.onLine

  async function send(message: string) {
    if (!message.trim()) return
    setError(null)
    const history = msgs
    setMsgs([...history, { role: 'user', content: message }])
    setText('')
    setBusy(true)
    try {
      const res = await api<{ reply: string; saved: Record<string, unknown> }>('/api/v1/ai/onboard', {
        method: 'POST',
        body: JSON.stringify({ message, language, history }),
      })
      setMsgs((m) => [...m, { role: 'assistant', content: res.reply || t('guide.saved') }])
      if (Object.keys(res.saved).length && session) await load(session.user.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('guide.offline'))
    } finally {
      setBusy(false)
    }
  }

  async function toggleMic() {
    setError(null)
    if (recording) {
      setRecording(false)
      const blob = await rec.current?.stop()
      rec.current = null
      if (!blob) return
      setBusy(true)
      try {
        const said = await transcribe(blob, language)
        setBusy(false)
        if (said) await send(said)
        else setError(t('guide.notHeard'))
      } catch {
        setBusy(false)
        setError(t('guide.notHeard'))
      }
      return
    }
    try {
      rec.current = await startRecording()
      setRecording(true)
    } catch {
      setError(t('guide.noMic'))
    }
  }

  if (!online) return <p className="rounded-2xl border bg-card p-5 text-muted-foreground">{t('guide.offline')}</p>

  return (
    <div className="flex flex-col gap-4 rounded-3xl border bg-card p-4 sm:p-6">
      <ul className="flex max-h-[50dvh] min-h-48 flex-col gap-3 overflow-y-auto" aria-live="polite">
        <AnimatePresence initial={false}>
          {msgs.map((m, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn('flex max-w-[85%] items-start gap-1 rounded-2xl px-4 py-3 text-base', m.role === 'user' ? 'self-end bg-highlight text-highlight-foreground' : 'self-start bg-surface')}
            >
              <span>{m.content}</span>
              {m.role === 'assistant' && <SpeakButton text={m.content} className="-my-1" />}
            </motion.li>
          ))}
        </AnimatePresence>
        {busy && <Loader2 className="size-5 animate-spin self-start text-muted-foreground" aria-label={t('common.loading')} />}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send(text)
        }}
      >
        <Button
          type="button"
          size="icon"
          onClick={() => void toggleMic()}
          disabled={busy}
          aria-label={recording ? t('guide.stop') : t('guide.speak')}
          className={cn('size-14 shrink-0 rounded-full', recording && 'animate-pulse bg-destructive text-white hover:bg-destructive')}
        >
          {recording ? <Square className="size-5" /> : <Mic className="size-6" />}
        </Button>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('guide.typeHere')} className="h-14 rounded-full px-5 text-base" disabled={busy || recording} />
        <Button type="submit" size="icon" variant="outline" className="size-14 shrink-0 rounded-full" disabled={busy || !text.trim()} aria-label={t('guide.send')}>
          <Send className="size-5" />
        </Button>
      </form>
    </div>
  )
}
