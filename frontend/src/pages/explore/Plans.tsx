import { useQueryClient } from '@tanstack/react-query'
import { Bookmark, Map, Sparkles, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { ListSkeleton, LoadError, Note, Section, useMakePlan, useSaved, useToggleSave } from '@/components/explore/shared'
import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { careerBySlug, careerName } from '@/data/catalogue'
import { to } from '@/lib/links'

export function Plans() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useSaved()
  const unsave = useToggleSave()
  const make = useMakePlan()

  if (q.isLoading) return <><PageHeader title={t('nav.plan')} back /><ListSkeleton rows={4} /></>
  if (q.isError || !q.data) return <><PageHeader title={t('nav.plan')} back /><LoadError onRetry={() => void q.refetch()} /></>
  const { saved, plans } = q.data
  const nameOf = (slug: string, fallback?: string) => (careerBySlug[slug] ? careerName(careerBySlug[slug], i18n.language) : (fallback ?? slug))
  const planFor = (slug: string) => plans.find((p) => p.career_slug === slug && p.status === 'active')

  const makePlan = (slug: string) =>
    make.mutate({ career: slug }, { onSuccess: (plan) => { void qc.invalidateQueries({ queryKey: ['saved'] }); navigate(to.planItem(plan.id)) } })

  if (!saved.length && !plans.length)
    return (
      <>
        <PageHeader title={t('nav.plan')} subtitle={t('explore.plansSubtitle')} back />
        <div className="rounded-3xl border bg-card">
          <EmptyState
            icon={<Map />}
            title={t('explore.plansEmptyTitle')}
            body={t('explore.plansEmptyBody')}
            action={<Button asChild className="h-12 rounded-full px-6 text-base"><Link to={to.careers()}>{t('explore.browseCareers')}</Link></Button>}
          />
        </div>
      </>
    )

  return (
    <div className="flex flex-col gap-6 pb-8">
      <PageHeader title={t('nav.plan')} subtitle={t('explore.plansSubtitle')} back />

      <Section title={t('explore.myPlans')}>
        {!plans.length && <Note>{t('explore.noPlansYet')}</Note>}
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => {
            const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
            return (
              <Link key={p.id} to={to.planItem(p.id)} className="flex flex-col gap-3 rounded-3xl border bg-tile-mint p-5 text-tile-foreground">
                <span className="text-lg font-semibold">{nameOf(p.career_slug, p.title)}</span>
                <Progress value={pct} className="h-2 bg-black/10 dark:bg-white/15" />
                <span className="text-sm opacity-80">{t('explore.stepsDone', { done: p.done, total: p.total })}</span>
              </Link>
            )
          })}
        </div>
      </Section>

      <Section title={t('explore.savedCareers')}>
        {!saved.length && <Note>{t('explore.noSavedYet')}</Note>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {saved.map((slug) => {
            const plan = planFor(slug)
            return (
              <div key={slug} className="flex flex-col gap-3 rounded-3xl border bg-card p-4">
                <Link to={to.career(slug)} className="flex items-center gap-2 text-lg font-semibold underline-offset-4 hover:underline">
                  <Bookmark className="size-5 text-muted-foreground" />
                  {nameOf(slug)}
                </Link>
                <div className="flex flex-wrap gap-2">
                  {plan ? (
                    <Button asChild className="h-11 rounded-full px-5"><Link to={to.planItem(plan.id)}>{t('explore.viewPlan')}</Link></Button>
                  ) : (
                    <Button onClick={() => makePlan(slug)} disabled={make.isPending} className="h-11 rounded-full px-5"><Sparkles data-icon="inline-start" />{t('explore.makePlan')}</Button>
                  )}
                  <Button variant="outline" onClick={() => unsave.mutate({ career: slug, save: false })} aria-label={t('explore.unsave')} className="h-11 rounded-full px-4">
                    <Trash2 data-icon="inline-start" />{t('explore.unsave')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}
