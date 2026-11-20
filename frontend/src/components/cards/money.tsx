import { ExternalLink, FileText, Info, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimatedNumber } from '@/components/motion-primitives/animated-number'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { formatInr } from '@/lib/format'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

import { CardShell, ChipLink, RESULT_ICON, RESULT_TONE, RowLink, SectionLabel, SeeAll, TileIcon, tileClass, useName } from './kit'
import type { CardOf } from './types'

/* ---------------- schemes: the money total and the list ---------------- */

export function SchemesCard({ card }: { card: CardOf<'schemes'> }) {
  const { t } = useTranslation()
  const eligible = card.items.filter((s) => s.result === 'eligible').length
  const needInfo = card.items.filter((s) => s.result === 'needs_info').length
  return (
    <CardShell icon={<Wallet />} tone="peach" title={t('saathi.cards.schemes')}>
      <div className="flex flex-col gap-1 rounded-2xl bg-highlight p-4 text-highlight-foreground">
        <p className="text-sm opacity-80">{t('saathi.cards.rupeesYouCanGet')}</p>
        <p className="text-4xl font-semibold tracking-tight">
          <span className="mr-0.5 text-[0.7em] opacity-75">₹</span>
          <AnimatedNumber value={card.rupees} springOptions={{ bounce: 0, duration: 1000 }} />
        </p>
        <p className="text-sm opacity-80">
          {t('saathi.cards.schemeCounts', { eligible, needInfo })}
        </p>
      </div>
      {card.items.length ? (
        <ul className="flex flex-col gap-2">
          {card.items.map((s) => {
            const Icon = RESULT_ICON[s.result]
            return (
              <li key={s.slug}>
                <RowLink
                  to={to.scheme(s.slug)}
                  leading={<TileIcon icon={<Icon />} tone={RESULT_TONE[s.result]} />}
                  title={s.name}
                  subtitle={
                    s.result === 'needs_info' ? (
                      <span className="font-medium text-foreground/80">{t('saathi.answerToUnlock')}</span>
                    ) : (
                      t(`saathi.result.${s.result}`)
                    )
                  }
                  trailing={s.benefit_amount ? <span className="shrink-0 font-semibold">{formatInr(s.benefit_amount)}</span> : undefined}
                />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('saathi.cards.noSchemes')}</p>
      )}
      <SeeAll to={to.money()}>{t('saathi.cards.allMoney')}</SeeAll>
      <p className="text-xs text-muted-foreground">{t('saathi.cards.rulesNote')}</p>
    </CardShell>
  )
}

/* ---------------- scheme: one in detail ---------------- */

export function SchemeCard({ card }: { card: CardOf<'scheme'> }) {
  const { t } = useTranslation()
  const name = useName()
  const Icon = RESULT_ICON[card.result]
  return (
    <CardShell
      icon={<Wallet />}
      tone="peach"
      title={card.name}
      subtitle={card.ministry ?? undefined}
      action={<SpeakButton text={`${card.name}. ${t(`saathi.result.${card.result}`)}. ${card.benefit_text}`} />}
    >
      <div className={cn('flex items-start gap-3 rounded-2xl p-4', tileClass[RESULT_TONE[card.result]])}>
        <Icon aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
        <div className="min-w-0">
          <p className="text-lg font-semibold">{t(`saathi.result.${card.result}`)}</p>
          {card.benefit_amount ? <p className="text-2xl font-semibold">{formatInr(card.benefit_amount)}</p> : null}
          <p className="mt-1 text-sm">{card.benefit_text}</p>
          {card.result === 'not_eligible' && card.failed.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm">
              {card.failed.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {card.result === 'needs_info' && (
        <RowLink
          to={to.scheme(card.slug)}
          leading={<TileIcon icon={<Info />} tone="highlight" />}
          title={t('saathi.answerToUnlock')}
          subtitle={t('saathi.questionsLeft', { count: card.missing.length })}
        />
      )}

      {card.documents.length > 0 && card.result !== 'not_eligible' && (
        <div>
          <SectionLabel>{t('saathi.cards.papers')}</SectionLabel>
          <ul className="flex flex-wrap gap-2">
            {card.documents.map((d) => (
              <li key={d.slug} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-surface px-3 text-sm">
                <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
                {d.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.careers.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.helpsWith')}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {card.careers.slice(0, 5).map((c) => (
              <ChipLink key={c.slug} to={to.career(c.slug)} tone="lilac">{name(c)}</ChipLink>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {card.result === 'eligible' && card.apply_url && (
          <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
            <a href={card.apply_url} target="_blank" rel="noreferrer">
              {t('saathi.apply')}
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        )}
        <SeeAll to={to.scheme(card.slug)}>{t('saathi.cards.openScheme')}</SeeAll>
      </div>
      <p className="text-xs text-muted-foreground">{t('saathi.cards.rulesNote')}</p>
    </CardShell>
  )
}
