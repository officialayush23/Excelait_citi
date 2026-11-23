import { AlertTriangle, ArrowRight, Route } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

import { DaysText, ProgressRing } from './parts'
import { useRoadmap } from './useRoadmap'

/** Compact roadmap for the student home: overall %, the one next step and how many fixed dates are close. */
export function RoadmapPreview({ className }: { className?: string }) {
  const { t } = useTranslation()
  const q = useRoadmap()
  if (q.isLoading) return <Skeleton className={cn('h-36 rounded-[1.75rem]', className)} />
  const r = q.data?.data
  if (q.isError || !r) return null
  const active = r.goals.filter((g) => g.status === 'active')
  if (!active.length)
    return (
      <Link to={to.plan()} className={cn('flex items-center gap-4 rounded-[1.75rem] border bg-card p-5 hover:bg-accent/40', className)}>
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary"><Route className="size-6" /></span>
        <span className="flex-1"><span className="block font-semibold">{t('roadmap.previewEmptyTitle')}</span><span className="text-sm text-muted-foreground">{t('roadmap.previewEmptyBody')}</span></span>
        <ArrowRight className="size-5 text-muted-foreground" />
      </Link>
    )
  return (
    <Link to={to.plan()} className={cn('group flex flex-col gap-3 rounded-[1.75rem] bg-linear-to-br from-hero to-hero-2 p-5 text-hero-foreground', className)}>
      <div className="flex items-center gap-4">
        <ProgressRing value={r.progress} size={56} className="text-hero-foreground [&_.text-muted]:text-white/25 [&_.text-primary]:text-white" label={t('roadmap.overall', { pct: r.progress })} />
        <div className="min-w-0 flex-1">
          <p className="text-sm opacity-85">{t('roadmap.title')}</p>
          <p className="truncate text-lg font-semibold">{r.next ? r.next.title : t('roadmap.nothingNow')}</p>
          {r.next?.due_date && <p className="text-sm opacity-85"><DaysText days={r.next.days_left} /></p>}
        </div>
        <ArrowRight className="size-5 shrink-0 opacity-80 transition-transform group-hover:translate-x-0.5" />
      </div>
      {r.at_risk.length > 0 && (
        <p className="flex items-center gap-2 rounded-full bg-black/15 px-3 py-1.5 text-sm font-medium">
          <AlertTriangle className="size-4" />{t('roadmap.atRiskCount', { count: r.at_risk.length })}
        </p>
      )}
    </Link>
  )
}
