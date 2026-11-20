import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, MapPin, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import {
  CareerChips, CollegeList, CommunityBlock, ExamRow, ListSkeleton, LoadError, Note, PageSkeleton, PillTabs, ProgramCard, ResourceGrid, SaveButton, SchemeRow, Section,
  useCareer, useCareerOffers, useMakePlan, useSaved, loc, type Career,
} from '@/components/explore/shared'
import { PageHeader } from '@/components/page/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useFacts } from '@/data/facts'
import { payRange } from '@/lib/format'
import { to } from '@/lib/links'

const TABS = ['path', 'courses', 'exams', 'colleges', 'money', 'learn', 'community', 'opportunities'] as const
type Tab = (typeof TABS)[number]

export function CareerPage() {
  const { slug } = useParams()
  const { t, i18n } = useTranslation()
  const q = useCareer(slug)
  const [params, setParams] = useSearchParams()
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'path') as Tab

  if (q.isLoading) return <><PageHeader title={t('explore.loading')} back /><PageSkeleton /></>
  if (q.isError || !q.data) return <><PageHeader title={t('nav.careers')} back /><LoadError notFound={(q.error as { status?: number } | null)?.status === 404} onRetry={() => void q.refetch()} /></>
  const c = q.data
  const name = loc(c.name_i18n, i18n.language, c.name)
  const pay = payRange(c.pay_min, c.pay_max)

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PageHeader title={name} back />
      <Hero c={c} pay={pay} />
      <PillTabs
        tabs={TABS.map((id) => ({ id, label: t(`explore.tab.${id}`) }))}
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
      />
      <div className="flex flex-col gap-4">
        {tab === 'path' && <PathTab c={c} />}
        {tab === 'courses' && <CoursesTab c={c} />}
        {tab === 'exams' && <ExamsTab c={c} />}
        {tab === 'colleges' && <CollegesTab c={c} />}
        {tab === 'money' && <MoneyTab c={c} />}
        {tab === 'learn' && <LearnTab c={c} />}
        {tab === 'community' && <Section><CommunityBlock career={c.slug} /></Section>}
        {tab === 'opportunities' && <OpportunitiesTab slug={c.slug} />}
      </div>
      {c.related.length > 0 && (
        <Section title={t('explore.relatedCareers')}>
          <CareerChips items={c.related} />
        </Section>
      )}
    </div>
  )
}

