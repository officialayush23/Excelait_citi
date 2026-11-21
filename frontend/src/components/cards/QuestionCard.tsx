import { CircleCheck, CornerRightDown, MessageCircleQuestion } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChipGroup, type ChipOption } from '@/components/student/Chips'
import { parseAnswer, useFactOptions } from '@/components/student/FactQuestion'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fields } from '@/data/catalogue'
import { useFacts } from '@/data/facts'
import { cn } from '@/lib/utils'

import { CardShell, useAskSaathi } from './kit'
import type { CardOf } from './types'

/** Tap answers for intake facts that are not scheme-rule fields. */
const EXTRA_CHOICES: Record<string, (string | number)[]> = {
  hours_per_week: [3, 5, 10, 15, 20, 30],
  can_travel_km: [0, 2, 5, 10, 25],
}
const YES_NO = new Set(['has_family_business', 'needs_income_soon', 'can_relocate'])
/** Facts best answered in the student's own words, in the box below. */
const TYPED = new Set(['district', 'skills', 'interests', 'subjects'])

function useChoices(field: string): ChipOption[] | null {
  const { t } = useTranslation()
  const known = useFactOptions(field)
  if (YES_NO.has(field)) return [{ value: 'true', label: t('common.yes') }, { value: 'false', label: t('common.no') }]
  if (EXTRA_CHOICES[field])
    return EXTRA_CHOICES[field].map((n) => ({ value: String(n), label: t(`saathi.choice.${field}`, { count: Number(n) }) }))
  return known
}

function parse(field: string, raw: string): unknown {
  if (YES_NO.has(field)) return raw === 'true'
  if (EXTRA_CHOICES[field]) return Number(raw)
  return parseAnswer(field, raw)
}

/**
 * Saathi needs one fact. The question is in the student's own words and language; the student
 * taps an answer (saved on the phone and synced, then Saathi is told in the student's language),
 * or, for things like their skills, types or speaks the answer in the box below.
 */
export function QuestionCard({ card, active }: { card: CardOf<'question'>; active?: boolean }) {
  const { t } = useTranslation()
  const field = card.field
  const facts = useFacts((s) => s.facts)
  const update = useFacts((s) => s.update)
  const sync = useFacts((s) => s.sync)
  const { ask, inChat, busy } = useAskSaathi()
  const [answered, setAnswered] = useState(false)
  const [num, setNum] = useState('')
  const choices = useChoices(field ?? '')
  if (!field) return null
  const known = answered || (!active && facts[field] != null)
  const question = card.question || t(`facts.${field}.q`, { defaultValue: t('saathi.cards.question') })
  const typed = TYPED.has(field) || (!choices && fields[field]?.type !== 'number')

  async function onAnswer(value: unknown) {
    if (!field) return
    setAnswered(true)
    await update({ [field]: value })
    // The server reads facts when it answers, so make sure this one has arrived first.
    await sync().catch(() => undefined)
    if (inChat) ask(card.answered || t('saathi.answered'))
  }

  return (
    <CardShell
      icon={<MessageCircleQuestion />}
      tone="sky"
      title={t('saathi.cards.question')}
      subtitle={t('saathi.cards.questionSub')}
      className={cn(active && !known && 'ring-3 ring-ring/50')}
    >
      {known ? (
        <p className="flex items-center gap-2 rounded-2xl bg-tile-mint p-4 font-medium text-tile-foreground" role="status">
          <CircleCheck aria-hidden="true" className="size-5" />
          {t('saathi.cards.thanksSaved')}
        </p>
      ) : (
        <fieldset disabled={busy} className="flex flex-col gap-4 disabled:opacity-60">
          <div className="flex items-center gap-1">
            <h3 className="text-lg font-semibold">{question}</h3>
            <SpeakButton text={question} />
          </div>
          {typed ? (
            <p className="flex items-center gap-2 rounded-2xl bg-tile-sky p-3 text-sm font-medium text-tile-foreground">
              <CornerRightDown aria-hidden="true" className="size-4 shrink-0" />
              {t('saathi.cards.answerBelow')}
            </p>
          ) : choices ? (
            <ChipGroup options={choices} value={[]} onChange={([v]) => void onAnswer(parse(field, v))} />
          ) : (
            <form
              className="flex max-w-xs gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const n = Number(num)
                if (num !== '' && n >= 0 && n <= 120) void onAnswer(n)
              }}
            >
              <Input
                inputMode="numeric"
                type="number"
                min={0}
                max={120}
                value={num}
                onChange={(e) => setNum(e.target.value)}
                aria-label={question}
                className="h-12 rounded-full px-5 text-lg"
              />
              <Button type="submit" size="lg" className="h-12 rounded-full px-6" disabled={num === ''}>
                {t('common.save')}
              </Button>
            </form>
          )}
        </fieldset>
      )}
    </CardShell>
  )
}
