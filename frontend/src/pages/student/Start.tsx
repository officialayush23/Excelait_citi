import { ArrowLeft, ArrowRight, Keyboard, MessageCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { PageHeader } from '@/components/page/PageHeader'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { ChipGroup } from '@/components/student/Chips'
import { FactQuestion } from '@/components/student/FactQuestion'
import { GuideChat } from '@/components/student/GuideChat'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { interestTags, subjectTags } from '@/data/catalogue'
import { useFacts } from '@/data/facts'

/** Where the student is studying, mapped onto the facts the rules use. */
const STAGES: Record<string, { class_level: number; course: string }> = {
  c8: { class_level: 8, course: 'school' },
  c9: { class_level: 9, course: 'school' },
  c10: { class_level: 10, course: 'school' },
  c11: { class_level: 11, course: 'school' },
  c12: { class_level: 12, course: 'school' },
  iti: { class_level: 13, course: 'iti' },
  diploma: { class_level: 13, course: 'diploma' },
  ug_degree: { class_level: 13, course: 'ug_degree' },
  ug_technical: { class_level: 13, course: 'ug_technical' },
  pg: { class_level: 16, course: 'pg' },
  none: { class_level: 13, course: 'none' },
}

type Step = { key: string; optional?: boolean; when?: (f: Record<string, unknown>) => boolean }
/** Things a student may already be able to do; saved as the `skills` fact. */
const SKILLS = ['phone_repair', 'cooking', 'stitching', 'farming', 'computer_basics', 'drawing', 'teaching_kids', 'selling', 'two_wheeler', 'electrical_basics']

// One question per screen, in this order. Hours a week is asked only of students who need to earn soon.
const STEPS: Step[] = [
  { key: 'stage' },
  { key: 'age' },
  { key: 'state' },
  { key: 'district', optional: true },
  { key: 'interests' },
  { key: 'skills', optional: true },
  { key: 'subjects' },
  { key: 'marks_percent', optional: true },
  { key: 'school_type', when: (f) => f.course === 'school' },
  { key: 'needs_income_soon' },
  { key: 'hours_per_week', when: (f) => f.needs_income_soon === true },
  { key: 'can_relocate' },
  { key: 'family_income_annual', optional: true },
  { key: 'social_category', optional: true },
  { key: 'gender', optional: true },
]

export function Start() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { facts, update } = useFacts()
  const [mode, setMode] = useState<'tap' | 'talk'>('tap')
  const [i, setI] = useState(0)
  const [multi, setMulti] = useState<string[]>([])
  const steps = useMemo(() => STEPS.filter((s) => !s.when || s.when(facts)), [facts])
  const step = steps[Math.min(i, steps.length - 1)]

  function next() {
    setMulti([])
    if (i + 1 >= steps.length) navigate('/app/careers')
    else setI(i + 1)
  }

  async function answer(patch: Record<string, unknown>) {
    await update(patch, { replaceLists: true })
    next()
  }

  function body() {
    if (step.key === 'stage')
      return (
        <Question title={t('start.stage.q')}>
          <ChipGroup options={Object.keys(STAGES).map((k) => ({ value: k, label: t(`start.stage.${k}`) }))} value={[]} onChange={([k]) => void answer(STAGES[k])} />
        </Question>
      )
    if (step.key === 'interests' || step.key === 'subjects' || step.key === 'skills') {
      const tags = step.key === 'interests' ? interestTags : step.key === 'subjects' ? subjectTags : SKILLS
      const label = (k: string) => (step.key === 'skills' ? t(`start.skills.options.${k}`) : t(`tags.${k}`))
      const current = multi.length ? multi : ((facts[step.key] as string[]) ?? [])
      return (
        <Question title={t(`start.${step.key}.q`)} hint={t(`start.${step.key}.hint`)}>
          <ChipGroup multiple max={step.key === 'interests' ? 5 : step.key === 'subjects' ? 4 : SKILLS.length} options={tags.map((k) => ({ value: k, label: label(k) }))} value={current} onChange={setMulti} />
          <Button size="lg" className="mt-6 h-12 rounded-full px-7 text-base" disabled={!current.length} onClick={() => void answer({ [step.key]: current })}>
            {t('common.next')}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </Question>
      )
    }
    return <FactQuestion key={step.key} field={step.key} onAnswer={(v) => void answer({ [step.key]: v })} />
  }

  return (
    <>
      <PageHeader
        title={t('start.title')}
        subtitle={t('start.subtitle')}
        back
        actions={
          <Button variant="outline" size="lg" className="h-11 rounded-full" onClick={() => setMode(mode === 'tap' ? 'talk' : 'tap')}>
            {mode === 'tap' ? <MessageCircle data-icon="inline-start" /> : <Keyboard data-icon="inline-start" />}
            {mode === 'tap' ? t('start.talkInstead') : t('start.tapInstead')}
          </Button>
        }
      />
      {mode === 'talk' ? (
        <GuideChat />
      ) : (
        <div className="rounded-3xl border bg-card p-5 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <Progress value={((i + 1) / steps.length) * 100} className="h-2" aria-label={t('start.progress', { n: i + 1, total: steps.length })} />
            <span className="shrink-0 text-sm text-muted-foreground">
              {i + 1}/{steps.length}
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={step.key} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
              {body()}
            </motion.div>
          </AnimatePresence>
          <div className="mt-8 flex justify-between gap-2">
            <Button variant="ghost" size="lg" className="rounded-full" disabled={i === 0} onClick={() => setI(i - 1)}>
              <ArrowLeft data-icon="inline-start" />
              {t('common.back')}
            </Button>
            <Button variant="ghost" size="lg" className="rounded-full" onClick={next}>
              {step.optional ? t('start.preferNot') : t('start.skip')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

function Question({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-1">
          <h3 className="text-2xl font-semibold tracking-tight">{title}</h3>
          <SpeakButton text={hint ? `${title}. ${hint}` : title} />
        </div>
        {hint && <p className="mt-1 text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}
