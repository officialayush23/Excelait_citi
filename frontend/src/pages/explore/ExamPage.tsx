import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { CareerChips, CommunityBlock, LoadError, MonthStrip, Note, PageSkeleton, ResourceGrid, Section, nextLabel, useExam } from '@/components/explore/shared'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { to } from '@/lib/links'

export function ExamPage() {
  const { slug } = useParams()
  const { t, i18n } = useTranslation()
  const q = useExam(slug)

  if (q.isLoading) return <><PageHeader title={t('explore.loading')} back /><PageSkeleton /></>
  if (q.isError || !q.data) return <><PageHeader title={t('explore.exam')} back /><LoadError notFound={(q.error as { status?: number } | null)?.status === 404} onRetry={() => void q.refetch()} /></>
  const e = q.data
  const next = nextLabel(e.next, i18n.language)

  return (
    <div className="flex flex-col gap-6 pb-8">
      <PageHeader title={e.name} subtitle={e.conducting_body} back />
      <section className="rounded-3xl border bg-tile-peach p-5 text-tile-foreground sm:p-6">
        {next && <p className="text-xl font-semibold">{t('explore.usuallyAround', { month: next })}</p>}
        <p className="mt-1 text-sm opacity-80">{t('explore.typicalNote')}</p>
        <Button asChild className="mt-4 h-12 rounded-full px-6 text-base">
          <a href={e.official_url} target="_blank" rel="noreferrer">{t('explore.officialSite')}<ExternalLink data-icon="inline-end" /></a>
        </Button>
      </section>
      <Section title={t('explore.whenHeld')}><MonthStrip months={e.typical_months} next={e.next} /></Section>
      <Section title={t('explore.whoCanTake')}><p className="rounded-2xl border bg-card px-4 py-3">{e.eligibility}</p></Section>
      {e.programs.length > 0 && (
        <Section title={t('explore.coursesUsingExam')}>
          <div className="flex flex-wrap gap-2">
            {e.programs.map((p) => (
              <Link key={p.slug} to={to.course(p.slug)} className="inline-flex h-11 items-center rounded-full border bg-card px-4 text-sm font-medium hover:bg-accent">{p.name}</Link>
            ))}
          </div>
        </Section>
      )}
      {e.careers.length > 0 && <Section title={t('explore.careersUsingExam')}><CareerChips items={e.careers} /></Section>}
      <Section title={t('explore.tab.learn')}>
        {e.resources.length ? <ResourceGrid items={e.resources} /> : <Note>{t('explore.noResources')}</Note>}
        <Button asChild variant="outline" className="h-11 w-fit rounded-full px-5"><Link to={to.learn({ exam: e.slug })}>{t('explore.moreLearning')}</Link></Button>
      </Section>
      <Section title={t('explore.tab.community')}><CommunityBlock exam={e.slug} /></Section>
    </div>
  )
}
