import { JoinClassCard } from '@/components/teacher/JoinClassCard'
import { motion, useReducedMotion } from 'motion/react'
import { AlertTriangle, Bell, BellOff, Feather, History, Route, Sparkles, Undo2, WifiOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { ListSkeleton, LoadError } from '@/components/explore/shared'
import { EmptyState } from '@/components/page/EmptyState'
import { ProgressRing, DaysText } from '@/components/roadmap/parts'
import { StepNode } from '@/components/roadmap/StepNode'
import type { Bucket, Goal, Roadmap, RoadmapStep } from '@/components/roadmap/types'
import { roadmapApi, useRoadmap, useRoadmapAction } from '@/components/roadmap/useRoadmap'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

const GROUPS: Exclude<Bucket, 'done'>[] = ['now', 'next', 'later']

function Heading({ children, speak }: { children: string; speak?: string }) {
  return (
    <div className="flex items-center gap-1">
      <h2 className="text-lg font-semibold">{children}</h2>
      <SpeakButton text={speak ?? children} />
    </div>
  )
}

/** The student's adaptive roadmap: every goal as one chain of steps, plus what changed and the alerts. */
export function Plans() {
  const { t } = useTranslation()
  const q = useRoadmap()
  const reduce = useReducedMotion()
  const [goalId, setGoalId] = useState<string>('all')
  const [showDone, setShowDone] = useState(false)
  const errorText = t('roadmap.error')

  const step = useRoadmapAction((v: { id: string; body: Record<string, unknown> }) => roadmapApi.step(v.id, v.body), errorText)
  const undo = useRoadmapAction((id: string) => roadmapApi.undo(id), errorText)
  const easier = useRoadmapAction(() => roadmapApi.easier(), errorText)
  const unwatch = useRoadmapAction((id: string) => roadmapApi.unwatch(id), errorText)

  const r: Roadmap | undefined = q.data?.data
  const active = useMemo(() => (r?.goals ?? []).filter((g) => g.status === 'active'), [r])
  const goalTitle = useMemo(() => Object.fromEntries((r?.goals ?? []).map((g) => [g.id, g.title])), [r])
  const shownSteps = useMemo(() => {
    const goals = goalId === 'all' ? active : active.filter((g) => g.id === goalId)
    return goals.flatMap((g) => g.steps)
  }, [active, goalId])

  if (q.isLoading) return <div className="flex flex-col gap-4 pb-8"><div className="h-40 animate-pulse rounded-[1.75rem] bg-muted" /><ListSkeleton rows={4} /></div>
  if (q.isError || !r) {
    const offline = typeof navigator !== 'undefined' && !navigator.onLine
    return offline ? (
      <div className="rounded-[1.75rem] border bg-card"><EmptyState icon={<WifiOff />} title={t('roadmap.offlineTitle')} body={t('roadmap.offlineBody')} /></div>
    ) : <LoadError onRetry={() => void q.refetch()} />
  }

  if (!active.length)
    return (
      <div className="flex flex-col gap-6 pb-8">
        <div className="rounded-[1.75rem] border bg-card">
          <EmptyState
            icon={<Route />}
            title={t('roadmap.emptyTitle')}
            body={t('roadmap.emptyBody')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild className="h-12 rounded-full bg-cta px-6 text-base text-cta-foreground hover:bg-cta/90"><Link to={to.careers()}>{t('roadmap.pickCareer')}</Link></Button>
                <Button asChild variant="outline" className="h-12 rounded-full px-6 text-base"><Link to={to.saathi()} state={{ message: t('roadmap.askSaathiMsg') }}>{t('roadmap.askSaathi')}</Link></Button>
              </div>
            }
          />
        </div>
        <JoinClassCard />
      </div>
    )

  const byKey = (s: RoadmapStep) => [s.kind !== 'micro', s.due_date ?? '9999', s.position] as const
  const sortSteps = (xs: RoadmapStep[]) => [...xs].sort((a, b) => {
    const x = byKey(a), y = byKey(b)
    return x[0] === y[0] ? (x[1] === y[1] ? x[2] - y[2] : x[1] < y[1] ? -1 : 1) : x[0] ? 1 : -1
  })
  const done = shownSteps.filter((s) => s.bucket === 'done')
  const heroText = r.fresh_start || r.pace === 'inactive' ? t('roadmap.hero.welcome_back') : t(`roadmap.hero.${r.tone}`, { defaultValue: t(`roadmap.pace.${r.pace}`) })
  const changes = r.changes.filter((c) => !c.undone_at).slice(0, 6)

  return (
    <div className="flex flex-col gap-6 pb-10">
      {q.data?.mock && <p className="rounded-full bg-tile-peach px-4 py-1.5 text-center text-xs font-medium text-tile-foreground">{t('roadmap.sample')}</p>}

      {/* hero */}
      <motion.section
        initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="grid gap-4 rounded-[1.75rem] bg-linear-to-br from-hero to-hero-2 p-5 text-hero-foreground sm:grid-cols-[auto_1fr] sm:items-center sm:p-7"
      >
        <ProgressRing value={r.progress} size={88} stroke={8} className="text-lg [&_.text-muted]:text-white/25 [&_.text-primary]:text-white" label={t('roadmap.overall', { pct: r.progress })} />
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold sm:text-3xl">{t('roadmap.title')}</h1>
            <SpeakButton text={`${t('roadmap.title')}. ${heroText}`} className="text-hero-foreground" />
          </div>
          <p className="mt-1 text-base opacity-90">{heroText}</p>
          {r.next && (
            <p className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full bg-black/15 px-3 py-1.5 text-sm font-medium">
              <span className="shrink-0 opacity-80">{t('roadmap.nextUp')}</span><span className="truncate">{r.next.title}</span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={easier.isPending} onClick={() => easier.mutate(undefined)} className="h-10 rounded-full bg-cta px-4 text-cta-foreground hover:bg-cta/90">
              <Feather data-icon="inline-start" />{t('roadmap.easier')}
            </Button>
            <Button asChild size="sm" variant="outline" className="h-10 rounded-full border-white/40 bg-transparent px-4 text-hero-foreground hover:bg-white/10">
              <Link to={to.saathi()} state={{ message: t('roadmap.askSaathiMsg') }}><Sparkles data-icon="inline-start" />{t('roadmap.askSaathi')}</Link>
            </Button>
          </div>
        </div>
      </motion.section>

      {r.at_risk.length > 0 && (
        <section className="flex items-start gap-3 rounded-[1.75rem] border border-destructive/30 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-semibold">{t('roadmap.atRiskTitle', { count: r.at_risk.length })}</p>
            <ul className="mt-1 text-muted-foreground">{r.at_risk.slice(0, 3).map((a) => <li key={a.step_id}>{a.title} · <DaysText days={a.days_left} /></li>)}</ul>
          </div>
        </section>
      )}

      {/* goal switcher */}
      {active.length > 1 && (
        <div role="tablist" aria-label={t('roadmap.goals')} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {[{ id: 'all', title: t('roadmap.allGoals'), progress: r.progress } as Pick<Goal, 'id' | 'title' | 'progress'>, ...active].map((g) => (
            <button
              key={g.id} role="tab" aria-selected={goalId === g.id} onClick={() => setGoalId(g.id)}
              className={cn('flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium', goalId === g.id ? 'border-transparent bg-cta text-cta-foreground' : 'bg-card hover:bg-accent')}
            >
              <span className="max-w-40 truncate">{g.title}</span><span className="tabular-nums opacity-70">{g.progress}%</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* the chain */}
        <div className="flex flex-col gap-6">
          {GROUPS.map((b) => {
            const steps = sortSteps(shownSteps.filter((s) => s.bucket === b))
            if (!steps.length) return null
            return (
              <section key={b} className="flex flex-col gap-3">
                <Heading>{t(`roadmap.bucket.${b}`)}</Heading>
                <ol className="flex flex-col">
                  {steps.map((s, i) => (
                    <StepNode
                      key={s.id} step={s} last={i === steps.length - 1} busy={step.isPending}
                      goalTitle={goalId === 'all' && active.length > 1 ? goalTitle[s.goal_id] : undefined}
                      onStatus={(status) => step.mutate({ id: s.id, body: { status } })}
                      onSubtask={(id, d) => step.mutate({ id: s.id, body: { subtask: { id, done: d } } })}
                    />
                  ))}
                </ol>
              </section>
            )
          })}
          {done.length > 0 && (
            <section className="flex flex-col gap-3">
              <button type="button" onClick={() => setShowDone((v) => !v)} className="w-fit text-sm font-medium text-muted-foreground underline-offset-4 hover:underline">
                {showDone ? t('roadmap.hideDone') : t('roadmap.showDone', { count: done.length })}
              </button>
              {showDone && (
                <ol className="flex flex-col">
                  {done.map((s, i) => (
                    <StepNode key={s.id} step={s} last={i === done.length - 1} busy={step.isPending}
                      onStatus={(status) => step.mutate({ id: s.id, body: { status } })}
                      onSubtask={(id, d) => step.mutate({ id: s.id, body: { subtask: { id, done: d } } })} />
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>

        {/* side panels */}
        <aside className="flex flex-col gap-4">
          <section className="rounded-[1.75rem] border bg-card p-5">
            <div className="flex items-center gap-2"><History className="size-5 text-primary" /><Heading>{t('roadmap.changedTitle')}</Heading></div>
            {!r.ready && <p className="mt-2 text-sm text-muted-foreground">{t('roadmap.notReady')}</p>}
            {r.ready && !changes.length && <p className="mt-2 text-sm text-muted-foreground">{t('roadmap.noChanges')}</p>}
            <ul className="mt-3 flex flex-col gap-3">
              {changes.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <p className="flex-1">{t(`roadmap.reason.${c.reason_code}`, { defaultValue: c.reason, ...(c.params as Record<string, unknown>) })}</p>
                  {c.can_undo && (
                    <Button size="sm" variant="outline" disabled={undo.isPending} onClick={() => undo.mutate(c.id)} className="h-9 shrink-0 rounded-full px-3" aria-label={t('roadmap.undo')}>
                      <Undo2 data-icon="inline-start" />{t('roadmap.undo')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section id="alerts" className="rounded-[1.75rem] border bg-card p-5">
            <div className="flex items-center gap-2"><Bell className="size-5 text-primary" /><Heading>{t('roadmap.alertsTitle')}</Heading></div>
            {r.minor && <p className="mt-2 text-xs text-muted-foreground">{t('roadmap.minorAlerts')}</p>}
            {r.watches.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {r.watches.map((w) => (
                  <li key={w.id} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pr-1 pl-3 text-sm">
                    <span className="text-muted-foreground">{t(`roadmap.watch.${w.kind}`)}</span>
                    <span className="max-w-32 truncate font-medium">{w.label || w.ref}</span>
                    <button type="button" onClick={() => unwatch.mutate(w.id)} aria-label={t('roadmap.stopWatching', { name: w.label || w.ref })} className="grid size-7 place-items-center rounded-full hover:bg-background">
                      <BellOff className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!r.watches.length && !r.alerts.length && <p className="mt-2 text-sm text-muted-foreground">{t('roadmap.noAlerts')}</p>}
            <ul className="mt-3 flex flex-col gap-2">
              {r.alerts.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <Link to={a.link?.startsWith('/') ? a.link : to.plan()} className="block rounded-2xl bg-muted/60 p-3 text-sm hover:bg-accent">
                    <p className="font-medium">{a.title}</p>
                    {a.body && <p className="text-muted-foreground">{a.body}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <JoinClassCard />
        </aside>
      </div>
    </div>
  )
}
