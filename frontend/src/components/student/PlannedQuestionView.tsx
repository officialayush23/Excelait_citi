import { ArrowRight, Info } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SpeakButton } from '@/components/shell/SpeakButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChipGroup } from '@/components/student/Chips'
import { DistrictQuestion } from '@/components/student/DistrictQuestion'
import type { PlannedQuestion } from '@/engine/questions'

type Props = {
  question: PlannedQuestion
  /** Already saved answer, to pre-select when the student comes back to a question. */
  current?: unknown
  onAnswer: (patch: Record<string, unknown>) => void
}

/** The facts to save for an answer: the value plus whatever the picked options also set. */
export function patchFor(q: PlannedQuestion, picked: PlannedQuestion['options']): Record<string, unknown> {
  const patch: Record<string, unknown> = { [q.field]: q.type === 'multi' ? picked.map((o) => o.value) : picked[0]?.value }
  for (const o of picked) {
    for (const [k, v] of Object.entries(o.sets ?? {})) {
      patch[k] = Array.isArray(v) && Array.isArray(patch[k]) ? [...new Set([...(patch[k] as unknown[]), ...v])] : v
    }
  }
  return patch
}

/** One planner question: the question, read-aloud, a hint, and a small line saying why we ask. */
export function PlannedQuestionView({ question: q, current, onAnswer }: Props) {
  if (q.type === 'district')
    return <DistrictQuestion title={q.text ?? undefined} hint={q.hint} why={q.why} onAnswer={(d) => onAnswer({ district: d })} />
  return <Inner key={q.id} question={q} current={current} onAnswer={onAnswer} />
}

function Inner({ question: q, current, onAnswer }: Props) {
  const { t } = useTranslation()
  const idx = (v: unknown) => q.options.findIndex((o) => o.value === v)
  const initial = Array.isArray(current) ? current.map(idx).filter((i) => i >= 0).map(String) : []
  const [multi, setMulti] = useState<string[]>(initial)
  const [num, setNum] = useState(typeof current === 'number' ? String(current) : '')
  const [min, max] = [q.min ?? 0, q.max ?? 120]
  const opts = q.options.map((o, i) => ({ value: String(i), label: o.label }))

  let body: ReactNode
  if (q.type === 'single')
    body = <ChipGroup options={opts} value={idx(current) >= 0 ? [String(idx(current))] : []} onChange={([i]) => onAnswer(patchFor(q, [q.options[Number(i)]]))} />
  else if (q.type === 'multi')
    body = (
      <>
        <ChipGroup multiple max={q.max_select ?? q.options.length} options={opts} value={multi} onChange={setMulti} />
        <Button size="lg" className="mt-2 h-12 self-start rounded-full px-7 text-base" disabled={!multi.length} onClick={() => onAnswer(patchFor(q, multi.map((i) => q.options[Number(i)])))}>
          {t('onboard.next')}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </>
    )
  else
    body = (
      <form
        className="flex max-w-xs gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const n = Number(num)
          if (num !== '' && n >= min && n <= max) onAnswer({ [q.field]: n })
        }}
      >
        <Input inputMode="decimal" type="number" min={min} max={max} value={num} onChange={(e) => setNum(e.target.value)} aria-label={q.text ?? q.field} className="h-12 rounded-full px-5 text-lg" />
        <Button type="submit" size="lg" className="h-12 rounded-full px-6" disabled={num === '' || Number(num) < min || Number(num) > max}>
          {t('onboard.save')}
        </Button>
      </form>
    )

  const title = q.text ?? q.field
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-2xl font-semibold tracking-tight">{title}</h3>
          <SpeakButton text={[title, q.hint, q.why].filter(Boolean).join('. ')} />
          {q.sensitive && <Badge variant="outline">{t('onboard.sensitive')}</Badge>}
        </div>
        {q.hint && <p className="mt-1 text-muted-foreground">{q.hint}</p>}
        {q.why && (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground/80">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {q.why}
          </p>
        )}
      </div>
      {body}
    </div>
  )
}
