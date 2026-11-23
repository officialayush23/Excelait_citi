import { ExternalLink, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import data from '@shared/data/labour_trends.json'
import { BentoCard } from '@/components/bento/Bento'
import { DemandSupply } from '@/components/trends/DemandSupply'
import { TrendChart } from '@/components/trends/TrendChart'
import { PageHeader } from '@/components/page/PageHeader'
import { cn } from '@/lib/utils'
import { linearTrend, period } from '@/lib/trend'

type Series = (typeof data.series)[number]
const series = data.series as Series[]
const INDUSTRIES = ['agriculture', 'manufacturing', 'construction', 'trade', 'transport', 'services'] as const
const AREAS = ['all', 'rural', 'urban'] as const
type Industry = (typeof INDUSTRIES)[number]
type Area = (typeof AREAS)[number]

const find = (industry: string, area: string) => series.find((s) => s.industry === industry && s.area === area)!
const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-10 rounded-full px-4 text-sm font-medium ring-1 ring-border transition-colors focus-visible:outline-2 focus-visible:outline-ring',
        active ? 'bg-primary text-primary-foreground ring-transparent' : 'bg-card hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

export function Trends() {
  const { t, i18n } = useTranslation()
  const [industry, setIndustry] = useState<Industry>('agriculture')
  const [area, setArea] = useState<Area>('all')
  const lang = (['en', 'hi', 'mr'].includes(i18n.language) ? i18n.language : 'en') as 'en' | 'hi' | 'mr'

  const s = find(industry, area)
  const trend = useMemo(() => linearTrend(s.points), [s])
  const ranking = useMemo(
    () =>
      INDUSTRIES.map((k) => ({ k, slope: linearTrend(find(k, area).points)?.slope ?? 0, latest: find(k, area).points.at(-1)!.value })).sort((a, b) => b.slope - a.slope),
    [area],
  )
  const latest = s.points[s.points.length - 1]
  const end = trend?.projection[trend.projection.length - 1]
  const first = s.points[0]

  return (
    <>
      <PageHeader title={t('nav.trends')} subtitle={t('trends.subtitle')} />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <BentoCard>
            <p className="mb-3 text-sm font-medium text-muted-foreground">{t('trends.pickIndustry')}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('trends.pickIndustry')}>
              {INDUSTRIES.map((k) => (
                <Chip key={k} active={k === industry} onClick={() => setIndustry(k)}>
                  {t(`trends.industry.${k}`)}
                </Chip>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('trends.pickArea')}>
              {AREAS.map((a) => (
                <Chip key={a} active={a === area} onClick={() => setArea(a)}>
                  {t(`trends.area.${a}`)}
                </Chip>
              ))}
            </div>
          </BentoCard>

          <BentoCard>
            <h2 className="text-base font-semibold tracking-tight">{s.label[lang]}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('trends.chartSub')}</p>
            <div className="mt-4">
              {trend && (
                <TrendChart
                  history={s.points}
                  projection={trend.projection}
                  unit={t('trends.unit')}
                  ariaLabel={t('trends.chartAria', { name: s.label[lang], from: period(first.year), to: period(latest.year), a: fmt(first.value), b: fmt(latest.value) })}
                />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-chart-1" />{t('trends.legendHistory')}</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-chart-1" />{t('trends.legendProjection')}</span>
              <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-chart-1/20" />{t('trends.legendBand')}</span>
            </div>
            {trend && end && (
              <div className="mt-4 rounded-2xl bg-muted p-4">
                <p className="text-sm font-semibold">{t('trends.projectionLabel')}</p>
                <p className="mt-1 text-sm">
                  {t('trends.summary', { slope: `${trend.slope >= 0 ? '+' : ''}${fmt(trend.slope)}`, year: period(end.year), value: fmt(end.value), low: fmt(Math.max(0, end.low)), high: fmt(Math.min(100, end.high)) })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('trends.thin', { n: s.points.length })}</p>
              </div>
            )}
            <p className="mt-4 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {t('trends.source')}:{' '}
              <a href={s.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline">
                {s.source.name}
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </a>{' '}
              ({t('trends.checkedOn', { date: s.source.checked_on })})
            </p>
          </BentoCard>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <BentoCard>
            <h2 className="text-base font-semibold tracking-tight">{t('trends.growingTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('trends.growingSub', { area: t(`trends.area.${area}`) })}</p>
            <ul className="mt-4 flex flex-col gap-2">
              {ranking.map((r) => {
                const up = r.slope >= 0
                return (
                  <li key={r.k} className="flex min-w-0 items-center gap-3 rounded-2xl bg-muted px-4 py-3">
                    <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', up ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground ring-1 ring-border')}>
                      {up ? <TrendingUp className="size-4" aria-hidden="true" /> : <TrendingDown className="size-4" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t(`trends.industry.${r.k}`)}</span>
                      <span className="block text-xs text-muted-foreground">{t('trends.latest', { value: fmt(r.latest) })}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{`${up ? '+' : ''}${fmt(r.slope)}`} <span className="text-xs font-normal text-muted-foreground">{t('trends.perYear')}</span></span>
                  </li>
                )
              })}
            </ul>
          </BentoCard>
          <DemandSupply />
        </div>
      </div>
    </>
  )
}
