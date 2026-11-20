import { BookOpen, BriefcaseBusiness, CalendarDays, Compass, GraduationCap, MapPin, Sparkles, Wallet } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { SpeakButton } from '@/components/shell/SpeakButton'
import { payRange } from '@/lib/format'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

import { CardShell, ChipLink, MakePlanButton, ResultBadge, RowLink, SaveButton, SectionLabel, SeeAll, TileIcon, useDateText, useName } from './kit'
import { ResourceRows } from './places'
import type { CardOf, CareerItem, ExamRef, MatchReason, SchemeStatus } from './types'

function useReasonText() {
  const { t } = useTranslation()
  const tags = (d: (string | number)[]) => d.map((x) => t(`tags.${x}`, { defaultValue: String(x) })).join(', ')
  return (r: MatchReason) => t(`reasons.${r.code}`, { items: tags(r.detail), n: r.detail[0], defaultValue: '' })
}

function usePay() {
  const { t } = useTranslation()
  return (min: number | null, max: number | null) => {
    const range = payRange(min, max)
    return range ? t('saathi.payMonth', { range }) : null
  }
}

/* ---------------- careers: a ranked list ---------------- */

function CareerRow({ item, index }: { item: CareerItem; index: number }) {
  const { t } = useTranslation()
  const name = useName()
  const reason = useReasonText()
  const pay = usePay()
  const top = item.reasons[0] ? reason(item.reasons[0]) : ''
  const p = pay(item.pay_min, item.pay_max)
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-center gap-2"
    >
      <RowLink
        to={to.career(item.slug)}
        className="flex-1"
        leading={
          <span
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-tile-lilac text-base font-semibold text-tile-foreground"
            aria-label={t('saathi.matchScore', { score: item.score })}
          >
            {item.score}
          </span>
        }
        title={name(item)}
        subtitle={
          <>
            {top && <span className="line-clamp-1">{top}</span>}
            {p && <span className="mt-0.5 flex items-center gap-1 font-medium text-foreground/80"><Wallet aria-hidden="true" className="size-3.5" />{p}</span>}
          </>
        }
      />
      <SaveButton slug={item.slug} compact />
    </motion.li>
  )
}

export function CareersCard({ card }: { card: CardOf<'careers'> }) {
  const { t } = useTranslation()
  const wi = card.what_if ?? {}
  const notes = [wi.can_relocate !== undefined && t(wi.can_relocate ? 'saathi.whatIf.relocate' : 'saathi.whatIf.stay'), wi.needs_income_soon && t('saathi.whatIf.earnSoon')].filter(Boolean) as string[]
  return (
    <CardShell icon={<Compass />} tone="lilac" title={t('saathi.cards.careers')} subtitle={t('saathi.cards.careersSub', { count: card.items.length })}>
      {notes.length > 0 && (
        <p className="flex flex-wrap gap-2">
          {notes.map((n) => (
            <span key={n} className="rounded-full bg-tile-sky px-3 py-1 text-sm text-tile-foreground">{n}</span>
          ))}
        </p>
      )}
      {card.items.length ? (
        <ul className="flex flex-col gap-2">
          {card.items.map((item, i) => (
            <CareerRow key={item.slug} item={item} index={i} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('saathi.cards.noneFound')}</p>
      )}
      <SeeAll to={to.careers()}>{t('saathi.cards.allCareers')}</SeeAll>
    </CardShell>
  )
}

/* ---------------- shared lists ---------------- */

function ExamRows({ exams }: { exams: ExamRef[] }) {
  const { t } = useTranslation()
  const date = useDateText()
  return (
    <ul className="flex flex-col gap-2">
      {exams.map((e) => (
        <li key={e.slug}>
          <RowLink
            to={to.exam(e.slug)}
            leading={<TileIcon icon={<CalendarDays />} tone="sky" />}
            title={e.name}
            subtitle={e.next ? t('saathi.nextAround', { date: date(e.next) }) : undefined}
          />
        </li>
      ))}
    </ul>
  )
}

export function SchemeRows({ schemes }: { schemes: SchemeStatus[] }) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col gap-2">
      {schemes.map((s) => (
        <li key={s.slug}>
          <RowLink
            to={to.scheme(s.slug)}
            leading={<TileIcon icon={<Wallet />} tone="peach" />}
            title={s.name}
            subtitle={s.result === 'needs_info' ? t('saathi.answerToUnlock') : s.benefit_amount ? `₹${s.benefit_amount.toLocaleString('en-IN')}` : undefined}
            trailing={<ResultBadge result={s.result} />}
          />
        </li>
      ))}
    </ul>
  )
}

/* ---------------- career: the full connected view ---------------- */

