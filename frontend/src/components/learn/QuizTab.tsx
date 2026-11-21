import { CheckCircle2, RotateCcw, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

import { checkAnswer, submitQuiz, type CheckResult, type QuizQuestion, type QuizResult } from './api'

/** One question at a time, instant feedback with the explanation, score at the end. */
export function QuizTab({ lessonId, questions }: { lessonId: string; questions: QuizQuestion[] }) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<(number | null)[]>([])
  const [feedback, setFeedback] = useState<CheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<QuizResult | null>(null)
  const [error, setError] = useState(false)

  if (!questions.length) return <p className="text-muted-foreground">{t('learn.noQuiz')}</p>

  const q = questions[index]
  const chosen = answers[index] ?? null
  const last = index === questions.length - 1

  const choose = async (i: number) => {
    if (feedback || checking) return
    setChecking(true)
    setError(false)
    const next = [...answers]
    next[index] = i
    setAnswers(next)
    try {
      setFeedback(await checkAnswer(lessonId, index, i))
    } catch {
      setError(true)
      next[index] = null
      setAnswers([...next])
    } finally {
      setChecking(false)
    }
  }

  const advance = async () => {
    setFeedback(null)
    if (!last) return setIndex(index + 1)
    try {
      setResult(await submitQuiz(lessonId, questions.map((_, i) => answers[i] ?? null)))
    } catch {
      setError(true)
    }
  }

  const retry = () => {
    setIndex(0)
    setAnswers([])
    setFeedback(null)
    setResult(null)
    setError(false)
  }

  if (result) {
    const good = result.score >= 60
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">{t('learn.yourScore')}</p>
        <p className="text-5xl font-semibold tracking-tight">{result.right} / {result.total}</p>
        <p className="text-lg">{good ? t('learn.scoreGood') : t('learn.scoreTryAgain')}</p>
        <Button onClick={retry} className="h-14 rounded-full px-8 text-lg"><RotateCcw data-icon="inline-start" />{t('learn.retryQuiz')}</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Progress value={((index + (feedback ? 1 : 0)) / questions.length) * 100} className="h-2 flex-1" />
        <span className="shrink-0 text-sm text-muted-foreground">{t('learn.questionOf', { n: index + 1, total: questions.length })}</span>
      </div>
      <h3 className="text-xl font-semibold leading-snug">{q.prompt}</h3>
      <div className="grid gap-3">
        {q.options.map((o, i) => {
          const isRight = feedback && i === feedback.answer_index
          const isWrongPick = feedback && i === chosen && !feedback.correct
          return (
            <button
              key={i}
              type="button"
              disabled={!!feedback || checking}
              onClick={() => void choose(i)}
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left text-lg transition-colors',
                !feedback && 'hover:bg-muted',
                checking && chosen === i && 'opacity-70',
                isRight && 'border-success bg-success/15',
                isWrongPick && 'border-destructive bg-destructive/10',
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full border text-base">{String.fromCharCode(65 + i)}</span>
              <span className="flex-1">{o}</span>
              {isRight && <CheckCircle2 className="size-6 text-success" />}
              {isWrongPick && <XCircle className="size-6 text-destructive" />}
            </button>
          )
        })}
      </div>
      {feedback && (
        <div className={cn('rounded-2xl p-4', feedback.correct ? 'bg-success/15' : 'bg-destructive/10')} aria-live="polite">
          <p className="text-lg font-semibold">{feedback.correct ? t('learn.correct') : t('learn.wrong')}</p>
          {feedback.explanation && <p className="mt-1">{feedback.explanation}</p>}
        </div>
      )}
      {error && <p className="text-amber-600 dark:text-amber-400">{t('learn.tryAgain')}</p>}
      {feedback && (
        <Button onClick={() => void advance()} className="h-14 rounded-full text-lg">{last ? t('learn.seeScore') : t('learn.next')}</Button>
      )}
    </div>
  )
}
