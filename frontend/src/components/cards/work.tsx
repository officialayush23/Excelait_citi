import { BriefcaseBusiness, CircleCheck, CircleX, ExternalLink, Info, MapPin, Scale, ShieldAlert, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SpeakButton } from '@/components/shell/SpeakButton'

import { CardShell, SectionLabel, domainOf, useDateText } from './kit'
import type { CardOf, JobPost, LawRule, SourceRef } from './types'

/* ---------------- sources: every fact shows where it comes from ---------------- */

export function SourceList({ sources, checkedOn, label }: { sources: SourceRef[]; checkedOn?: string | null; label?: string }) {
  const { t } = useTranslation()
  const date = useDateText()
  if (!sources.length) return null
  return (
    <div className="rounded-2xl bg-surface p-3">
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label ?? t('saathi.cards.sources')}</p>
      <ul className="flex flex-col gap-1">
        {sources.map((s, i) => (
          <li key={`${s.url}-${i}`}>
            <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1.5 text-sm underline-offset-2 hover:underline">
              <ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {s.title || domainOf(s.url)}
                <span className="text-muted-foreground"> · {s.site || domainOf(s.url)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {checkedOn && <p className="mt-1.5 text-xs text-muted-foreground">{t('saathi.cards.checkedOn', { date: date(checkedOn) })}</p>}
    </div>
  )
}

/* ---------------- what the law says for your age ---------------- */

function RuleGroup({ title, rules, icon, tone, text, policy }: {
  title: string
  rules: LawRule[]
  icon: ReactNode
  tone: string
  text: (r: LawRule) => string
  policy: string
}) {
  if (!rules.length) return null
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <ul className="flex flex-col gap-2">
        {rules.map((r) => (
          <li key={r.id} className={`flex items-start gap-2 rounded-2xl p-3 text-tile-foreground ${tone}`}>
            <span aria-hidden="true" className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>
            <span>
              {text(r)}
              {r.policy && <span className="ml-1 text-xs opacity-75">({policy})</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LawCard({ card }: { card: CardOf<'law'> }) {
  const { t, i18n } = useTranslation()
  const text = (r: { text: Record<string, string> }) => r.text[i18n.language] ?? r.text.en
  const allowed = card.rules.filter((r) => r.kind === 'allowed')
  const notAllowed = card.rules.filter((r) => r.kind === 'not_allowed')
  const limits = card.rules.filter((r) => r.kind === 'limit')
  const spoken = [t('saathi.law.title'), ...card.rules.map(text)].join('. ')
  return (
    <CardShell
      icon={<Scale />}
      tone="peach"
      title={t('saathi.law.title')}
      subtitle={card.age != null ? t('saathi.law.forAge', { age: card.age }) : undefined}
      action={<SpeakButton text={spoken} />}
    >
      <RuleGroup title={t('saathi.law.allowed')} rules={allowed} icon={<CircleCheck />} tone="bg-tile-mint" text={text} policy={t('saathi.law.policy')} />
      <RuleGroup title={t('saathi.law.notAllowed')} rules={notAllowed} icon={<CircleX />} tone="bg-tile-rose" text={text} policy={t('saathi.law.policy')} />
      <RuleGroup title={t('saathi.law.note')} rules={limits} icon={<Info />} tone="bg-tile-sky" text={text} policy={t('saathi.law.policy')} />
      <SourceList sources={card.sources.map((s) => ({ title: s.title, url: s.url, site: s.publisher }))} checkedOn={card.checked_on} label={t('saathi.law.sources')} />
      <p className="text-xs text-muted-foreground">{t('saathi.law.disclaimer')}</p>
    </CardShell>
  )
}

/* ---------------- current job openings ---------------- */

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000))
}

function JobRow({ job, seenOn }: { job: JobPost; seenOn: string }) {
  const { t } = useTranslation()
  const date = useDateText()
  const ago = daysAgo(job.posted)
  return (
    <a
      href={job.url}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-14 items-start gap-3 rounded-2xl bg-surface px-3 py-2.5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{job.title}</span>
        {job.employer && <span className="block text-sm">{job.employer}</span>}
        <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          {job.place && <span className="inline-flex items-center gap-1"><MapPin aria-hidden="true" className="size-3.5" />{job.place}</span>}
          {job.pay && <span className="inline-flex items-center gap-1 font-medium text-foreground/80"><Wallet aria-hidden="true" className="size-3.5" />{job.pay}</span>}
          <span>{ago != null ? t('saathi.jobs.postedAgo', { count: ago }) : t('saathi.jobs.seenOn', { date: date(seenOn) })}</span>
        </span>
      </span>
      <ExternalLink aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
    </a>
  )
}

export function JobsCard({ card }: { card: CardOf<'jobs'> }) {
  const { t } = useTranslation()
  const names = card.site_names ?? {}
  const bySite = new Map<string, JobPost[]>()
  for (const j of card.items) bySite.set(j.site, [...(bySite.get(j.site) ?? []), j])
  const siteList = card.sites.map((s) => names[s] ?? s).join(', ')
  const moved = card.searched_place && card.searched_place !== card.place
  return (
    <CardShell
      icon={<BriefcaseBusiness />}
      tone="mint"
      title={card.apprenticeship_only ? t('saathi.jobs.apprenticeTitle') : t('saathi.jobs.title')}
      subtitle={t('saathi.jobs.sub', { role: card.role, place: card.searched_place || card.place })}
    >
      <p className="flex items-start gap-2 rounded-2xl bg-tile-peach p-3 text-sm text-tile-foreground" role="note">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t('saathi.jobs.note', { sites: siteList })}
      </p>
      {card.minor && <p className="rounded-2xl bg-tile-sky p-3 text-sm text-tile-foreground">{t('saathi.jobs.minorNote')}</p>}
      {moved && card.items.length > 0 && <p className="text-sm text-muted-foreground">{t('saathi.jobs.nearbyShown', { place: card.place, nearby: card.searched_place })}</p>}
      {card.items.length ? (
        [...bySite.entries()].map(([site, list]) => (
          <div key={site}>
            <SectionLabel>{t('saathi.jobs.fromSite', { site: names[site] ?? site })}</SectionLabel>
            <ul className="flex flex-col gap-2">
              {list.map((j) => (
                <li key={j.url}>
                  <JobRow job={j} seenOn={card.checked_on} />
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p className="text-muted-foreground">
          {t('saathi.jobs.none', { place: card.place })}
          {card.nearby.length > 0 && ` ${t('saathi.jobs.tryNearby', { places: card.nearby.join(', ') })}`}
        </p>
      )}
      {card.pages.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.jobs.moreOnSites')}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {card.pages.map((p) => (
              <a
                key={p.url}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
                {names[p.site] ?? p.site}
              </a>
            ))}
          </div>
        </div>
      )}
    </CardShell>
  )
}
