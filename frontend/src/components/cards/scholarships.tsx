import { CalendarClock, CircleCheck, CircleHelp, CircleX, ExternalLink, GraduationCap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SpeakButton } from '@/components/shell/SpeakButton'
import { FactQuestion } from '@/components/student/FactQuestion'
import { Button } from '@/components/ui/button'
import { useFacts } from '@/data/facts'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

import { CardShell, SeeAll, TileIcon, tileClass, useDateText, type TileTone } from './kit'
import type { CardOf, FoundScholarship, ScholarshipMatch } from './types'

const ICON = { likely_eligible: CircleCheck, check: CircleHelp, not_eligible: CircleX } as const
const TONE: Record<ScholarshipMatch, TileTone> = { likely_eligible: 'mint', check: 'peach', not_eligible: 'muted' }

/** One scholarship found on the web: where it was found, the deadline, and why it may or may not fit. */
function FoundRow({ item }: { item: FoundScholarship }) {
  const { t } = useTranslation()
  const date = useDateText()
  const Icon = ICON[item.match]
  const soon = item.days_left != null && item.days_left <= 7
  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-surface p-3">
      <div className="flex items-start gap-3">
        <TileIcon icon={<Icon />} tone={TONE[item.match]} />
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{item.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[item.provider, item.provider_type ? t(`saathi.scholarships.type.${item.provider_type}`) : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', tileClass[TONE[item.match]])}>
          {t(`saathi.scholarships.match.${item.match}`)}
        </span>
      </div>
      {item.amount_text && <p className="line-clamp-2 text-sm">{item.amount_text}</p>}
      <p className={cn('flex items-center gap-1.5 text-sm', soon ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
        <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
        {item.deadline
          ? t('saathi.scholarships.deadline', { date: date(item.deadline), count: item.days_left ?? 0 })
          : t('saathi.scholarships.noDeadline')}
      </p>
      {item.match === 'not_eligible' && item.reasons.length > 0 && (
        <p className="text-sm text-muted-foreground">{t('saathi.scholarships.because', { reason: item.reasons.join('; ') })}</p>
      )}
      {item.match === 'check' && item.unknown.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('saathi.scholarships.toCheck', { what: item.unknown.map((u) => t(`saathi.scholarships.unknown.${u}`, { defaultValue: u })).join(', ') })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant={item.match === 'likely_eligible' ? 'default' : 'outline'} className="h-10 rounded-full px-4">
          <a href={item.source_url} target="_blank" rel="noreferrer">
            {t('saathi.scholarships.open', { site: item.site_name ?? item.source_site ?? '' })}
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
        {item.apply_url && item.apply_url !== item.source_url && item.match !== 'not_eligible' && (
          <a href={item.apply_url} target="_blank" rel="noreferrer" className="text-sm underline-offset-2 hover:underline">
            {t('saathi.scholarships.applyLink')}
          </a>
        )}
      </div>
    </li>
  )
}

/** The list of found scholarships, shared by the Saathi card and the Money page. */
export function FoundScholarshipList({ items, limit }: { items: FoundScholarship[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items
  return (
    <ul className="flex flex-col gap-2">
      {shown.map((s) => (
        <FoundRow key={s.source_url} item={s} />
      ))}
    </ul>
  )
}

/** Optional facts (category, family income ...) that would let more scholarships be checked. Asked gently, one at a time. */
export function AskMore({ fields }: { fields: string[] }) {
  const { t } = useTranslation()
  const facts = useFacts((s) => s.facts)
  const update = useFacts((s) => s.update)
  const [done, setDone] = useState(false)
  const next = fields.find((f) => facts[f] == null)
  if (done) return <p className="text-sm text-muted-foreground">{t('saathi.scholarships.savedAskAgain')}</p>
  if (!next) return null
  return (
    <div className="rounded-2xl border border-dashed p-3">
      <p className="mb-2 text-sm text-muted-foreground">{t('saathi.scholarships.optional')}</p>
      <FactQuestion key={next} field={next} compact onAnswer={(v) => void update({ [next]: v }).then(() => setDone(true))} />
    </div>
  )
}

export function ScholarshipsCard({ card }: { card: CardOf<'scholarships'> }) {
  const { t } = useTranslation()
  const date = useDateText()
  const sites = card.sites.join(', ')
  const spoken = [t('saathi.cards.scholarships'), ...card.found.slice(0, 5).map((s) => s.name)].join('. ')
  return (
    <CardShell
      icon={<GraduationCap />}
      tone="mint"
      title={t('saathi.cards.scholarships')}
      subtitle={t('saathi.scholarships.counts', { likely: card.counts.likely_eligible, check: card.counts.check })}
      action={<SpeakButton text={spoken} />}
    >
      {card.found.length ? <FoundScholarshipList items={card.found} limit={6} /> : <p className="text-muted-foreground">{t('saathi.scholarships.none')}</p>}
      {card.ask.length > 0 && <AskMore fields={card.ask} />}
      <SeeAll to={to.money()}>{t('saathi.scholarships.seeAll')}</SeeAll>
      <p className="text-xs text-muted-foreground">
        {t('saathi.scholarships.foundOn', { sites: sites || 'Buddy4Study', date: date(card.checked_on) })}
      </p>
    </CardShell>
  )
}
