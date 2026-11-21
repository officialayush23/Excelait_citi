import { BookOpen, ChevronRight, FileUp } from 'lucide-react'
import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { ListSkeleton, Note, ResourceGrid, Section, useResources, useSaved, type Resource } from '@/components/explore/shared'
import { EmptyState } from '@/components/page/EmptyState'
import { FilterBar } from '@/components/page/FilterBar'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { to } from '@/lib/links'

export function Learn() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const filters = (['career', 'course', 'exam'] as const).filter((k) => params.get(k))
  const career = params.get('career') ?? undefined
  const course = params.get('course') ?? undefined
  const exam = params.get('exam') ?? undefined
  const res = useResources({ career, program: course, exam })
  const saved = useSaved()
  const mine = (saved.data?.saved ?? []).slice(0, 4)
  const mineQs = useQueries({
    queries: mine.map((slug) => ({ queryKey: ['resources', `career=${slug}`], queryFn: () => api<{ resources: Resource[] }>(`/api/v1/explore/resources?career=${slug}`) })),
  })
  const mineItems = [...new Map(mineQs.flatMap((q) => q.data?.resources ?? []).map((r) => [r.slug, r])).values()]

  const chips = filters.map((k) => ({ id: k, label: `${t(`explore.filter.${k}`)}: ${params.get(k)}` }))
  const clear = (id?: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (id) n.delete(id)
      else ['career', 'course', 'exam'].forEach((k) => n.delete(k))
      return n
    }, { replace: true })
  const target = career ? to.career(career) : course ? to.course(course) : exam ? to.exam(exam) : null

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PageHeader title={t('nav.learn')} subtitle={t('explore.learnSubtitle')} back />
      <Link to="/app/lessons" className="flex min-h-20 items-center gap-4 rounded-3xl border bg-highlight p-4 text-highlight-foreground hover:opacity-95">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-background text-foreground"><FileUp className="size-6" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold">{t('learn.entryTitle')}</span>
          <span className="block text-sm opacity-80">{t('learn.entryBody')}</span>
        </span>
        <ChevronRight className="size-5 shrink-0" />
      </Link>
      {chips.length > 0 && <FilterBar chips={chips} active={chips.map((c) => c.id)} onToggle={(id) => clear(id)} onClear={() => clear()} className="mb-0" />}
      {target && (
        <Button asChild variant="outline" className="h-11 w-fit rounded-full px-5"><Link to={target}>{t('explore.backToPage')}</Link></Button>
      )}

      {!chips.length && mineItems.length > 0 && (
        <Section title={t('explore.forSaved')} hint={t('explore.forSavedHint')}><ResourceGrid items={mineItems} /></Section>
      )}

      <Section title={chips.length ? t('explore.matching') : t('explore.allResources')}>
        {res.isLoading && <ListSkeleton rows={4} />}
        {res.isError && <Note tone="warn">{t('explore.errorBody')}</Note>}
        {res.data && res.data.resources.length === 0 && (
          <div className="rounded-3xl border bg-card">
            <EmptyState icon={<BookOpen />} title={t('explore.noResourcesTitle')} body={t('explore.noResourcesBody')} />
          </div>
        )}
        {res.data && res.data.resources.length > 0 && <ResourceGrid items={res.data.resources} />}
      </Section>
    </div>
  )
}
