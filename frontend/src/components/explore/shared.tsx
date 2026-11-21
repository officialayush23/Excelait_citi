import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, BookmarkCheck, CalendarDays, ExternalLink, MapPin, RefreshCw, SearchX, ShieldCheck, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { EmptyState } from '@/components/page/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { CareerSource } from '@/engine/matching'
import { api } from '@/lib/api'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

/* ---------- types (mirror backend/app/services/graph.py, plans.py, colleges.py) ---------- */
export type I18n = Record<string, string> | null | undefined
export type ExamLite = { slug: string; name: string; next: string | null; official_url: string }
export type SchemeStatus = {
  slug: string
  name: string
  benefit_amount: number | null
  benefit_text: string
  official_url: string
  result: 'eligible' | 'needs_info' | 'not_eligible'
  missing: unknown[]
  failed: string[]
  documents: string[]
}
export type Resource = { slug: string; title: string; provider: string; url: string; kind: string; languages: string[]; tags?: { careers?: string[]; programs?: string[]; exams?: string[]; categories?: string[] } }
export type CareerRef = { slug: string; name: string; name_i18n: I18n }
export type Program = {
  slug: string
  name: string
  name_i18n: I18n
  level: string
  duration_months: number | null
  entry: string
  where: string
  college_kind: string
  official_url: string | null
  verify: string[]
  exams: ExamLite[]
  schemes: SchemeStatus[]
  careers: CareerRef[]
  resources: Resource[]
}
export type Career = {
  slug: string
  name: string
  name_i18n: I18n
  category: string
  pay_min: number | null
  pay_max: number | null
  min_education: string
  earning_speed: string
  cost_band: string
  nsqf_level: number | null
  needs_city: boolean
  path: string[]
  programs: Program[]
  exams: ExamLite[]
  schemes: SchemeStatus[]
  resources: Resource[]
  related: CareerRef[]
  sources?: CareerSource[]
  pay_evidence?: { min: number | null; max: number | null; n_sources: number } | null
  pay_status?: 'matches' | 'differs' | 'unverified' | null
  checked_on?: string | null
}
export type Exam = {
  slug: string
  name: string
  conducting_body: string
  eligibility: string
  typical_months: number[]
  official_url: string
  next: string | null
  programs: { slug: string; name: string }[]
  careers: CareerRef[]
  resources: Resource[]
}
export type College = {
  aishe_code: string
  name: string
  state: string | null
  district: string | null
  location: string | null
  college_type: string | null
  management: string | null
  university: string | null
  kind: string | null
  org_id: string | null
  details: Record<string, unknown> | null
}
export type Post = { id: string; kind: string; title: string; answer_count: number; author_name?: string | null; created_at: string }
export type Offer = { id: string; kind: string; title: string; org_name?: string | null; location?: string | null; is_remote?: boolean; deadline?: string | null; stipend_monthly?: number | null; match?: string }
export type PlanStep = { id: string; position: number; kind: string; ref_id: string | null; title: string; detail: string | null; due_date: string | null; done_at: string | null }
export type PlanSummary = { id: string; career_slug: string; title: string; status: string; total: number; done: number }
export type Plan = { id: string; career_slug: string; title: string; status: string; steps: PlanStep[] }

export const COLLEGE_KINDS = ['iti', 'polytechnic', 'engineering', 'general', 'nursing', 'paramedical', 'pharmacy', 'medical', 'agriculture', 'veterinary', 'law', 'teacher_training', 'hotel']

export const loc = (i18n: I18n, lang: string, fallback: string) => i18n?.[lang] ?? fallback

/* ---------- queries ---------- */
const get = <T,>(path: string) => api<T>(`/api/v1${path}`)

export const useCareer = (slug?: string) => useQuery({ queryKey: ['career', slug], queryFn: () => get<Career>(`/explore/careers/${slug}`), enabled: !!slug, retry: false })
export const useProgram = (slug?: string) => useQuery({ queryKey: ['program', slug], queryFn: () => get<Program>(`/explore/programs/${slug}`), enabled: !!slug, retry: false })
export const useExam = (slug?: string) => useQuery({ queryKey: ['exam', slug], queryFn: () => get<Exam>(`/explore/exams/${slug}`), enabled: !!slug, retry: false })
export const useSaved = () => useQuery({ queryKey: ['saved'], queryFn: () => get<{ saved: string[]; plans: PlanSummary[] }>('/me/saved'), retry: false })
export const usePlan = (id?: string) => useQuery({ queryKey: ['plan', id], queryFn: () => get<Plan>(`/me/plans/${id}`), enabled: !!id, retry: false })

