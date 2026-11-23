import { Accessibility, CircleCheck, CircleDashed, HandCoins, Home, MapPin, ShieldCheck, Smartphone, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

type Facts = Record<string, unknown>

const has = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

type Row = { key: string; icon: ReactNode; known: boolean; effect: string; ask?: string }

/**
 * "We look at more than marks": the parts of a student's life the plan takes into account,
 * each with what it changes. Wording is fixed per rule; nothing here is model-written.
 */
export function BeyondMarks({ facts, showPrivate }: { facts: Facts; showPrivate: boolean }) {
  const { t } = useTranslation()
  const age = Number(facts.age ?? 0)
  const place = [facts.district, facts.state].filter(Boolean).join(', ')

  const rows: Row[] = [
    {
      key: 'place',
      icon: <MapPin />,
      known: has(facts.district) || has(facts.state),
      effect: has(facts.go_where)
        ? t(`beyond.place.${String(facts.go_where)}`, { place: place || t('beyond.yourArea') })
        : t('beyond.place.known', { place: place || t('beyond.yourArea') }),
      ask: 'district',
    },
    {
      key: 'money',
      icon: <HandCoins />,
      known: has(facts.needs_income_soon) || has(facts.family_income_annual),
      effect: facts.needs_income_soon ? t('beyond.money.earn') : t('beyond.money.study'),
      ask: 'needs_income_soon',
    },
    {
      key: 'age',
      icon: <ShieldCheck />,
      known: age > 0,
      effect: age > 0 && age < 18 ? t('beyond.age.minor') : t('beyond.age.adult'),
      ask: 'age',
    },
    {
      key: 'access',
      icon: <Smartphone />,
      known: has(facts.phone_access) || has(facts.internet),
      effect:
        facts.phone_access === 'shared' || facts.phone_access === 'school' || facts.internet === 'patchy' || facts.internet === 'none'
          ? t('beyond.access.limited')
          : t('beyond.access.good'),
      ask: 'phone_access',
    },
    {
      key: 'family',
      icon: <Home />,
      known: has(facts.has_family_business) || has(facts.hours_per_week),
      effect: facts.has_family_business ? t('beyond.family.business') : t('beyond.family.time'),
      ask: 'has_family_business',
    },
    {
      key: 'disability',
      icon: <Accessibility />,
      known: has(facts.is_disabled),
      effect: !showPrivate ? t('beyond.private') : facts.is_disabled ? t('beyond.disability.yes') : t('beyond.disability.no'),
      ask: 'is_disabled',
    },
    {
      key: 'interests',
      icon: <Sparkles />,
      known: has(facts.interests) || has(facts.riasec) || has(facts.skills),
      effect: t('beyond.interests.effect'),
      ask: 'interests',
    },
  ]
  const known = rows.filter((r) => r.known).length

  return (
    <section
      aria-labelledby="beyond-title"
      className="flex flex-col gap-4 rounded-[1.75rem] bg-card p-5 ring-1 ring-black/[0.04] sm:p-6 dark:ring-white/[0.05]"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="beyond-title" className="text-lg font-semibold tracking-tight">
            {t('beyond.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('beyond.lead')}</p>
        </div>
        <span className="rounded-full bg-primary/12 px-3 py-1 text-sm font-semibold text-primary tabular-nums">
          {t('beyond.count', { known, total: rows.length })}
        </span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <li key={r.key} className={cn('flex gap-3 rounded-3xl p-4', r.known ? 'bg-muted/60' : 'bg-muted/30 ring-1 ring-dashed ring-border')}>
            <span
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-full [&_svg]:size-[18px]',
                r.known ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground ring-1 ring-border',
              )}
            >
              {r.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                {t(`beyond.${r.key}.title`)}
                {r.known ? (
                  <CircleCheck className="size-4 text-primary" aria-label={t('beyond.known')} />
                ) : (
                  <CircleDashed className="size-4 text-muted-foreground" aria-label={t('beyond.unknown')} />
                )}
              </p>
              {r.known ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{r.effect}</p>
              ) : (
                <Link to="/app/start" className="mt-0.5 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
                  {t('beyond.tellUs')}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
