import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { AttentionList } from './Attention'
import { ClassKpis } from './ClassKpis'
import { JoinCodeCard } from './ClassBits'
import { ClassPicker } from './shared'
import { useDashboard, useSelectedClass } from './teacherApi'

/** Facilitator home: class summary, who needs attention, and the join code. */
export function TeacherHome({ roleName }: { roleName: string }) {
  const { t } = useTranslation()
  const { classes, selected, select, isLoading } = useSelectedClass()
  const dash = useDashboard(selected?.id)

  if (isLoading) return <><PageHeader title={roleName} /><Skeleton className="h-40 rounded-2xl" /></>
  if (!selected) {
    return (
      <>
        <PageHeader title={roleName} subtitle={t('teacher.lead')} />
        <EmptyState
          icon={<Users />}
          title={t('teacher.noClassTitle')}
          body={t('teacher.noClassBody')}
          action={<Button asChild className="rounded-full"><Link to="/app/cohort">{t('teacher.createClass')}</Link></Button>}
        />
      </>
    )
  }
  const d = dash.data
  return (
    <>
      <PageHeader title={roleName} subtitle={selected.name} actions={<Button asChild variant="outline" className="rounded-full"><Link to="/app/cohort">{t('teacher.manageClass')}</Link></Button>} />
      <ClassPicker classes={classes} value={selected.id} onChange={select} />
      {d ? <ClassKpis totals={d.totals} /> : <Skeleton className="h-36 rounded-2xl" />}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('teacher.needsAttention')}</h2>
          {d ? <AttentionList items={d.attention} limit={5} /> : <Skeleton className="h-32 rounded-2xl" />}
        </section>
        <JoinCodeCard code={selected.join_code} className="self-start" />
      </div>
    </>
  )
}