export function useResources(p: { career?: string; program?: string; exam?: string }, enabled = true) {
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString()
  return useQuery({ queryKey: ['resources', qs], queryFn: () => get<{ resources: Resource[] }>(`/explore/resources${qs ? `?${qs}` : ''}`), enabled })
}

export function useColleges(p: { kind?: string; state?: string; district?: string; q?: string; limit?: number }, enabled = true) {
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString()
  return useQuery({ queryKey: ['colleges', qs], queryFn: () => get<{ colleges: College[]; directory_size: number }>(`/explore/colleges?${qs}`), enabled })
}

export const useCareerPosts = (career: string, enabled = true) =>
  useQuery({ queryKey: ['posts', career], queryFn: () => get<{ posts: Post[] }>(`/community/posts?career=${career}`), enabled, retry: false })
export const useCareerOffers = (career: string, enabled = true) =>
  useQuery({ queryKey: ['offers', career], queryFn: () => get<{ offers: Offer[] }>(`/opportunities?career=${career}`), enabled, retry: false })

export function useToggleSave() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: ({ career, save }: { career: string; save: boolean }) => api('/api/v1/me/saved', { method: 'POST', body: JSON.stringify({ career, save }) }),
    onMutate: async ({ career, save }) => {
      await qc.cancelQueries({ queryKey: ['saved'] })
      const prev = qc.getQueryData<{ saved: string[]; plans: PlanSummary[] }>(['saved'])
      if (prev) qc.setQueryData(['saved'], { ...prev, saved: save ? [...new Set([...prev.saved, career])] : prev.saved.filter((x) => x !== career) })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['saved'], ctx.prev)
      toast.error(t('explore.loadError'))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['saved'] }),
  })
}

export function useMakePlan() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (v: { career: string; program?: string }) => api<Plan>('/api/v1/me/plans', { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: (plan) => {
      qc.setQueryData(['plan', plan.id], plan)
      void qc.invalidateQueries({ queryKey: ['saved'] })
    },
    onError: () => toast.error(t('explore.loadError')),
  })
}

/* ---------- small UI pieces ---------- */
export function Section({ title, hint, children, className }: { title?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {title && (
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Note({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'warn' }) {
  return <p className={cn('rounded-2xl border px-4 py-3 text-sm', tone === 'warn' ? 'border-amber-500/40 bg-amber-500/10' : 'bg-card text-muted-foreground')}>{children}</p>
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-10 w-2/3 rounded-xl" />
      <Skeleton className="h-6 w-1/3 rounded-xl" />
      <Skeleton className="h-12 w-full rounded-full" />
      <Skeleton className="h-40 w-full rounded-3xl" />
      <Skeleton className="h-40 w-full rounded-3xl" />
    </div>
  )
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  )
}

export function LoadError({ onRetry, notFound }: { onRetry?: () => void; notFound?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-3xl border bg-card">
      <EmptyState
        icon={<SearchX />}
        title={notFound ? t('explore.notFoundTitle') : t('explore.errorTitle')}
        body={notFound ? t('explore.notFoundBody') : t('explore.errorBody')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {onRetry && !notFound && (
              <Button onClick={onRetry} className="h-12 rounded-full px-6 text-base">
                <RefreshCw data-icon="inline-start" />
                {t('explore.retry')}
              </Button>
            )}
            <Button asChild variant="outline" className="h-12 rounded-full px-6 text-base">
              <Link to={to.careers()}>{t('explore.browseCareers')}</Link>
            </Button>
          </div>
        }
      />
    </div>
  )
}

export function PillTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={cn(
            'h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors',
            tab.id === value ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card text-foreground/80 hover:text-foreground',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function SaveButton({ career, className }: { career: string; className?: string }) {
  const { t } = useTranslation()
  const saved = useSaved()
  const toggle = useToggleSave()
  if (saved.isError) return null // not a student account, or offline: no saving here
  const on = saved.data?.saved.includes(career) ?? false
  return (
    <Button variant="outline" disabled={saved.isLoading} aria-pressed={on} onClick={() => toggle.mutate({ career, save: !on })} className={cn('h-11 rounded-full px-5', className)}>
      {on ? <BookmarkCheck data-icon="inline-start" /> : <Bookmark data-icon="inline-start" />}
      {on ? t('explore.saved') : t('explore.save')}
    </Button>
  )
}

export function resultBadge(result: SchemeStatus['result'], t: (k: string) => string) {
  return <Badge variant={result === 'eligible' ? 'default' : 'outline'}>{t(`money.result.${result}`)}</Badge>
}

export function SchemeRow({ s }: { s: SchemeStatus }) {
  const { t } = useTranslation()
  return (
    <Link to={to.scheme(s.slug)} className="flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-4 py-3 hover:bg-accent">
      <Wallet className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{s.name}</span>
        {s.benefit_text && <span className="block truncate text-sm text-muted-foreground">{s.benefit_text}</span>}
      </span>
      {resultBadge(s.result, t)}
    </Link>
  )
}

export function monthName(n: number, lang: string) {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-IN' : `${lang}-IN`, { month: 'short' }).format(new Date(2026, n - 1, 1))
}

export function nextLabel(next: string | null, lang: string) {
  if (!next) return null
  const [y, m] = next.split('-').map(Number)
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-IN' : `${lang}-IN`, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
}

/** Twelve small month cells; typical months are filled, the next one is highlighted. */
export function MonthStrip({ months, next }: { months: number[]; next: string | null }) {
  const { i18n, t } = useTranslation()
  const nextM = next ? Number(next.split('-')[1]) : null
  return (
    <div>
      <ol className="grid grid-cols-6 gap-1.5 sm:grid-cols-12" aria-label={t('explore.typicalMonths')}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const on = months.includes(m)
          const isNext = m === nextM
          return (
            <li
              key={m}
              className={cn(
                'grid h-12 place-items-center rounded-xl border text-sm font-medium',
                isNext ? 'border-transparent bg-highlight text-highlight-foreground' : on ? 'border-transparent bg-tile-peach text-tile-foreground' : 'bg-card text-muted-foreground',
              )}
            >
              {monthName(m, i18n.language)}
            </li>
          )
        })}
      </ol>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-tile-peach" />{t('explore.usuallyHeld')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-highlight" />{t('explore.nextOne')}</span>
      </p>
    </div>
  )
}

