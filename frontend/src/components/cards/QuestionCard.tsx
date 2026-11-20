import { CircleCheck, MessageCircleQuestion } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FactQuestion } from '@/components/student/FactQuestion'
import { useFacts } from '@/data/facts'

import { CardShell, useAskSaathi } from './kit'
import type { CardOf } from './types'

/**
 * Saathi needs one fact: the student taps an answer, it is saved on the phone (and synced),
 * then Saathi is told so it can carry on with the new fact.
 */
export function QuestionCard({ card }: { card: CardOf<'question'> }) {
  const { t } = useTranslation()
  const field = card.field
  const facts = useFacts((s) => s.facts)
  const update = useFacts((s) => s.update)
  const sync = useFacts((s) => s.sync)
  const { ask, inChat, busy } = useAskSaathi()
  const [answered, setAnswered] = useState(false)
  if (!field) return null
  const known = answered || facts[field] != null

  async function onAnswer(value: unknown) {
    if (!field) return
    setAnswered(true)
    await update({ [field]: value })
    // The server reads facts when it answers, so make sure this one has arrived first.
    await sync().catch(() => undefined)
    if (inChat) ask(t('saathi.answered'))
  }

  return (
    <CardShell icon={<MessageCircleQuestion />} tone="sky" title={t('saathi.cards.question')} subtitle={t('saathi.cards.questionSub')}>
      {known ? (
        <p className="flex items-center gap-2 rounded-2xl bg-tile-mint p-4 font-medium text-tile-foreground" role="status">
          <CircleCheck aria-hidden="true" className="size-5" />
          {t('saathi.cards.thanksSaved')}
        </p>
      ) : (
        <fieldset disabled={busy} className="disabled:opacity-60">
          <FactQuestion field={field} compact onAnswer={(v) => void onAnswer(v)} />
        </fieldset>
      )}
    </CardShell>
  )
}
