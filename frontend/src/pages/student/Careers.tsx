import { ArrowRight, Check, Compass, ExternalLink, MapPin, TriangleAlert, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { SaveButton } from '@/components/explore/shared'
import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { ListRow, SplitView } from '@/components/page/SplitView'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { careerBySlug, careerName, examBySlug, schemeBySlug } from '@/data/catalogue'
import { useFacts } from '@/data/facts'
import { profileComplete, useEligibility, useMatches, type WhatIf } from '@/data/insights'
import type { Gap, Match, Reason } from '@/engine/matching'
import { payRange } from '@/lib/format'
import { to } from '@/lib/links'

export function Careers() {
  const { t, i18n } = useTranslation()
  const facts = useFacts((s) => s.facts)
  const [whatIf, setWhatIf] = useState<WhatIf>({})
  const stableWhatIf = useMemo(() => whatIf, [whatIf])
  const matches = useMatches(stableWhatIf)
  const [selected, setSelected] = useState<string | null>(null)
  const current = matches.find((m) => m.slug === selected) ?? matches[0]

  if (!profileComplete(facts))
    return (
      <>
        <PageHeader title={t('nav.careers')} back />
        <div className="rounded-3xl border bg-card">
          <EmptyState
            icon={<Compass />}
            title={t('careers.emptyTitle')}
            body={t('careers.emptyBody')}
            action={
              <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
                <Link to="/app/start">
                  {t('home.startProfile')}
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            }
          />
        </div>
      </>
    )

  const toggles: { key: keyof WhatIf; label: string }[] = [
    { key: 'can_relocate', label: t('careers.whatIfCity') },
    { key: 'needs_income_soon', label: t('careers.whatIfEarn') },
  ]

  return (
    <>
      <PageHeader
        title={t('nav.careers')}
        subtitle={t('careers.subtitle')}
        back
        actions={
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/app/start">{t('careers.editAnswers')}</Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border bg-card px-5 py-3">
        <span className="text-sm font-medium text-muted-foreground">{t('careers.whatIf')}</span>
        {toggles.map(({ key, label }) => {
          const base = facts[key] as boolean | undefined
          const on = whatIf[key] ?? base ?? false
          return (
            <label key={key} className="flex items-center gap-2 text-sm">
              <Switch checked={on} onCheckedChange={(v) => setWhatIf((w) => ({ ...w, [key]: v === (base ?? false) ? undefined : v }))} />
              {label}
            </label>
          )
        })}
        {(whatIf.can_relocate !== undefined || whatIf.needs_income_soon !== undefined) && (
          <Button variant="link" size="sm" className="ml-auto" onClick={() => setWhatIf({})}>
            {t('careers.resetWhatIf')}
          </Button>
        )}
      </div>
      <SplitView
        listTitle={<h2 className="text-lg font-semibold">{t('careers.topMatches', { count: matches.length })}</h2>}
        list={matches.map((m) => {
          const c = careerBySlug[m.slug]
          return (
            <ListRow
              key={m.slug}
              selected={m.slug === current?.slug}
              onSelect={() => setSelected(m.slug)}
              leading={<span className="grid size-11 place-items-center rounded-xl bg-tile-lilac text-sm font-semibold text-tile-foreground">{m.score}</span>}
              title={careerName(c, i18n.language)}
              subtitle={t(`categories.${c.category}`, { defaultValue: c.category })}
            />
          )
        })}
        detailKey={current?.slug}
        detail={current ? <CareerDetail match={current} /> : null}
      />
    </>
  )
}

function useReasonText() {
  const { t } = useTranslation()
  const tags = (d: (string | number)[]) => d.map((x) => t(`tags.${x}`, { defaultValue: String(x) })).join(', ')
  return {
    reason: (r: Reason) => t(`reasons.${r.code}`, { items: tags(r.detail), n: r.detail[0] }),
    gap: (g: Gap) =>
      g.code === 'cost'
        ? t('gaps.cost')
        : t(`gaps.${g.code}`, { items: tags(g.detail), n: g.detail[0] }),
  }
}

function CareerDetail({ match }: { match: Match }) {
  const { t, i18n } = useTranslation()
  const c = careerBySlug[match.slug]
  const { reason, gap } = useReasonText()
  const { checks } = useEligibility()
  const status = Object.fromEntries(checks.map((x) => [x.scheme.slug, x.result]))
  const name = careerName(c, i18n.language)
  const pay = payRange(c.pay_min, c.pay_max)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(`categories.${c.category}`, { defaultValue: c.category })}</Badge>
          {c.nsqf_level && <Badge variant="outline">NSQF {c.nsqf_level}</Badge>}
          <Badge variant="outline">{t(`speed.${c.earning_speed}`)}</Badge>
        </div>
        <div className="mt-3 flex items-center gap-1">
          <h2 className="text-3xl font-semibold tracking-tight">{name}</h2>
          <SpeakButton text={`${name}. ${match.reasons.map(reason).join('. ')}`} />
        </div>
        {pay && (
          <p className="mt-1 text-muted-foreground">
            {t('careers.pay', { range: pay })} {c.needs_city && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{t('careers.city')}</span>}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild className="h-11 rounded-full px-5">
            <Link to={to.career(c.slug)}>
              {t('explore.openFullPage')}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <SaveButton career={c.slug} />
        </div>
      </div>

      <section>
        <h3 className="mb-2 font-semibold">{t('careers.why')}</h3>
        <ul className="flex flex-col gap-2">
          {match.reasons.map((r) => (
            <li key={r.code} className="flex items-start gap-2">
              <Check className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-highlight" />
              <span>{reason(r)}</span>
            </li>
          ))}
        </ul>
      </section>

      {match.gaps.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">{t('careers.toWorkOn')}</h3>
          <ul className="flex flex-col gap-2">
            {match.gaps.map((g) => (
              <li key={g.code} className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
                <span>{gap(g)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-3 font-semibold">{t('careers.path')}</h3>
        <ol className="relative flex flex-col gap-3 border-l-2 border-dashed pl-5">
          {c.path.map((p, idx) => (
            <li key={idx} className="relative">
              <span className="absolute top-1 -left-[1.6rem] grid size-4 place-items-center rounded-full bg-highlight text-[0.6rem] font-bold text-highlight-foreground">{idx + 1}</span>
              {p}
            </li>
          ))}
        </ol>
      </section>

      {c.scheme_slugs.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">{t('careers.money')}</h3>
          <ul className="flex flex-col gap-2">
            {c.scheme_slugs.filter((s) => schemeBySlug[s]).map((s) => (
              <li key={s}>
                <Link to={`/app/money?scheme=${s}`} className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 hover:bg-accent">
                  <Wallet className="size-5 shrink-0 text-muted-foreground" />
                  <span className="flex-1">{schemeBySlug[s].name}</span>
                  {status[s] && <Badge variant={status[s] === 'eligible' ? 'default' : 'outline'}>{t(`money.result.${status[s]}`)}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.exam_slugs.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">{t('careers.exams')}</h3>
          <ul className="flex flex-col gap-2">
            {c.exam_slugs.filter((e) => examBySlug[e]).map((e) => (
              <li key={e}>
                <a href={examBySlug[e].official_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline">
                  {examBySlug[e].name}
                  <ExternalLink className="size-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
