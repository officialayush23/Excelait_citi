/* eslint-disable react-refresh/only-export-components */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Bookmark, BookmarkCheck, ChevronRight, CircleCheck, CircleHelp, CircleX, ExternalLink, Flag, Loader2 } from 'lucide-react'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

import type { I18nName, PlanData, PlanSummary, Result } from './types'

/* ---------------- talking back to Saathi from inside a card ---------------- */

type Actions = { send: (message: string) => void; busy?: boolean }
const CardActions = createContext<Actions | null>(null)

/** The chat wraps its cards in this so a card can send a follow-up message. */
export function CardActionsProvider({ value, children }: { value: Actions; children: ReactNode }) {
  return <CardActions.Provider value={value}>{children}</CardActions.Provider>
}

/** Sends a message to Saathi: in the chat directly, anywhere else by opening the chat with it. */
export function useAskSaathi() {
  const ctx = useContext(CardActions)
  const navigate = useNavigate()
  return {
    busy: ctx?.busy ?? false,
    inChat: Boolean(ctx),
    ask: (message: string) => (ctx ? ctx.send(message) : navigate('/app/saathi', { state: { message } })),
  }
}

/* ---------------- small helpers ---------------- */

export function useName() {
  const { i18n } = useTranslation()
  return (x: I18nName) => x.name_i18n?.[i18n.language] ?? x.name
}

function locale(lang: string) {
  return lang === 'en' ? 'en-IN' : `${lang}-IN`
}

/** "2027-04" → "Apr 2027"; "2027-04-12" → "12 Apr 2027", in the app's language. */
export function useDateText() {
  const { i18n } = useTranslation()
  return (value?: string | null) => {
    if (!value) return null
    const month = /^\d{4}-\d{2}$/.test(value)
    const d = new Date(month ? `${value}-01T00:00:00` : value)
    if (Number.isNaN(d.getTime())) return value
    return new Intl.DateTimeFormat(locale(i18n.language), month ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
  }
}

export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/* ---------------- building blocks ---------------- */

export type TileTone = 'rose' | 'peach' | 'lilac' | 'mint' | 'sky' | 'highlight' | 'muted'

export const tileClass: Record<TileTone, string> = {
  rose: 'bg-tile-rose text-tile-foreground',
  peach: 'bg-tile-peach text-tile-foreground',
  lilac: 'bg-tile-lilac text-tile-foreground',
  mint: 'bg-tile-mint text-tile-foreground',
  sky: 'bg-tile-sky text-tile-foreground',
  highlight: 'bg-highlight text-highlight-foreground',
  muted: 'bg-muted text-muted-foreground',
}

export function TileIcon({ icon, tone, className }: { icon: ReactNode; tone: TileTone; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('grid size-11 shrink-0 place-items-center rounded-xl [&_svg]:size-5', tileClass[tone], className)}>
      {icon}
    </span>
  )
}

type ShellProps = {
  icon: ReactNode
  tone: TileTone
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
}

/** The frame every card shares: a coloured icon tile, a title, then the content. */
export function CardShell({ icon, tone, title, subtitle, action, children, className }: ShellProps) {
  return (
    <section aria-label={title} className={cn('flex flex-col gap-4 rounded-3xl border bg-card p-4 text-card-foreground sm:p-5', className)}>
      <header className="flex items-center gap-3">
        <TileIcon icon={icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg leading-tight font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h4>
}

const rowClass =
  'group flex min-h-14 w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

type RowProps = {
  to?: string
  href?: string
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  className?: string
}

/** A big tappable row that opens an entity's page (or an outside site when href is set). */
export function RowLink({ to: path, href, leading, title, subtitle, trailing, className }: RowProps) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && <span className="mt-0.5 block text-sm text-muted-foreground">{subtitle}</span>}
      </span>
      {trailing}
      {href ? (
        <ExternalLink aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      ) : path ? (
        <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      ) : null}
    </>
  )
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cn(rowClass, className)}>
        {body}
      </a>
    )
  if (path)
    return (
      <Link to={path} className={cn(rowClass, className)}>
        {body}
      </Link>
    )
  return <div className={cn(rowClass, 'hover:bg-surface', className)}>{body}</div>
}

