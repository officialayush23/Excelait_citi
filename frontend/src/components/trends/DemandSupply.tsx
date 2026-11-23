import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { BentoCard } from '@/components/bento/Bento'
import { api } from '@/lib/api'

type Row = { category: string; students: number; jobs: number; scholarships: number; offers: number; opportunities: number }
type Result = { categories: Row[]; totals: { students: number; unmapped_opportunities: number } }

function Bar({ value, max, className, label }: { value: number; max: number; className: string; label: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${className}`} style={{ width: `${max ? Math.max(value ? 3 : 0, (value / max) * 100) : 0}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums">{value}</span>
    </div>
  )
}

/** Students interested in or saving each career category vs the opportunities ExcelAIt holds for it. */
export function DemandSupply() {
  const { t } = useTranslation()
  const q = useQuery({ queryKey: ['demand-supply'], queryFn: () => api<Result>('/api/v1/insights/demand-supply') })
  const rows = (q.data?.categories ?? []).filter((r) => r.students || r.opportunities).sort((a, b) => b.students + b.opportunities - (a.students + a.opportunities))
  const max = Math.max(1, ...rows.flatMap((r) => [r.students, r.opportunities]))
  return (
    <BentoCard>
      <h2 className="text-base font-semibold tracking-tight">{t('trends.supply.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('trends.supply.subtitle')}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-chart-1" />{t('trends.supply.students')}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-chart-2" />{t('trends.supply.opportunities')}</span>
      </div>
      {q.isLoading && <Loader2 className="mt-6 size-5 animate-spin text-muted-foreground" aria-label={t('common.loading', { defaultValue: 'Loading' })} />}
      {q.isError && <p role="alert" className="mt-5 text-sm text-muted-foreground">{t('trends.supply.error')}</p>}
      {q.data && rows.length === 0 && <p className="mt-5 text-sm text-muted-foreground">{t('trends.supply.empty')}</p>}
      <ul className="mt-4 flex flex-col gap-4">
        {rows.map((r) => (
          <li key={r.category} className="min-w-0">
            <p className="mb-1 truncate text-sm font-medium">{t(`categories.${r.category}`, { defaultValue: r.category })}</p>
            <Bar value={r.students} max={max} className="bg-chart-1" label={`${t('trends.supply.students')}: ${r.students}`} />
            <div className="mt-1">
              <Bar value={r.opportunities} max={max} className="bg-chart-2" label={`${t('trends.supply.opportunities')}: ${r.opportunities}`} />
            </div>
          </li>
        ))}
      </ul>
      {q.data && q.data.totals.unmapped_opportunities > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">{t('trends.supply.unmapped', { count: q.data.totals.unmapped_opportunities })}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{t('trends.supply.note')}</p>
    </BentoCard>
  )
}