export function ExamRow({ e }: { e: ExamLite }) {
  const { t, i18n } = useTranslation()
  const n = nextLabel(e.next, i18n.language)
  return (
    <Link to={to.exam(e.slug)} className="flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-4 py-3 hover:bg-accent">
      <CalendarDays className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{e.name}</span>
        {n && <span className="block text-sm text-muted-foreground">{t('explore.usuallyAround', { month: n })}</span>}
      </span>
    </Link>
  )
}

export function ResourceCard({ r }: { r: Resource }) {
  const { t } = useTranslation()
  return (
    <a href={r.url} target="_blank" rel="noreferrer" className="flex min-h-14 flex-col gap-2 rounded-2xl border bg-card px-4 py-3 hover:bg-accent">
      <span className="flex items-start justify-between gap-2">
        <span className="font-medium">{r.title}</span>
        <ExternalLink className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <span>{r.provider}</span>
        <Badge variant="secondary">{t(`explore.resKind.${r.kind}`, { defaultValue: r.kind })}</Badge>
        {r.languages?.map((l) => (
          <Badge key={l} variant="outline" className="uppercase">{l}</Badge>
        ))}
      </span>
    </a>
  )
}

export function ResourceGrid({ items }: { items: Resource[] }) {
  return <div className="grid gap-3 sm:grid-cols-2">{items.map((r) => <ResourceCard key={r.slug} r={r} />)}</div>
}

export function managementTone(m: string | null) {
  return (m ?? '').toLowerCase().includes('government') ? 'mint' : 'sky'
}

