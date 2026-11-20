import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import {
  CareerChips, CollegeList, ExamRow, LoadError, Note, PageSkeleton, ResourceGrid, SchemeRow, Section, VerifyNotes, useProgram, loc,
} from '@/components/explore/shared'
import { PageHeader } from '@/components/page/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useFacts } from '@/data/facts'
import { to } from '@/lib/links'

export function CoursePage() {
  const { slug } = useParams()
  const { t, i18n } = useTranslation()
  const q = useProgram(slug)
  const facts = useFacts((s) => s.facts)
  const state = typeof facts.state === 'string' && facts.state !== 'Other' ? facts.state : undefined

  if (q.isLoading) return <><PageHeader title={t('explore.loading')} back /><PageSkeleton /></>
  if (q.isError || !q.data) return <><PageHeader title={t('explore.course')} back /><LoadError notFound={(q.error as { status?: number } | null)?.status === 404} onRetry={() => void q.refetch()} /></>
  const p = q.data
  const needsCollege = p.college_kind && !['none', 'employer'].includes(p.college_kind)
  const dur = p.duration_months ? (p.duration_months >= 12 ? t('explore.years', { count: +(p.duration_months / 12).toFixed(1) }) : t('explore.monthsN', { count: p.duration_months })) : null

  return (
    <div className="flex flex-col gap-6 pb-8">
      <PageHeader title={loc(p.name_i18n, i18n.language, p.name)} back />
      <section className="rounded-3xl border bg-tile-sky p-5 text-tile-foreground sm:p-6">
        <div className="flex flex-wrap gap-2">
          {dur && <Badge variant="secondary">{dur}</Badge>}
          <Badge variant="outline">{t('explore.entryNeeded', { level: t(`explore.entry.${p.entry}`, { defaultValue: p.entry }) })}</Badge>
          <Badge variant="outline">{t(`explore.level.${p.level}`, { defaultValue: p.level })}</Badge>
        </div>
        <p className="mt-3 text-lg">{p.where}</p>
        {p.official_url && (
          <Button asChild className="mt-4 h-12 rounded-full px-6 text-base">
            <a href={p.official_url} target="_blank" rel="noreferrer">{t('explore.officialSite')}<ExternalLink data-icon="inline-end" /></a>
          </Button>
        )}
      </section>
      <VerifyNotes notes={p.verify} />
      {p.careers.length > 0 && <Section title={t('explore.leadsTo')}><CareerChips items={p.careers} /></Section>}
      <Section title={t('explore.examsNeeded')}>
        {p.exams.length ? <div className="flex flex-col gap-2">{p.exams.map((e) => <ExamRow key={e.slug} e={e} />)}</div> : <Note>{t('explore.noExamsCourse')}</Note>}
      </Section>
      <Section title={t('explore.moneyForThis')} hint={p.schemes.length ? t('explore.moneyHint') : undefined}>
        {p.schemes.length ? <div className="flex flex-col gap-2">{p.schemes.map((s) => <SchemeRow key={s.slug} s={s} />)}</div> : <Note>{t('explore.noMoney')}</Note>}
      </Section>
      {needsCollege && (
        <Section title={t('explore.collegesFor', { kind: t(`explore.kind.${p.college_kind}`, { defaultValue: p.college_kind }) })}>
          <CollegeList kind={p.college_kind} state={state} />
        </Section>
      )}
      <Section title={t('explore.tab.learn')}>
        {p.resources.length ? <ResourceGrid items={p.resources} /> : <Note>{t('explore.noResources')}</Note>}
        <Button asChild variant="outline" className="h-11 w-fit rounded-full px-5"><Link to={to.learn({ course: p.slug })}>{t('explore.moreLearning')}</Link></Button>
      </Section>
    </div>
  )
}
