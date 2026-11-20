import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChipGroup, type ChipOption } from '@/components/student/Chips'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fields } from '@/data/catalogue'
import { lakh } from '@/lib/format'

export const INCOME_TOP = 1000001
/** Yes/no facts used for career matching that are not part of any scheme rule. */
const EXTRA_BOOLEANS = new Set(['needs_income_soon', 'can_relocate'])

/** Answer choices for a fact, with labels a student understands. */
export function useFactOptions(field: string): ChipOption[] | null {
  const { t } = useTranslation()
  const f = fields[field]
  if (EXTRA_BOOLEANS.has(field) || f?.type === 'boolean') return [{ value: 'true', label: t('common.yes') }, { value: 'false', label: t('common.no') }]
  if (!f) return null
  if (field === 'family_income_annual')
    return [
      ...(f.options as number[]).map((n) => ({ value: String(n), label: t('facts.upTo', { amount: lakh(n) }) })),
      { value: String(INCOME_TOP), label: t('facts.moreThan', { amount: lakh(1000000) }) },
    ]
  if (field === 'class_level')
    return (f.options as number[]).map((n) => ({ value: String(n), label: n <= 12 ? t('facts.classN', { n }) : t('facts.collegeYear', { n: n - 12 }) }))
  if (f.options) return f.options.map((o) => ({ value: String(o), label: t(`facts.${field}.options.${o}`, { defaultValue: String(o) }) }))
  return null
}

export function parseAnswer(field: string, raw: string): unknown {
  const f = fields[field]
  if (EXTRA_BOOLEANS.has(field) || f?.type === 'boolean') return raw === 'true'
  if (f?.type === 'number') return Number(raw)
  return raw
}

type Props = { field: string; onAnswer: (value: unknown) => void; compact?: boolean }

/** One question about one fact: tap a chip, or type a number when there are no choices. */
export function FactQuestion({ field, onAnswer, compact }: Props) {
  const { t } = useTranslation()
  const options = useFactOptions(field)
  const [num, setNum] = useState('')
  const question = t(`facts.${field}.q`)
  const hint = t(`facts.${field}.hint`, { defaultValue: '' })
  const f = fields[field]
  const max = field === 'marks_percent' ? 100 : 120

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-1">
          <h3 className={compact ? 'text-lg font-semibold' : 'text-2xl font-semibold tracking-tight'}>{question}</h3>
          <SpeakButton text={hint ? `${question}. ${hint}` : question} />
        </div>
        {hint && <p className="mt-1 text-muted-foreground">{hint}</p>}
      </div>
      {options ? (
        <ChipGroup options={options} value={[]} onChange={([v]) => onAnswer(parseAnswer(field, v))} />
      ) : (
        <form
          className="flex max-w-xs gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(num)
            if (num !== '' && n >= 0 && n <= max) onAnswer(n)
          }}
        >
          <Input
            inputMode="decimal"
            type="number"
            min={0}
            max={max}
            value={num}
            onChange={(e) => setNum(e.target.value)}
            aria-label={question}
            className="h-12 rounded-full px-5 text-lg"
            placeholder={f?.unit === 'percent' ? '%' : ''}
          />
          <Button type="submit" size="lg" className="h-12 rounded-full px-6" disabled={num === ''}>
            {t('common.save')}
          </Button>
        </form>
      )}
    </div>
  )
}
