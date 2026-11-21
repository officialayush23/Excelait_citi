import { CircleCheck, Circle, CircleAlert, Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page/PageHeader'
import { ErrorNote } from '@/components/partner/shared'
import { SchemeClaimRow } from '@/components/teacher/ClaimControls'
import { formatActive, riskText } from '@/components/teacher/shared'
import { useRecommend, useStudentDetail } from '@/components/teacher/teacherApi'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatInr } from '@/lib/format'
import { cn } from '@/lib/utils'

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border bg-card p-5', className)}>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

export function StudentDetail() {
  const { t } = useTranslation()
  const { id } = useParams()
  const q = useStudentDetail(id)

  if (q.isLoading) return <><PageHeader title={t('nav.students')} back /><Skeleton className="h-64 rounded-2xl" /></>
  if (q.isError || !q.data) return <><PageHeader title={t('nav.students')} back /><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></>
  const d = q.data
  const s = d.student
  const f = d.facts
  const fact = (k: string, v: unknown) => (v === undefined || v === null ? null : [t(`teacher.fact.${k}`), Array.isArray(v) ? v.join(', ') : k === 'family_income_annual' ? formatInr(Number(v)) : String(v)])
  const facts = ['class_level', 'course', 'school_type', 'state', 'gender', 'marks_percent', 'family_income_annual', 'social_category', 'interests']
    .map((k) => fact(k, f[k]))
    .filter((x): x is string[] => !!x)

  return (
    <>
      <PageHeader title={s.name} subtitle={`${d.classes.map((c) => c.name).join(', ')} · ${t('teacher.lastActive')}: ${formatActive(t, s.days_inactive)}`} back />

      {s.risks.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {s.risks.map((r) => (
            <li key={r.code} className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0" />{riskText(t, r)}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('teacher.detail.profile')}>
          <p className="mb-3 text-sm text-muted-foreground">{t('teacher.detail.profilePct', { pct: s.profile_pct })}</p>
          {facts.length ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium capitalize">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground">{t('teacher.detail.noFacts')}</p>
          )}
          {d.missing_facts.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">{t('teacher.detail.missing', { list: d.missing_facts.map((m) => t(`teacher.fact.${m}`)).join(', ') })}</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{t('teacher.detail.privacy')}</p>
        </Card>

        <Card title={t('teacher.detail.careers')}>
          {d.careers.length ? (
            <ul className="flex flex-wrap gap-2">
              {d.careers.map((c, i) => (
                <li key={c.slug} className={cn('rounded-full px-3 py-1 text-sm', i === 0 ? 'bg-highlight text-highlight-foreground' : 'bg-muted')}>{c.name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t('teacher.noCareer')}</p>
          )}
        </Card>

        <Card title={t('teacher.detail.plan')}>
          {d.plans.length === 0 && <p className="text-muted-foreground">{t('teacher.detail.noPlan')}</p>}
          {d.plans.map((p) => (
            <div key={p.id} className="mb-3 last:mb-0">
              <p className="font-medium">{p.title}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {p.steps.map((st) => (
                  <li key={st.id} className="flex items-start gap-2 text-sm">
                    {st.done_at ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Circle className={cn('mt-0.5 size-4 shrink-0', st.overdue ? 'text-destructive' : 'text-muted-foreground')} />}
                    <span className={cn(st.done_at && 'text-muted-foreground line-through')}>{st.title}</span>
                    {st.due_date && !st.done_at && (
                      <span className={cn('ml-auto shrink-0 text-xs', st.overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                        {st.overdue ? t('teacher.overdue') : t('teacher.due')} {dateFmt(st.due_date)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>

        <Card title={t('teacher.detail.applications')}>
          {d.applications.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {d.applications.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>{a.title}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{a.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t('teacher.detail.noApps')}</p>
          )}
        </Card>

        <Card title={t('teacher.detail.money')} className="lg:col-span-2">
          <p className="mb-3 text-sm text-muted-foreground">
            {t('teacher.detail.moneySummary', { eligible: formatInr(s.eligible_inr), claimed: formatInr(s.claimed_inr) })}
          </p>
          {d.schemes.length ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {d.schemes.map((sc) => (
                <SchemeClaimRow key={sc.id} studentId={s.id} scheme={sc} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t('teacher.detail.noSchemes')}</p>
          )}
          {d.needs_info.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">{t('teacher.detail.needsInfo', { count: d.needs_info.length })}</p>
          )}
        </Card>

        <RecommendCard studentId={s.id} recs={d.recommendations} />
      </div>
    </>
  )
}

function RecommendCard({ studentId, recs }: { studentId: string; recs: { id: string; title: string | null; note: string | null; created_at: string }[] }) {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  const rec = useRecommend(studentId)
  return (
    <Card title={t('teacher.detail.recommend')} className="lg:col-span-2">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          rec.mutate(
            { note },
            {
              onSuccess: () => {
                setNote('')
                toast.success(t('teacher.detail.recSent'))
              },
              onError: (err) => toast.error(err instanceof Error ? err.message : t('teacher.error')),
            },
          )
        }}
      >
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} rows={3} placeholder={t('teacher.detail.recPlaceholder')} aria-label={t('teacher.detail.recommend')} />
        <div>
          <Button type="submit" className="rounded-full" disabled={note.trim().length < 3 || rec.isPending}>
            <Send data-icon="inline-start" />
            {t('teacher.detail.recSend')}
          </Button>
        </div>
      </form>
      {recs.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 border-t pt-3 text-sm">
          {recs.map((r) => (
            <li key={r.id}>
              <span className="text-muted-foreground">{dateFmt(r.created_at)} · </span>
              {r.title && <strong>{r.title}: </strong>}
              {r.note}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