export function CareerCard({ card }: { card: CardOf<'career'> }) {
  const { t } = useTranslation()
  const name = useName()
  const pay = usePay()
  const title = name(card)
  const p = pay(card.pay_min, card.pay_max)
  const schemes = [...card.schemes].filter((s) => s.result !== 'not_eligible').concat(card.schemes.filter((s) => s.result === 'not_eligible'))

  return (
    <CardShell
      icon={<BriefcaseBusiness />}
      tone="lilac"
      title={title}
      subtitle={t(`categories.${card.category}`, { defaultValue: card.category })}
      action={<SpeakButton text={[title, p, card.path.join(', ')].filter(Boolean).join('. ')} />}
    >
      <div className="flex flex-wrap gap-2">
        {p && <span className="inline-flex items-center gap-1.5 rounded-full bg-tile-mint px-3 py-1.5 text-sm font-semibold text-tile-foreground"><Wallet aria-hidden="true" className="size-4" />{p}</span>}
        {card.earning_speed && <span className="rounded-full bg-surface px-3 py-1.5 text-sm">{t(`speed.${card.earning_speed}`, { defaultValue: card.earning_speed })}</span>}
        {card.needs_city && <span className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-sm"><MapPin aria-hidden="true" className="size-3.5" />{t('saathi.mostlyCity')}</span>}
      </div>

      {card.path.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.path')}</SectionLabel>
          <ol className="flex flex-col">
            {card.path.map((step, i) => (
              <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                {i < card.path.length - 1 && <span aria-hidden="true" className="absolute top-8 bottom-0 left-[0.9rem] w-0.5 bg-border" />}
                <span className={cn('z-10 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', i === card.path.length - 1 ? 'bg-highlight text-highlight-foreground' : 'bg-tile-lilac text-tile-foreground')}>
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {card.programs.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.courses')}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {card.programs.map((pr) => (
              <ChipLink key={pr.slug} to={to.course(pr.slug)} tone="sky">
                <GraduationCap aria-hidden="true" className="size-4" />
                {name(pr)}
                {pr.duration_months ? <span className="opacity-70">· {t('saathi.months', { count: pr.duration_months })}</span> : null}
              </ChipLink>
            ))}
          </div>
        </div>
      )}

      {card.exams.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.exams')}</SectionLabel>
          <ExamRows exams={card.exams.slice(0, 4)} />
        </div>
      )}

      {schemes.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.money')}</SectionLabel>
          <SchemeRows schemes={schemes.slice(0, 4)} />
        </div>
      )}

      {card.resources.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.learn')}</SectionLabel>
          <ResourceRows items={card.resources.slice(0, 3)} />
        </div>
      )}

      {card.related.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.related')}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {card.related.map((r) => (
              <ChipLink key={r.slug} to={to.career(r.slug)}>
                {name(r)}
              </ChipLink>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-2 border-t pt-4">
        <MakePlanButton career={card.slug} />
        <SaveButton slug={card.slug} initial={card.saved} />
      </div>
    </CardShell>
  )
}

/* ---------------- program (course) ---------------- */

export function ProgramCard({ card }: { card: CardOf<'program'> }) {
  const { t } = useTranslation()
  const name = useName()
  const facts = [
    card.duration_months ? t('saathi.months', { count: card.duration_months }) : null,
    card.entry ? t('saathi.entryAfter', { entry: t(`saathi.entry.${card.entry}`, { defaultValue: card.entry }) }) : null,
  ].filter(Boolean) as string[]
  return (
    <CardShell icon={<GraduationCap />} tone="sky" title={name(card)} subtitle={card.where ?? undefined}>
      {facts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {facts.map((f) => (
            <span key={f} className="rounded-full bg-surface px-3 py-1.5 text-sm">{f}</span>
          ))}
        </div>
      )}
      {card.exams.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.exams')}</SectionLabel>
          <ExamRows exams={card.exams} />
        </div>
      )}
      {card.schemes.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.money')}</SectionLabel>
          <SchemeRows schemes={card.schemes.slice(0, 4)} />
        </div>
      )}
      {card.careers.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.leadsTo')}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {card.careers.map((c) => (
              <ChipLink key={c.slug} to={to.career(c.slug)} tone="lilac">{name(c)}</ChipLink>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <SeeAll to={to.course(card.slug)}>{t('saathi.cards.openCourse')}</SeeAll>
        {card.college_kind && <SeeAll to={to.colleges({ kind: card.college_kind })}>{t('saathi.cards.whereToStudy')}</SeeAll>}
      </div>
    </CardShell>
  )
}

/* ---------------- exam ---------------- */

export function ExamCard({ card }: { card: CardOf<'exam'> }) {
  const { t } = useTranslation()
  const name = useName()
  const date = useDateText()
  return (
    <CardShell icon={<CalendarDays />} tone="sky" title={card.name} subtitle={card.conducting_body ?? undefined}>
      {card.next && (
        <div className="flex items-center gap-3 rounded-2xl bg-tile-peach p-4 text-tile-foreground">
          <Sparkles aria-hidden="true" className="size-5 shrink-0" />
          <div>
            <p className="text-sm opacity-75">{t('saathi.usuallyHeld')}</p>
            <p className="text-xl font-semibold">{date(card.next)}</p>
          </div>
        </div>
      )}
      {card.eligibility && (
        <div>
          <SectionLabel>{t('saathi.cards.whoCanSit')}</SectionLabel>
          <p className="line-clamp-3">{card.eligibility}</p>
        </div>
      )}
      {card.careers.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.leadsTo')}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {card.careers.slice(0, 6).map((c) => (
              <ChipLink key={c.slug} to={to.career(c.slug)} tone="lilac">{name(c)}</ChipLink>
            ))}
          </div>
        </div>
      )}
      {card.resources.length > 0 && (
        <div>
          <SectionLabel>{t('saathi.cards.prepare')}</SectionLabel>
          <ResourceRows items={card.resources.slice(0, 3)} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <SeeAll to={to.exam(card.slug)}>{t('saathi.cards.openExam')}</SeeAll>
        <SeeAll to={to.learn({ exam: card.slug })}>
          <BookOpen aria-hidden="true" className="size-4" />
          {t('saathi.cards.studyFor')}
        </SeeAll>
      </div>
    </CardShell>
  )
}
