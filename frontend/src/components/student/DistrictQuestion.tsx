import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SpeakButton } from '@/components/shell/SpeakButton'
import { ChipGroup } from '@/components/student/Chips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DISTRICTS } from '@/data/districts'
import { useFacts } from '@/data/facts'

/** District as typed text; tap a suggestion for the chosen state, or type any other district. */
export function DistrictQuestion({ onAnswer, compact }: { onAnswer: (value: string) => void; compact?: boolean }) {
  const { t } = useTranslation()
  const state = useFacts((s) => s.facts.state)
  const [text, setText] = useState('')
  const question = t('facts.district.q')
  const hint = t('facts.district.hint', { defaultValue: '' })
  const all = typeof state === 'string' ? (DISTRICTS[state] ?? []) : []
  const typed = text.trim().toLowerCase()
  const shown = (typed ? all.filter((d) => d.toLowerCase().includes(typed)) : all).slice(0, 8)
  const submit = (v: string) => {
    const d = v.trim().replace(/\s+/g, ' ').slice(0, 60)
    if (d) onAnswer(d)
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-1">
          <h3 className={compact ? 'text-lg font-semibold' : 'text-2xl font-semibold tracking-tight'}>{question}</h3>
          <SpeakButton text={hint ? `${question}. ${hint}` : question} />
        </div>
        {hint && <p className="mt-1 text-muted-foreground">{hint}</p>}
      </div>
      {shown.length > 0 && <ChipGroup options={shown.map((d) => ({ value: d, label: d }))} value={[]} onChange={([v]) => submit(v)} />}
      <form
        className="flex max-w-sm gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={60} aria-label={question} placeholder={t('facts.district.placeholder')} className="h-12 rounded-full px-5 text-lg" />
        <Button type="submit" size="lg" className="h-12 rounded-full px-6" disabled={!text.trim()}>
          {t('common.save')}
        </Button>
      </form>
    </div>
  )
}
