import { Bookmark, BookOpen, CalendarDays, CircleCheck, FileText, Flag, GraduationCap, Map as MapIcon, Trophy, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Progress } from '@/components/ui/progress'
import { careerBySlug, careerName } from '@/data/catalogue'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

import { CardShell, ChipLink, RowLink, SectionLabel, SeeAll, TileIcon, useDateText, type TileTone } from './kit'
import type { CardOf, PlanStep } from './types'

const STEP: Record<string, { icon: typeof Flag; tone: TileTone }> = {
  exam: { icon: CalendarDays, tone: 'sky' },
  program: { icon: GraduationCap, tone: 'lilac' },
  scheme: { icon: Wallet, tone: 'peach' },
  document: { icon: FileText, tone: 'rose' },
  course: { icon: BookOpen, tone: 'mint' },
  milestone: { icon: Trophy, tone: 'highlight' },
}

function stepLink(s: PlanStep): { to?: string; href?: string } {
  if (!s.ref_id) return {}
  if (s.kind === 'exam') return { to: to.exam(s.ref_id) }
  if (s.kind === 'program') return { to: to.course(s.ref_id) }
  if (s.kind === 'scheme') return { to: to.scheme(s.ref_id) }
  if (s.kind === 'course' && s.detail?.startsWith('http')) return { href: s.detail }
  return {}
}

function useCareerLabel() {
  const { i18n } = useTranslation()
  return (slug: string, fallback?: string) => (careerBySlug[slug] ? careerName(careerBySlug[slug], i18n.language) : fallback ?? slug)
}

/** A plan's steps in order with dates; tap a step to open what it is about. */
export function PlanCard({ card, limit = 6 }: { card: CardOf<'plan'>; limit?: number }) {
  const { t } = useTranslation()
  const date = useDateText()
  const label = useCareerLabel()
  const steps = [...card.steps].sort((a, b) => a.position - b.position)
  const done = steps.filter((s) => s.done_at).length
  const shown = steps.slice(0, limit)
  return (
    <CardShell icon={<MapIcon />} tone="highlight" title={t('saathi.cards.planFor', { career: label(card.career_slug, card.title) })} subtitle={t('saathi.cards.stepsDone', { done, total: steps.length })}>
      <ol className="flex flex-col gap-2">
        {shown.map((s) => {
          const k = STEP[s.kind] ?? STEP.milestone
          const Icon = s.done_at ? CircleCheck : k.icon
          const link = stepLink(s)
          const when = date(s.due_date)
          return (
            <li key={s.id ?? s.position}>
              <RowLink
                {...link}
                leading={<TileIcon icon={<Icon />} tone={s.done_at ? 'mint' : k.tone} />}
                title={<span className={cn(s.done_at && 'text-muted-foreground line-through')}>{s.title}</span>}
                subtitle={
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span>{t(`saathi.stepKind.${s.kind}`, { defaultValue: s.kind })}</span>
                    {when && <span className="font-medium text-foreground/80">· {when}</span>}
                  </span>
                }
              />
            </li>
          )
        })}
      </ol>
      {steps.length > shown.length && <p className="text-sm text-muted-foreground">{t('saathi.cards.moreSteps', { count: steps.length - shown.length })}</p>}
      <SeeAll to={to.planItem(card.id)}>{t('saathi.cards.openPlan')}</SeeAll>
    </CardShell>
  )
}

/** Saved careers and every plan with its progress. */
export function MyPlanCard({ card }: { card: CardOf<'my_plan'> }) {
  const { t } = useTranslation()
  const label = useCareerLabel()
  const empty = !card.saved.length && !card.plans.length
  return (
    <CardShell icon={<Flag />} tone="highlight" title={t('saathi.cards.myPlan')}>
      {empty && <p className="text-muted-foreground">{t('saathi.cards.noPlan')}</p>}
      {card.plans.length > 0 && (
        <ul className="flex flex-col gap-2">
          {card.plans.map((p) => {
            const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
            return (
              <li key={p.id}>
                <RowLink
                  to={to.planItem(p.id)}
                  leading={<TileIcon icon={<MapIcon />} tone="lilac" />}
                  title={label(p.career_slug, p.title)}
                  subtitle={
                    <span className="flex items-center gap-2">
                      <Progress value={pct} className="h-2 flex-1" aria-label={t('saathi.cards.stepsDone', { done: p.done, total: p.total })} />
                      <span className="shrink-0 text-xs">{t('saathi.cards.stepsDone', { done: p.done, total: p.total })}</span>
                    </span>
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
      {card.saved.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.savedCareers')}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {card.saved.map((s) => (
              <ChipLink key={s} to={to.career(s)} tone="lilac">
                <Bookmark aria-hidden="true" className="size-4" />
                {label(s)}
              </ChipLink>
            ))}
          </div>
        </div>
      )}
      <SeeAll to={empty ? to.careers() : to.plan()}>{empty ? t('saathi.cards.allCareers') : t('saathi.cards.allPlans')}</SeeAll>
    </CardShell>
  )
}
