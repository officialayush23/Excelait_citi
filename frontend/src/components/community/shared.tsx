import { BadgeCheck, BookOpen, Briefcase, CalendarClock, CircleHelp, Library, Loader2, type LucideIcon, MessageSquare, Mic, Square } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { careerBySlug, careerName, examBySlug } from '@/data/catalogue'
import { cn } from '@/lib/utils'
import { startRecording, transcribe } from '@/lib/voice'
import { to } from '@/lib/links'
import { useUi } from '@/stores/ui'

export type PostTags = { careers?: string[]; exams?: string[] }
export type Post = {
  id: string
  kind: 'question' | 'opportunity' | 'story' | 'post' | 'resource'
  title: string
  body: string | null
  tags: PostTags | null
  deadline: string | null
  link: string | null
  answer_count: number
  score: number
  created_at: string
  author_id?: string
  author_name: string | null
  author_senior: boolean | null
  author_path: string | null
  group_id: string | null
}

export const KIND_ICON: Record<Post['kind'], LucideIcon> = {
  question: CircleHelp,
  opportunity: Briefcase,
  story: BookOpen,
  post: MessageSquare,
  resource: Library,
}
export const KIND_TONE: Record<Post['kind'], string> = {
  question: 'bg-tile-sky',
  opportunity: 'bg-tile-peach',
  story: 'bg-tile-rose',
  post: 'bg-tile-lilac',
  resource: 'bg-tile-mint',
}

/** Whole days from today to a YYYY-MM-DD date (negative when it has passed). */
export function daysLeft(deadline: string) {
  const d = new Date(`${deadline.slice(0, 10)}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

export function formatDate(iso: string, lang: string) {
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

export function timeAgo(iso: string, lang: string) {
  const secs = (new Date(iso).getTime() - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const abs = Math.abs(secs)
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(secs / 3600), 'hour')
  if (abs < 86_400 * 30) return rtf.format(Math.round(secs / 86_400), 'day')
  return formatDate(iso, lang)
}

export function DeadlineChip({ deadline, className }: { deadline: string; className?: string }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const n = daysLeft(deadline)
  const text = n < 0 ? t('community.deadlinePassed') : n === 0 ? t('community.deadlineToday') : t('community.deadlineIn', { count: n })
  return (
    <span
      title={formatDate(deadline, lang)}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold',
        n < 0 ? 'bg-muted text-muted-foreground' : n <= 7 ? 'bg-tile-rose text-tile-foreground' : 'bg-tile-peach text-tile-foreground',
        className,
      )}
    >
      <CalendarClock className="size-3.5" />
      {text}
    </span>
  )
}

/** Career and exam tags that open the matching pages. */
export function TagChips({ tags, className }: { tags: PostTags | null | undefined; className?: string }) {
  const lang = useUi((s) => s.language)
  const careers = tags?.careers ?? []
  const exams = tags?.exams ?? []
  if (!careers.length && !exams.length) return null
  const chip = 'inline-flex h-8 items-center rounded-full border bg-card px-3 text-xs font-medium text-foreground/80 hover:text-foreground'
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {careers.map((c) => (
        <Link key={`c-${c}`} to={to.career(c)} className={chip} onClick={(e) => e.stopPropagation()}>
          {careerBySlug[c] ? careerName(careerBySlug[c], lang) : c}
        </Link>
      ))}
      {exams.map((x) => (
        <Link key={`e-${x}`} to={to.exam(x)} className={chip} onClick={(e) => e.stopPropagation()}>
          {examBySlug[x]?.name ?? x}
        </Link>
      ))}
    </div>
  )
}

/** Name plus a "Senior · path" badge, and a verified tick for mentor-checked answers. */
export function AuthorLine({ name, senior, path, verified }: { name: string | null; senior: boolean | null; path: string | null; verified?: boolean }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
      <span className="font-medium text-foreground/80">{name || t('community.someone')}</span>
      {senior && (
        <Badge variant="secondary" className="h-6 gap-1 px-2.5">
          {t('community.senior')}
          {path ? ` · ${path}` : ''}
        </Badge>
      )}
      {verified && (
        <Badge className="h-6 gap-1 bg-tile-mint px-2.5 text-tile-foreground">
          <BadgeCheck />
          {t('community.verified')}
        </Badge>
      )}
    </span>
  )
}

/** Mic button: records, turns speech into text, and hands the text to the caller. */
export function VoiceButton({ onText, className }: { onText: (text: string) => void; className?: string }) {
  const { t } = useTranslation()
  const language = useUi((s) => s.language)
  const rec = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null)
  const [state, setState] = useState<'idle' | 'recording' | 'busy'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setError(null)
    if (state === 'recording') {
      setState('busy')
      try {
        const blob = await rec.current?.stop()
        rec.current = null
        const said = blob ? await transcribe(blob, language) : ''
        if (said) onText(said)
        else setError(t('community.notHeard'))
      } catch {
        setError(t('community.notHeard'))
      }
      setState('idle')
      return
    }
    try {
      rec.current = await startRecording()
      setState('recording')
    } catch {
      setError(t('community.noMic'))
    }
  }

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <Button
        type="button"
        variant="outline"
        onClick={() => void toggle()}
        disabled={state === 'busy'}
        className={cn('h-12 rounded-full px-5 text-base', state === 'recording' && 'animate-pulse border-transparent bg-destructive text-white hover:bg-destructive')}
      >
        {state === 'busy' ? <Loader2 className="size-5 animate-spin" /> : state === 'recording' ? <Square className="size-4" /> : <Mic className="size-5" />}
        {state === 'recording' ? t('community.stopSpeaking') : t('community.speak')}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export function PostSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-36 animate-pulse rounded-2xl border bg-muted/50" />
      ))}
    </div>
  )
}
