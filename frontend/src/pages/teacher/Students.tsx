import { Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { ErrorNote } from '@/components/partner/shared'
import { Bar, ClaimBadge, ClassPicker, formatActive, RiskChips } from '@/components/teacher/shared'
import { useDashboard, useSelectedClass, type StudentRow } from '@/components/teacher/teacherApi'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatInr } from '@/lib/format'
import { cn } from '@/lib/utils'

export function Students() {
  const { t } = useTranslation()
  const { classes, selected, select, isLoading } = useSelectedClass()
  const dash = useDashboard(selected?.id)
  const [q, setQ] = useState('')
  const [onlyRisk, setOnlyRisk] = useState(false)

  const rows = useMemo(() => {
    const all = dash.data?.students ?? []
    const needle = q.trim().toLowerCase()
    return all.filter((s) => (!needle || s.name.toLowerCase().includes(needle)) && (!onlyRisk || s.risks.length > 0))
  }, [dash.data, q, onlyRisk])

  if (isLoading || (selected && dash.isLoading)) return <><PageHeader title={t('nav.students')} /><Skeleton className="h-64 rounded-2xl" /></>
  if (!selected) return <><PageHeader title={t('nav.students')} /><EmptyState icon={<Users />} title={t('teacher.noClassTitle')} body={t('teacher.noClassBody')} /></>
  if (dash.isError) return <><PageHeader title={t('nav.students')} /><ErrorNote error={dash.error} onRetry={() => void dash.refetch()} /></>

  return (
    <>
      <PageHeader title={t('nav.students')} subtitle={selected.name} />
      <ClassPicker classes={classes} value={selected.id} onChange={select} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('teacher.search')} aria-label={t('teacher.search')} className="h-11 rounded-full pl-10" />
        </div>
        <button
          type="button"
          aria-pressed={onlyRisk}
          onClick={() => setOnlyRisk((v) => !v)}
          className={cn('rounded-full border px-4 py-2 text-sm font-medium', onlyRisk ? 'border-transparent bg-highlight text-highlight-foreground' : 'bg-card')}
        >
          {t('teacher.onlyAtRisk')}
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Users />} title={dash.data?.students.length ? t('teacher.noMatch') : t('teacher.emptyClass')} body={dash.data?.students.length ? t('teacher.noMatchBody') : t('teacher.codeHelp')} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border bg-card md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {['student', 'profile', 'career', 'eligible', 'claim', 'plan', 'active', 'risk'].map((c) => (
                    <th key={c} className="px-4 py-3 font-medium">{t(`teacher.col.${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/app/students/${s.id}`} className="hover:underline">{s.name}</Link>
                      {s.class_level && <span className="ml-2 text-xs text-muted-foreground">{t('teacher.classN', { n: s.class_level })}</span>}
                    </td>
                    <td className="w-32 px-4 py-3"><ProfileCell s={s} /></td>
                    <td className="px-4 py-3">{s.top_career?.name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatInr(s.eligible_inr)}</td>
                    <td className="px-4 py-3"><ClaimBadge status={s.claim_status} /></td>
                    <td className="w-32 px-4 py-3"><PlanCell s={s} /></td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatActive(t, s.days_inactive)}</td>
                    <td className="px-4 py-3"><RiskChips risks={s.risks} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((s) => (
              <li key={s.id}>
                <Link to={`/app/students/${s.id}`} className="block rounded-2xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold">{s.name}</p>
                    <ClaimBadge status={s.claim_status} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {s.top_career?.name ?? t('teacher.noCareer')} · {formatInr(s.eligible_inr)} · {formatActive(t, s.days_inactive)}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <div>{t('teacher.col.profile')} <ProfileCell s={s} /></div>
                    <div>{t('teacher.col.plan')} <PlanCell s={s} /></div>
                  </div>
                  <RiskChips risks={s.risks} className="mt-3" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function ProfileCell({ s }: { s: StudentRow }) {
  return (
    <div className="flex items-center gap-2 text-foreground">
      <Bar value={s.profile_pct} />
      <span className="w-9 text-xs tabular-nums text-muted-foreground">{s.profile_pct}%</span>
    </div>
  )
}

function PlanCell({ s }: { s: StudentRow }) {
  if (!s.plan.steps_total) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex items-center gap-2 text-foreground">
      <Bar value={s.plan.pct} className={s.plan.overdue ? 'text-destructive' : undefined} />
      <span className="w-9 text-xs tabular-nums text-muted-foreground">{s.plan.pct}%</span>
    </div>
  )
}
