import { AlertTriangle, Route, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DaysText, ProgressRing, useStepText } from '@/components/roadmap/parts'
import type { RoadmapStep } from '@/components/roadmap/types'
import { to } from '@/lib/links'

import { CardShell, SeeAll } from './kit'
import type { CardOf } from './types'

/** Saathi's roadmap card: overall %, the one next step with what to do now, close fixed dates, what changed. */
export function RoadmapCard({ card }: { card: CardOf<'roadmap'> }) {
  const { t } = useTranslation()
  const text = useStepText()
  const n = card.next
  return (
    <CardShell icon={<Route />} tone="mint" title={t('roadmap.title')} subtitle={t(`roadmap.hero.${card.tone}`, { defaultValue: t(`roadmap.pace.${card.pace}`) })}>
      <div className="flex items-center gap-4">
        <ProgressRing value={card.progress} size={56} label={t('roadmap.overall', { pct: card.progress })} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('roadmap.nextUp')}</p>
          <p className="font-semibold">{n ? n.title : t('roadmap.nothingNow')}</p>
          {n?.due_date && <p className="text-sm text-muted-foreground"><DaysText days={n.days_left} /></p>}
        </div>
      </div>
      {n && text.now(n as RoadmapStep) && (
        <div className="rounded-2xl bg-primary/10 p-3 text-sm">
          <span className="font-semibold text-primary">{t('roadmap.doNow')}: </span>{text.now(n as RoadmapStep)}
        </div>
      )}
      {card.at_risk.length > 0 && (
        <p className="flex items-center gap-2 text-sm font-medium text-destructive"><AlertTriangle className="size-4" />{t('roadmap.atRiskCount', { count: card.at_risk.length })}</p>
      )}
      {card.changes.map((c) => (
        <p key={c.id} className="flex items-start gap-2 text-sm text-muted-foreground">
          <Undo2 className="mt-0.5 size-4 shrink-0" />{t(`roadmap.reason.${c.reason_code}`, { defaultValue: c.reason, ...(c.params ?? {}) })}
        </p>
      ))}
      <SeeAll to={to.plan()}>{t('roadmap.open')}</SeeAll>
    </CardShell>
  )
}