export function CollegeCard({ c }: { c: College }) {
  const { t } = useTranslation()
  return (
    <Link to={to.college(c.aishe_code)} className="flex min-h-14 flex-col gap-2 rounded-2xl border bg-card px-4 py-3 hover:bg-accent">
      <span className="flex items-start justify-between gap-2">
        <span className="font-medium">{c.name}</span>
        {c.org_id && (
          <Badge className="shrink-0"><ShieldCheck />{t('explore.verified')}</Badge>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <MapPin className="size-3.5" />
        <span>{[c.district, c.state].filter(Boolean).join(', ')}</span>
        {c.management && <Badge variant="secondary">{c.management}</Badge>}
        {c.location && <Badge variant="outline">{c.location}</Badge>}
      </span>
    </Link>
  )
}

export function CollegeList({ kind, state, district, limit = 6 }: { kind?: string; state?: string; district?: string; limit?: number }) {
  const { t } = useTranslation()
  const q = useColleges({ kind, state, district, limit })
  if (q.isLoading) return <ListSkeleton rows={2} />
  if (q.isError) return <Note tone="warn">{t('explore.errorBody')}</Note>
  if (q.data && q.data.directory_size === 0) return <Note>{t('explore.directoryComing')}</Note>
  if (!q.data?.colleges.length)
    return (
      <Note>
        {t('explore.noCollegesHere')}{' '}
        <Link className="font-medium underline underline-offset-4" to={to.colleges({ kind })}>{t('explore.seeAllColleges')}</Link>
      </Note>
    )
  return (
    <div className="flex flex-col gap-2">
      {q.data.colleges.map((c) => <CollegeCard key={c.aishe_code} c={c} />)}
      <Link to={to.colleges({ kind, state, district })} className="px-1 py-2 text-sm font-medium underline underline-offset-4">{t('explore.seeAllColleges')}</Link>
    </div>
  )
}

export function VerifyNotes({ notes }: { notes: string[] }) {
  const { t } = useTranslation()
  if (!notes?.length) return null
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <p className="mb-1 font-medium">{t('explore.verifyTitle')}</p>
      <ul className="list-disc pl-5">
        {notes.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
    </div>
  )
}

export function CareerChips({ items }: { items: CareerRef[] }) {
  const { i18n } = useTranslation()
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((c) => (
        <Link key={c.slug} to={to.career(c.slug)} className="inline-flex h-11 items-center rounded-full border bg-card px-4 text-sm font-medium hover:bg-accent">
          {loc(c.name_i18n, i18n.language, c.name)}
        </Link>
      ))}
    </div>
  )
}

export function ProgramCard({ p }: { p: Program }) {
  const { t, i18n } = useTranslation()
  const years = p.duration_months ? (p.duration_months >= 12 ? t('explore.years', { count: +(p.duration_months / 12).toFixed(1) }) : t('explore.monthsN', { count: p.duration_months })) : null
  return (
    <article className="flex flex-col gap-3 rounded-3xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link to={to.course(p.slug)} className="text-lg font-semibold tracking-tight underline-offset-4 hover:underline">{loc(p.name_i18n, i18n.language, p.name)}</Link>
        <div className="flex flex-wrap gap-1.5">
          {years && <Badge variant="secondary">{years}</Badge>}
          <Badge variant="outline">{t(`explore.entry.${p.entry}`, { defaultValue: p.entry })}</Badge>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{p.where}</p>
      <VerifyNotes notes={p.verify} />
      {p.exams.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('explore.examsNeeded')}</p>
          {p.exams.map((e) => <ExamRow key={e.slug} e={e} />)}
        </div>
      )}
      {p.schemes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('explore.moneyForThis')}</p>
          {p.schemes.map((s) => <SchemeRow key={s.slug} s={s} />)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {p.college_kind && !['none', 'employer'].includes(p.college_kind) && (
          <Button asChild variant="outline" className="h-11 rounded-full px-5">
            <Link to={to.colleges({ kind: p.college_kind })}>{t('explore.findColleges')}</Link>
          </Button>
        )}
        <Button asChild variant="ghost" className="h-11 rounded-full px-5">
          <Link to={to.course(p.slug)}>{t('explore.openFullPage')}</Link>
        </Button>
      </div>
    </article>
  )
}

/** Posts and a "ask a question" link for a career (or exam). */
export function CommunityBlock({ career, exam }: { career?: string; exam?: string }) {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['posts', career ?? '', exam ?? ''],
    queryFn: () => get<{ posts: Post[] }>(`/community/posts?${career ? `career=${career}` : `exam=${exam}`}`),
    retry: false,
  })
  const ask = to.community({ career, exam, kind: 'question' })
  return (
    <div className="flex flex-col gap-2">
      {q.isLoading && <ListSkeleton rows={2} />}
      {q.isError && <Note tone="warn">{t('explore.errorBody')}</Note>}
      {q.data && q.data.posts.length === 0 && <Note>{t('explore.noPosts')}</Note>}
      {q.data?.posts.slice(0, 6).map((p) => (
        <Link key={p.id} to={to.post(p.id)} className="flex min-h-14 flex-col gap-1 rounded-2xl border bg-card px-4 py-3 hover:bg-accent">
          <span className="font-medium">{p.title}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <Badge variant="secondary">{t(`explore.postKind.${p.kind}`, { defaultValue: p.kind })}</Badge>
            {p.author_name && <span>{p.author_name}</span>}
            <span>{t('explore.answers', { count: p.answer_count })}</span>
          </span>
        </Link>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild className="h-11 rounded-full px-5"><Link to={ask}>{t('explore.askQuestion')}</Link></Button>
        <Button asChild variant="outline" className="h-11 rounded-full px-5"><Link to={to.community({ career, exam })}>{t('explore.seeCommunity')}</Link></Button>
      </div>
    </div>
  )
}
