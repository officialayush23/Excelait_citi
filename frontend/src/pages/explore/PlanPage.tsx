import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, Circle, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ListSkeleton, LoadError, usePlan, type Plan, type PlanStep } from '@/components/explore/shared'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { careerBySlug, careerName } from '@/data/catalogue'
import { api } from '@/lib/api'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

/** Where a step leads: an in-app page, an outside link, or nowhere. */
function stepLink(s: PlanStep): { href: string; external: boolean } | null {
  if (s.kind === 'exam' && s.ref_id) return { href: to.exam(s.ref_id), external: false }
  if (s.kind === 'program' && s.ref_id) return { href: to.course(s.ref_id), external: false }
  if (s.kind === 'scheme' && s.ref_id) return { href: to.scheme(s.ref_id), external: false }
  if (s.kind === 'document') return { href: to.money(), external: false }
  if (s.kind === 'course' && s.detail?.startsWith('http')) return { href: s.detail, external: true }
  return null
}

function groupKey(due: string | null) {
  return due ? due.slice(0, 7) : 'none'
}

export function PlanPage() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = usePlan(id)

  const tick = useMutation({
    mutationFn: ({ step, done }: { step: string; done: boolean }) => api<Plan>(`/api/v1/me/plans/${id}/steps/${step}`, { method: 'PATCH', body: JSON.stringify({ done }) }),
    onMutate: async ({ step, done }) => {
      await qc.cancelQueries({ queryKey: ['plan', id] })
      const prev = qc.getQueryData<Plan>(['plan', id])
      if (prev) qc.setQueryData(['plan', id], { ...prev, steps: prev.steps.map((s) => (s.id === step ? { ...s, done_at: done ? new Date().toISOString() : null } : s)) })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['plan', id], ctx.prev)
      toast.error(t('explore.loadError'))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['saved'] }),
  })
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/me/plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['saved'] }); navigate(to.plan()) },
    onError: () => toast.error(t('explore.loadError')),
  })

  if (q.isLoading) return <><PageHeader title={t('explore.loading')} back /><ListSkeleton rows={5} /></>
  if (q.isError || !q.data) return <><PageHeader title={t('nav.plan')} back /><LoadError notFound={(q.error as { status?: number } | null)?.status === 404} onRetry={() => void q.refetch()} /></>
  const plan = q.data
  const c = careerBySlug[plan.career_slug]
  const title = c ? careerName(c, i18n.language) : plan.title
  const done = plan.steps.filter((s) => s.done_at).length
  const pct = plan.steps.length ? Math.round((done / plan.steps.length) * 100) : 0

  const groups: { key: string; steps: PlanStep[] }[] = []
  for (const s of plan.steps) {
    const key = groupKey(s.due_date)
    const g = groups.find((x) => x.key === key)
    if (g) g.steps.push(s)
    else groups.push({ key, steps: [s] })
  }
  const label = (key: string) => {
    if (key === 'none') return t('explore.whenReady')
    const [y, m] = key.split('-').map(Number)
    return new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-IN' : `${i18n.language}-IN`, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <PageHeader title={title} subtitle={t('explore.planFor')} back actions={c && <Button asChild variant="outline" className="h-11 rounded-full px-5"><Link to={to.career(plan.career_slug)}>{t('explore.openCareer')}</Link></Button>} />
      <section className="rounded-3xl border bg-tile-mint p-5 text-tile-foreground">
        <p className="text-lg font-semibold">{t('explore.stepsDone', { done, total: plan.steps.length })}</p>
        <Progress value={pct} className="mt-3 h-3 bg-black/10 dark:bg-white/15" />
        {pct === 100 && <p className="mt-3 font-medium">{t('explore.allDone')}</p>}
      </section>

      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{label(g.key)}</h3>
          <ol className="flex flex-col gap-2 border-l-2 border-dashed pl-3">
            {g.steps.map((s) => {
              const link = stepLink(s)
              const isDone = !!s.done_at
              return (
                <li key={s.id} className="flex items-stretch gap-2 rounded-2xl border bg-card">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isDone}
                    aria-label={s.title}
                    onClick={() => tick.mutate({ step: s.id, done: !isDone })}
                    className="grid w-14 shrink-0 place-items-center rounded-l-2xl hover:bg-accent"
                  >
                    {isDone ? <span className="grid size-7 place-items-center rounded-full bg-highlight text-highlight-foreground"><Check className="size-4" /></span> : <Circle className="size-7 text-muted-foreground" />}
                  </button>
                  <div className={cn('min-w-0 flex-1 py-3', isDone && 'opacity-60')}>
                    <p className={cn('font-medium', isDone && 'line-through')}>{s.title}</p>
                    {s.detail && !s.detail.startsWith('http') && <p className="text-sm text-muted-foreground">{s.detail}</p>}
                    {s.due_date && <p className="text-xs text-muted-foreground">{t('explore.byDate', { date: s.due_date })}</p>}
                  </div>
                  {link && (
                    link.external ? (
                      <a href={link.href} target="_blank" rel="noreferrer" aria-label={t('explore.open')} className="grid w-12 shrink-0 place-items-center rounded-r-2xl text-muted-foreground hover:bg-accent"><ChevronRight /></a>
                    ) : (
                      <Link to={link.href} aria-label={t('explore.open')} className="grid w-12 shrink-0 place-items-center rounded-r-2xl text-muted-foreground hover:bg-accent"><ChevronRight /></Link>
                    )
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ))}

      <Button
        variant="outline"
        onClick={() => { if (window.confirm(t('explore.deleteConfirm'))) remove.mutate() }}
        disabled={remove.isPending}
        className="h-12 w-fit rounded-full px-6 text-destructive"
      >
        <Trash2 data-icon="inline-start" />{t('explore.deletePlan')}
      </Button>
    </div>
  )
}