/** A rounded pill that links somewhere (course chips, related careers). */
export function ChipLink({ to: path, children, tone = 'muted' }: { to: string; children: ReactNode; tone?: TileTone }) {
  return (
    <Link
      to={path}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        tone === 'muted' ? 'border bg-card hover:bg-accent' : tileClass[tone],
      )}
    >
      {children}
    </Link>
  )
}

export function SeeAll({ to: path, children }: { to: string; children: ReactNode }) {
  return (
    <Button asChild variant="outline" className="h-11 self-start rounded-full px-5 text-sm">
      <Link to={path}>
        {children}
        <ArrowRight data-icon="inline-end" />
      </Link>
    </Button>
  )
}

/* ---------------- scheme results ---------------- */

export const RESULT_ICON = { eligible: CircleCheck, needs_info: CircleHelp, not_eligible: CircleX } as const
export const RESULT_TONE: Record<Result, TileTone> = { eligible: 'mint', needs_info: 'peach', not_eligible: 'muted' }

export function ResultBadge({ result }: { result: Result }) {
  const { t } = useTranslation()
  const Icon = RESULT_ICON[result]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', tileClass[RESULT_TONE[result]])}>
      <Icon aria-hidden="true" className="size-3.5" />
      {t(`saathi.result.${result}`)}
    </span>
  )
}

/* ---------------- saved careers and plans ---------------- */

type SavedResponse = { saved: string[]; plans: PlanSummary[] }
const SAVED_KEY = ['me', 'saved'] as const

/** The student's saved careers and plans (shared with the Plan pages through the query cache). */
export function useSavedCareers() {
  return useQuery({
    queryKey: SAVED_KEY,
    queryFn: () => api<SavedResponse>('/api/v1/me/saved'),
    staleTime: 60_000,
    retry: false,
  })
}

export function useSaveCareer(slug: string, initial?: boolean) {
  const qc = useQueryClient()
  const { data } = useSavedCareers()
  const [local, setLocal] = useState<boolean | null>(null)
  const saved = local ?? (data ? data.saved.includes(slug) : Boolean(initial))
  const m = useMutation({
    mutationFn: (save: boolean) => api<{ saved: string[] }>('/api/v1/me/saved', { method: 'POST', body: JSON.stringify({ career: slug, save }) }),
    onMutate: (save) => setLocal(save),
    onSuccess: (res) => {
      qc.setQueryData<SavedResponse>(SAVED_KEY, (old) => ({ plans: old?.plans ?? [], saved: res.saved }))
      setLocal(null)
    },
    onError: () => setLocal(null),
  })
  return { saved, pending: m.isPending, failed: m.isError, toggle: () => m.mutate(!saved) }
}

export function SaveButton({ slug, initial, compact }: { slug: string; initial?: boolean; compact?: boolean }) {
  const { t } = useTranslation()
  const { saved, pending, toggle } = useSaveCareer(slug, initial)
  const label = saved ? t('saathi.saved') : t('saathi.save')
  return (
    <Button
      type="button"
      variant={saved ? 'secondary' : 'outline'}
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={compact ? label : undefined}
      className={cn('shrink-0 rounded-full', compact ? 'size-11 p-0' : 'h-12 px-5 text-base')}
    >
      {saved ? <BookmarkCheck className="size-5" /> : <Bookmark className="size-5" />}
      {!compact && label}
    </Button>
  )
}

export function MakePlanButton({ career }: { career: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: () => api<PlanData>('/api/v1/me/plans', { method: 'POST', body: JSON.stringify({ career }) }),
    onSuccess: (plan) => {
      void qc.invalidateQueries({ queryKey: SAVED_KEY })
      void qc.invalidateQueries({ predicate: (q) => q.queryKey.some((k) => k === 'plans' || k === 'plan') })
      navigate(to.planItem(plan.id))
    },
  })
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="lg" onClick={() => m.mutate()} disabled={m.isPending} className="h-12 rounded-full px-6 text-base">
        {m.isPending ? <Loader2 className="size-5 animate-spin" /> : <Flag className="size-5" />}
        {t('saathi.makePlan')}
      </Button>
      {m.isError && <p className="text-sm text-destructive" role="alert">{t('saathi.actionFailed')}</p>}
    </div>
  )
}