function Hero({ c, pay }: { c: Career; pay: string | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const saved = useSaved()
  const make = useMakePlan()
  const existing = saved.data?.plans.find((p) => p.career_slug === c.slug && p.status === 'active')
  const go = () => {
    if (existing) return navigate(to.planItem(existing.id))
    make.mutate({ career: c.slug }, { onSuccess: (plan) => { void qc.invalidateQueries({ queryKey: ['saved'] }); navigate(to.planItem(plan.id)) } })
  }
  return (
    <section className="rounded-3xl border bg-tile-lilac p-5 text-tile-foreground sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t(`categories.${c.category}`, { defaultValue: c.category })}</Badge>
        {c.nsqf_level && <Badge variant="outline">NSQF {c.nsqf_level}</Badge>}
        <Badge variant="outline">{t(`speed.${c.earning_speed}`)}</Badge>
        <Badge variant="outline">{t(`explore.entry.${c.min_education}`, { defaultValue: c.min_education })}</Badge>
      </div>
      {pay && (
        <p className="mt-3 text-xl font-semibold">
          {t('careers.pay', { range: pay })}{' '}
          {c.needs_city && <span className="inline-flex items-center gap-1 text-sm font-normal"><MapPin className="size-4" />{t('careers.city')}</span>}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={go} disabled={make.isPending} className="h-12 rounded-full px-6 text-base">
          <Sparkles data-icon="inline-start" />
          {existing ? t('explore.viewPlan') : t('explore.makePlan')}
        </Button>
        <SaveButton career={c.slug} className="h-12 bg-card text-card-foreground" />
      </div>
    </section>
  )
}

function PathTab({ c }: { c: Career }) {
  const { t, i18n } = useTranslation()
  return (
    <>
      <Section title={t('explore.yourRoute')}>
        <ol className="relative flex flex-col gap-4 border-l-2 border-dashed pl-6">
          {c.path.map((p, i) => {
            const prog = c.programs.find((x) => p.toLowerCase().includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(p.toLowerCase().split(' (')[0]))
            return (
              <li key={i} className="relative rounded-2xl border bg-card px-4 py-3">
                <span className="absolute top-3 -left-[2.2rem] grid size-6 place-items-center rounded-full bg-highlight text-xs font-bold text-highlight-foreground">{i + 1}</span>
                {prog ? <Link to={to.course(prog.slug)} className="font-medium underline underline-offset-4">{p}</Link> : p}
                {prog && <span className="ml-2 text-sm text-muted-foreground">{loc(prog.name_i18n, i18n.language, prog.name)}</span>}
              </li>
            )
          })}
        </ol>
      </Section>
      {c.programs.length > 0 && (
        <Section title={t('explore.coursesOnRoute')}>
          <div className="flex flex-col gap-3">
            {c.programs.map((p) => <ProgramCard key={p.slug} p={p} />)}
          </div>
        </Section>
      )}
    </>
  )
}

function CoursesTab({ c }: { c: Career }) {
  const { t } = useTranslation()
  if (!c.programs.length) return <Note>{t('explore.noCourses')}</Note>
  return <div className="flex flex-col gap-3">{c.programs.map((p) => <ProgramCard key={p.slug} p={p} />)}</div>
}

function ExamsTab({ c }: { c: Career }) {
  const { t } = useTranslation()
  if (!c.exams.length) return <Note>{t('explore.noExamsCareer')}</Note>
  return <div className="flex flex-col gap-2">{c.exams.map((e) => <ExamRow key={e.slug} e={e} />)}</div>
}

function CollegesTab({ c }: { c: Career }) {
  const { t } = useTranslation()
  const facts = useFacts((s) => s.facts)
  const state = typeof facts.state === 'string' && facts.state !== 'Other' ? facts.state : undefined
  const kinds = useMemo(() => [...new Set(c.programs.map((p) => p.college_kind).filter((k) => k && !['none', 'employer'].includes(k)))], [c.programs])
  if (!kinds.length) return <Note>{t('explore.noCollegeNeeded')}</Note>
  return (
    <div className="flex flex-col gap-5">
      {state && <Note>{t('explore.showingIn', { state })}</Note>}
      {kinds.map((k) => (
        <Section key={k} title={t(`explore.kind.${k}`, { defaultValue: k })}>
          <CollegeList kind={k} state={state} />
        </Section>
      ))}
    </div>
  )
}

function MoneyTab({ c }: { c: Career }) {
  const { t } = useTranslation()
  if (!c.schemes.length) return <Note>{t('explore.noMoney')}</Note>
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{t('explore.moneyHint')}</p>
      {c.schemes.map((s) => <SchemeRow key={s.slug} s={s} />)}
    </div>
  )
}

function LearnTab({ c }: { c: Career }) {
  const { t } = useTranslation()
  return (
    <>
      {c.resources.length ? <ResourceGrid items={c.resources} /> : <Note>{t('explore.noResources')}</Note>}
      <Button asChild variant="outline" className="h-11 w-fit rounded-full px-5"><Link to={to.learn({ career: c.slug })}>{t('explore.moreLearning')}</Link></Button>
    </>
  )
}

function OpportunitiesTab({ slug }: { slug: string }) {
  const { t } = useTranslation()
  const q = useCareerOffers(slug)
  if (q.isLoading) return <ListSkeleton />
  if (q.isError) return <Note tone="warn">{t('explore.errorBody')}</Note>
  const offers = q.data?.offers ?? []
  return (
    <div className="flex flex-col gap-2">
      {!offers.length && <Note>{t('explore.noOffers')}</Note>}
      {offers.map((o) => (
        <Link key={o.id} to={to.opportunities(o.id)} className="flex min-h-14 flex-col gap-1 rounded-2xl border bg-card px-4 py-3 hover:bg-accent">
          <span className="flex items-start justify-between gap-2">
            <span className="font-medium">{o.title}</span>
            <ExternalLink className="mt-1 size-4 shrink-0 text-muted-foreground" />
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {o.org_name && <span>{o.org_name}</span>}
            <Badge variant="secondary">{t(`kinds.${o.kind}`, { defaultValue: o.kind })}</Badge>
            {o.is_remote && <Badge variant="outline">{t('explore.remote')}</Badge>}
            {o.deadline && <span>{t('explore.lastDate', { date: o.deadline })}</span>}
          </span>
        </Link>
      ))}
      <Button asChild variant="outline" className="h-11 w-fit rounded-full px-5"><Link to={to.opportunities()}>{t('explore.allOpportunities')}</Link></Button>
    </div>
  )
}
