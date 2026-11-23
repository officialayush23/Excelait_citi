import { ArrowLeft, Compass } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { quiz, scoreQuiz, type Lang } from '@/engine/questions'

/** Skippable intro for the "Know yourself" quiz. */
export function QuizIntro({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-start gap-4">
      <span className="grid size-12 place-items-center rounded-2xl bg-tile-sky text-tile-foreground">
        <Compass aria-hidden="true" className="size-6" />
      </span>
      <div className="flex items-center gap-1">
        <h3 className="text-2xl font-semibold tracking-tight">{t('onboard.quiz.title')}</h3>
        <SpeakButton text={`${t('onboard.quiz.title')}. ${t('onboard.quiz.body')}`} />
      </div>
      <p className="max-w-prose text-muted-foreground">{t('onboard.quiz.body')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" className="h-12 rounded-full px-7 text-base" onClick={onStart}>
          {t('onboard.quiz.start')}
        </Button>
        <Button size="lg" variant="ghost" className="h-12 rounded-full" onClick={onSkip}>
          {t('onboard.quiz.notNow')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Eighteen short activity statements, three per interest type (RIASEC), answered like / not sure / dislike.
 * Plain text that can be read aloud; scores are worked out on the phone, so it works offline.
 */
export function InterestQuiz({ lang, onDone, onCancel }: { lang: Lang; onDone: (scores: Record<string, number>) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const items = quiz.items
  const item = items[i]
  const text = item.text[lang] ?? item.text.en

  function pick(v: number) {
    const next = { ...answers, [item.id]: v }
    setAnswers(next)
    if (i + 1 >= items.length) onDone(scoreQuiz(next))
    else setI(i + 1)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Progress value={(i / items.length) * 100} className="h-2" aria-label={t('onboard.quiz.count', { n: i + 1, total: items.length })} />
        <span className="shrink-0 text-sm text-muted-foreground">{t('onboard.quiz.count', { n: i + 1, total: items.length })}</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={item.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }} className="flex flex-col gap-5">
          <div>
            <p className="text-sm text-muted-foreground">{t('onboard.quiz.ask')}</p>
            <div className="flex items-center gap-1">
              <h3 className="text-2xl font-semibold tracking-tight">{text}</h3>
              <SpeakButton text={`${t('onboard.quiz.ask')} ${text}`} />
            </div>
          </div>
          <div role="radiogroup" className="grid gap-2.5 sm:grid-cols-3">
            {quiz.scale.map((s) => (
              <Button
                key={s.value}
                role="radio"
                aria-checked={answers[item.id] === s.value}
                variant={answers[item.id] === s.value ? 'default' : 'outline'}
                size="lg"
                className="h-14 rounded-2xl text-base"
                onClick={() => pick(s.value)}
              >
                {s.label[lang] ?? s.label.en}
              </Button>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
      <div>
        <Button variant="ghost" size="lg" className="rounded-full" onClick={() => (i === 0 ? onCancel() : setI(i - 1))}>
          <ArrowLeft data-icon="inline-start" />
          {t('onboard.back')}
        </Button>
      </div>
    </div>
  )
}
