import { BadgeCheck, BookOpen, Building2, CalendarClock, Globe, IndianRupee, MapPin, PlayCircle, Search, ShieldAlert, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { formatInr } from '@/lib/format'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

import { CardShell, RowLink, SeeAll, TileIcon, domainOf, useAskSaathi, useDateText } from './kit'
import type { CardOf, Resource } from './types'

/* ---------------- learning resources ---------------- */

export function ResourceRows({ items }: { items: Resource[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((r) => (
        <li key={r.slug}>
          <RowLink
            href={r.url}
            leading={<TileIcon icon={r.kind === 'video' ? <PlayCircle /> : <BookOpen />} tone="mint" />}
            title={r.title}
            subtitle={[r.provider, domainOf(r.url)].filter(Boolean).join(' · ')}
          />
        </li>
      ))}
    </ul>
  )
}

export function ResourcesCard({ card }: { card: CardOf<'resources'> }) {
  const { t } = useTranslation()
  return (
    <CardShell icon={<BookOpen />} tone="mint" title={t('saathi.cards.resources')} subtitle={t('saathi.cards.resourcesSub')}>
      {card.items.length ? <ResourceRows items={card.items} /> : <p className="text-muted-foreground">{t('saathi.cards.noneFound')}</p>}
      <SeeAll to={to.learn()}>{t('saathi.cards.allLearn')}</SeeAll>
    </CardShell>
  )
}

/* ---------------- colleges ---------------- */

export function CollegesCard({ card }: { card: CardOf<'colleges'> }) {
  const { t } = useTranslation()
  const { ask, busy } = useAskSaathi()
  const q = card.query ?? {}
  const place = [q.district, q.state].filter(Boolean).join(', ')
  const kindLabel = q.kind ? t(`saathi.collegeKind.${q.kind}`, { defaultValue: q.kind }) : t('saathi.collegeKind.any')
  const webQuery = t('saathi.searchCollegesMsg', { kind: kindLabel, place: place || t('saathi.nearMe') })

  if (!card.directory_loaded)
    return (
      <CardShell icon={<Building2 />} tone="rose" title={t('saathi.cards.colleges')}>
        <div className="flex items-start gap-3 rounded-2xl bg-tile-peach p-4 text-tile-foreground">
          <Sparkles aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">{t('saathi.cards.directoryComing')}</p>
            <p className="mt-1 text-sm opacity-80">{t('saathi.cards.directoryComingBody')}</p>
          </div>
        </div>
        <Button type="button" size="lg" disabled={busy} onClick={() => ask(webQuery)} className="h-12 self-start rounded-full px-6 text-base">
          <Search className="size-5" />
          {t('saathi.cards.searchWeb')}
        </Button>
      </CardShell>
    )

  return (
    <CardShell icon={<Building2 />} tone="rose" title={t('saathi.cards.colleges')} subtitle={[kindLabel, place].filter(Boolean).join(' · ')}>
      {card.items.length ? (
        <ul className="flex flex-col gap-2">
          {card.items.map((c) => (
            <li key={c.aishe_code}>
              <RowLink
                to={to.college(c.aishe_code)}
                leading={<TileIcon icon={<Building2 />} tone={c.org_id ? 'mint' : 'rose'} />}
                title={
                  <span className="inline-flex max-w-full items-center gap-1.5">
                    <span className="truncate">{c.name}</span>
                    {c.org_id && <BadgeCheck aria-label={t('saathi.verified')} className="size-4 shrink-0 text-success" />}
                  </span>
                }
                subtitle={
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="inline-flex items-center gap-1"><MapPin aria-hidden="true" className="size-3.5" />{[c.district, c.state].filter(Boolean).join(', ')}</span>
                    {c.management && <span>· {c.management}</span>}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">{t('saathi.cards.noColleges')}</p>
          <Button type="button" variant="outline" disabled={busy} onClick={() => ask(webQuery)} className="h-11 self-start rounded-full px-5">
            <Search className="size-4" />
            {t('saathi.cards.searchWeb')}
          </Button>
        </div>
      )}
      <SeeAll to={to.colleges({ kind: q.kind ?? undefined, state: q.state ?? undefined, district: q.district ?? undefined })}>{t('saathi.cards.allColleges')}</SeeAll>
    </CardShell>
  )
}

/* ---------------- partner offers ---------------- */

export function OffersCard({ card }: { card: CardOf<'offers'> }) {
  const { t } = useTranslation()
  const date = useDateText()
  return (
    <CardShell icon={<Sparkles />} tone="mint" title={t('saathi.cards.offers')} subtitle={t('saathi.cards.offersSub')}>
      {card.items.length ? (
        <ul className="flex flex-col gap-2">
          {card.items.map((o) => {
            const free = !o.fee_inr
            return (
              <li key={o.id}>
                <RowLink
                  to={to.opportunities(o.id)}
                  className="items-start"
                  leading={<TileIcon icon={<Sparkles />} tone="mint" />}
                  title={o.title}
                  subtitle={
                    <span className="flex flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {o.org_name && (
                          <span className="inline-flex items-center gap-1">
                            {o.org_name}
                            {o.verified && <BadgeCheck aria-label={t('saathi.verified')} className="size-4 text-success" />}
                          </span>
                        )}
                        <span className="rounded-full bg-surface px-2 py-0.5 text-xs">{t(`saathi.offerKind.${o.kind}`, { defaultValue: o.kind })}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', free ? 'bg-highlight text-highlight-foreground' : 'bg-tile-peach text-tile-foreground')}>
                          <IndianRupee aria-hidden="true" className="size-3" />
                          {free ? t('saathi.free') : formatInr(o.fee_inr ?? 0)}
                        </span>
                        {o.stipend_monthly ? (
                          <span className="rounded-full bg-tile-mint px-2.5 py-0.5 text-xs font-semibold text-tile-foreground">{t('saathi.stipend', { amount: formatInr(o.stipend_monthly) })}</span>
                        ) : null}
                        {o.deadline && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-tile-rose px-2.5 py-0.5 text-xs font-semibold text-tile-foreground">
                            <CalendarClock aria-hidden="true" className="size-3" />
                            {t('saathi.applyBy', { date: date(o.deadline) })}
                          </span>
                        )}
                        {o.match === 'needs_info' && <span className="rounded-full border px-2.5 py-0.5 text-xs">{t('saathi.result.needs_info')}</span>}
                      </span>
                      {o.criteria_labels && o.criteria_labels.length > 0 && <span className="line-clamp-1 text-xs">{o.criteria_labels.join(' · ')}</span>}
                    </span>
                  }
                />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('saathi.cards.noOffers')}</p>
      )}
      <SeeAll to={to.opportunities()}>{t('saathi.cards.allOffers')}</SeeAll>
    </CardShell>
  )
}

/* ---------------- web search ---------------- */

export function WebCard({ card }: { card: CardOf<'web'> }) {
  const { t } = useTranslation()
  return (
    <CardShell icon={<Globe />} tone="sky" title={t('saathi.cards.web')} subtitle={card.query}>
      <p className="flex items-start gap-2 rounded-2xl bg-tile-peach p-3 text-sm text-tile-foreground" role="note">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t('saathi.cards.webNote')}
      </p>
      {card.results.length ? (
        <ul className="flex flex-col gap-2">
          {card.results.map((r, i) => {
            const domain = domainOf(r.url)
            const body = (
              <>
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Globe aria-hidden="true" className="size-3.5" />
                  {domain || t('saathi.cards.webSummary')}
                </span>
                <span className="mt-1 block font-medium">{r.title}</span>
                {r.snippet && <span className="mt-1 line-clamp-3 block text-sm text-muted-foreground">{r.snippet}</span>}
              </>
            )
            return (
              <li key={r.url || i}>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer" className="block rounded-2xl bg-surface p-3 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    {body}
                  </a>
                ) : (
                  <div className="rounded-2xl bg-surface p-3">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('saathi.cards.noneFound')}</p>
      )}
    </CardShell>
  )
}
