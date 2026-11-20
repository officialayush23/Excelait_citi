import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'

import { CollegeList, LoadError, Note, PageSkeleton, Section, type College } from '@/components/explore/shared'
import { PageHeader } from '@/components/page/PageHeader'
import { Badge } from '@/components/ui/badge'
import { api, ApiError } from '@/lib/api'
import { to } from '@/lib/links'

const DETAIL_KEYS = ['courses', 'fees', 'seats', 'hostel', 'contact'] as const

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'boolean') return v ? '✓' : '—'
  if (Array.isArray(v)) return v.map(show).filter(Boolean).join(', ')
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${show(x)}`).join(' · ')
  return String(v)
}

export function CollegePage() {
  const { code } = useParams()
  const { t } = useTranslation()
  const q = useQuery({ queryKey: ['college', code], queryFn: () => api<College>(`/api/v1/explore/colleges/${code}`), enabled: !!code, retry: false })

  if (q.isLoading) return <><PageHeader title={t('explore.loading')} back /><PageSkeleton /></>
  if (q.isError || !q.data) return <><PageHeader title={t('nav.colleges')} back /><LoadError notFound={(q.error as ApiError | null)?.status === 404} onRetry={() => void q.refetch()} /></>
  const c = q.data
  const d = c.details ?? {}
  const extra = Object.keys(d).filter((k) => !(DETAIL_KEYS as readonly string[]).includes(k) && show(d[k]))
  const rows: [string, string | null][] = [
    [t('explore.state'), c.state], [t('explore.district'), c.district], [t('explore.area'), c.location], [t('explore.management'), c.management],
    [t('explore.collegeKind'), c.college_type], [t('explore.university'), c.university],
  ]

  return (
    <div className="flex flex-col gap-6 pb-8">
      <PageHeader title={c.name} back />
      <section className="rounded-3xl border bg-tile-mint p-5 text-tile-foreground sm:p-6">
        <div className="flex flex-wrap gap-2">
          {c.org_id && <Badge><ShieldCheck />{t('explore.verified')}</Badge>}
          {c.kind && <Badge variant="secondary">{t(`explore.kind.${c.kind}`, { defaultValue: c.kind })}</Badge>}
          {c.management && <Badge variant="outline">{c.management}</Badge>}
          {c.location && <Badge variant="outline">{c.location}</Badge>}
        </div>
        <p className="mt-3 text-sm opacity-80">AISHE {c.aishe_code}</p>
      </section>

      <Section title={t('explore.aboutCollege')}>
        <dl className="grid gap-2 sm:grid-cols-2">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="rounded-2xl border bg-card px-4 py-3">
              <dt className="text-sm text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {c.org_id ? (
        <Section title={t('explore.fromCollege')}>
          <dl className="grid gap-2 sm:grid-cols-2">
            {[...DETAIL_KEYS, ...extra].filter((k) => show(d[k])).map((k) => (
              <div key={k} className="rounded-2xl border bg-card px-4 py-3">
                <dt className="text-sm text-muted-foreground">{t(`explore.detail.${k}`, { defaultValue: k })}</dt>
                <dd className="font-medium break-words">{show(d[k])}</dd>
              </div>
            ))}
          </dl>
          {![...DETAIL_KEYS, ...extra].some((k) => show(d[k])) && <Note>{t('explore.noDetailsYet')}</Note>}
        </Section>
      ) : (
        <Note>{t('explore.notClaimed')}</Note>
      )}

      <Note>
        {t('explore.claimNote')}{' '}
        <Link to="/app/organisation" className="font-medium underline underline-offset-4">{t('explore.claimLink')}</Link>
      </Note>

      {c.kind && c.state && (
        <Section title={t('explore.similarNearby')}>
          <CollegeList kind={c.kind} state={c.state} district={c.district ?? undefined} limit={4} />
        </Section>
      )}
      {c.kind && (
        <Link to={to.colleges({ kind: c.kind })} className="text-sm font-medium underline underline-offset-4">{t('explore.seeAllColleges')}</Link>
      )}
    </div>
  )
}
