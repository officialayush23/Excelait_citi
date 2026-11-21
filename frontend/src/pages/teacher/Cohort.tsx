import { Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { ErrorNote } from '@/components/partner/shared'
import { AttentionList } from '@/components/teacher/Attention'
import { CreateClassDialog, JoinCodeCard, RenameClassButton } from '@/components/teacher/ClassBits'
import { ClassKpis } from '@/components/teacher/ClassKpis'
import { ClassPicker } from '@/components/teacher/shared'
import { useDashboard, useSelectedClass } from '@/components/teacher/teacherApi'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function Cohort() {
  const { t } = useTranslation()
  const { classes, selected, select, isLoading, error, refetch } = useSelectedClass()
  const dash = useDashboard(selected?.id)
  const [creating, setCreating] = useState(false)

  const create = (
    <Button className="rounded-full" onClick={() => setCreating(true)}>
      <Plus data-icon="inline-start" />
      {t('teacher.createClass')}
    </Button>
  )
  const dialog = <CreateClassDialog open={creating} onOpenChange={setCreating} onCreated={(c) => select(c.id)} />

  if (isLoading) return <><PageHeader title={t('nav.cohort')} /><Skeleton className="h-40 rounded-2xl" /></>
  if (error) return <><PageHeader title={t('nav.cohort')} /><ErrorNote error={error} onRetry={() => void refetch()} /></>

  if (!selected) {
    return (
      <>
        <PageHeader title={t('nav.cohort')} subtitle={t('teacher.lead')} />
        <EmptyState icon={<Users />} title={t('teacher.noClassTitle')} body={t('teacher.noClassBody')} action={create} />
        {dialog}
      </>
    )
  }

  const d = dash.data
  return (
    <>
      <PageHeader title={selected.name} subtitle={selected.school_name ?? t('teacher.lead')} actions={<><RenameClassButton cls={selected} />{create}</>} />
      <ClassPicker classes={classes} value={selected.id} onChange={select} />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-6">
          {dash.isError ? (
            <ErrorNote error={dash.error} onRetry={() => void dash.refetch()} />
          ) : d ? (
            <ClassKpis totals={d.totals} />
          ) : (
            <Skeleton className="h-36 rounded-2xl" />
          )}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold">{t('teacher.needsAttention')}</h2>
              <Button asChild variant="ghost" className="rounded-full">
                <Link to="/app/students">{t('teacher.allStudents')}</Link>
              </Button>
            </div>
            {d ? (
              d.totals.students === 0 ? (
                <p className="rounded-2xl border bg-card p-5 text-muted-foreground">{t('teacher.emptyClass')}</p>
              ) : (
                <AttentionList items={d.attention} />
              )
            ) : (
              <Skeleton className="h-32 rounded-2xl" />
            )}
            {d && d.attention.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('teacher.rulesNote', { inactive: d.rules.inactive_days, profile: d.rules.profile_days, claim: d.rules.claim_days })}
              </p>
            )}
          </section>
        </div>
        <aside>
          <JoinCodeCard code={selected.join_code} />
          <p className="mt-3 text-sm text-muted-foreground">{t('teacher.codeHelp')}</p>
        </aside>
      </div>
      {dialog}
    </>
  )
}
