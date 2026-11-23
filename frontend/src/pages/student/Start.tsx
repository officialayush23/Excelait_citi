import { ArrowLeft, Keyboard, MessageCircle, WifiOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PageHeader } from '@/components/page/PageHeader'
import { GuideChat } from '@/components/student/GuideChat'
import { InterestQuiz, QuizIntro } from '@/components/student/InterestQuiz'
import { LearnedSummary } from '@/components/student/LearnedSummary'
import { PlannedQuestionView } from '@/components/student/PlannedQuestionView'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useFacts } from '@/data/facts'
import { nextQuestions, type Lang, type NextQuestions, type PlannedQuestion } from '@/engine/questions'
import { api } from '@/lib/api'
import { useUi } from '@/stores/ui'

type Phase = 'questions' | 'quizIntro' | 'quiz' | 'summary'

/**
 * Onboarding, one question per screen. The server's question planner picks each next question from
 * what is already known (also from Saathi chats), so nobody is asked what does not fit them. The core
 * is short; then an optional "Know yourself" interest quiz, then a read-back of what we learned.
 * Offline, the same planner runs on the phone from the bundled questions file.
 */
export function Start() {
  const { t } = useTranslation()
  const ui = useUi((s) => s.language)
  const lang: Lang = ui === 'hi' || ui === 'mr' ? ui : 'en'
  const facts = useFacts((s) => s.facts)
  const update = useFacts((s) => s.update)
  const sync = useFacts((s) => s.sync)
  const [mode, setMode] = useState<'tap' | 'talk'>('tap')
  const [phase, setPhase] = useState<Phase>('questions')
  const [tier, setTier] = useState<'core' | 'more'>('core')
  const [skip, setSkip] = useState<string[]>([])
  const [history, setHistory] = useState<PlannedQuestion[]>([])
  const [current, setCurrent] = useState<PlannedQuestion | null>(null)
  const [plan, setPlan] = useState<NextQuestions | null>(null)
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const run = useRef(0)

  const load = useCallback(
    async (opts: { skip: string[]; tier: 'core' | 'more' }) => {
      const id = ++run.current
      setLoading(true)
      let res: NextQuestions
      try {
        // The server reads saved facts, so send the latest answer first.
        await sync()
        if (useFacts.getState().pending) throw new Error('unsynced')
        const qs = new URLSearchParams({ context: 'onboarding', limit: '1', lang, skip: opts.skip.join(',') })
        res = await api<NextQuestions>(`/api/v1/students/me/next-questions?${qs}`)
        if (id === run.current) setOffline(false)
      } catch {
        res = nextQuestions(useFacts.getState().facts, 'onboarding', 1, { lang, skip: opts.skip })
        if (id === run.current) setOffline(!navigator.onLine)
      }
      if (id !== run.current) return
      setPlan(res)
      setLoading(false)
      const q = res.questions[0] ?? null
      if (opts.tier === 'core' && res.phase !== 'core') {
        setCurrent(null)
        setPhase(res.quiz_done ? 'summary' : 'quizIntro')
      } else if (!q) {
        setCurrent(null)
        setPhase('summary')
      } else {
        setCurrent(q)
        setPhase('questions')
      }
    },
    [lang, sync],
  )

  useEffect(() => {
    void load({ skip: [], tier: 'core' })
  }, [load])

  async function answer(patch: Record<string, unknown>) {
    if (current) setHistory((h) => [...h, current])
    await update(patch, { replaceLists: true, source: 'onboarding' })
    await load({ skip, tier })
  }

  function skipOne() {
    if (!current) return
    const next = [...skip, current.field]
    setHistory((h) => [...h, current])
    setSkip(next)
    void load({ skip: next, tier })
  }

  function back() {
    const prev = history[history.length - 1]
    if (!prev) return
    run.current++ // drop any answer still loading
    setHistory((h) => h.slice(0, -1))
    setSkip((s) => s.filter((f) => f !== prev.field))
    setCurrent(prev)
    setPhase('questions')
    setLoading(false)
  }

  async function quizDone(scores: Record<string, number>) {
    await update({ riasec: scores }, { source: 'quiz' })
    void sync()
    setPhase('summary')
  }

  function more() {
    setTier('more')
    setHistory([])
    void load({ skip, tier: 'more' })
  }

  const pct = plan?.completeness.pct ?? 0

  function body() {
    if (phase === 'quizIntro') return <QuizIntro onStart={() => setPhase('quiz')} onSkip={() => setPhase('summary')} />
    if (phase === 'quiz') return <InterestQuiz lang={lang} onDone={(s) => void quizDone(s)} onCancel={() => setPhase('quizIntro')} />
    if (phase === 'summary')
      return (
        <LearnedSummary
          lang={lang}
          moreLeft={plan ? plan.remaining.core + plan.remaining.more : 0}
          onMore={more}
          onQuiz={facts.riasec ? undefined : () => setPhase('quiz')}
        />
      )
    if (loading || !current)
      return (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((k) => (
              <Skeleton key={k} className="h-12 w-28 rounded-full" />
            ))}
          </div>
        </div>
      )
    return <PlannedQuestionView question={current} current={facts[current.field]} onAnswer={(p) => void answer(p)} />
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
          {phase === 'questions' && (
            <div className="mb-6 flex flex-col gap-2">
              {tier === 'more' && <p className="text-sm font-medium">{t('onboard.moreTitle')}</p>}
              <div className="flex items-center gap-3">
                <Progress value={pct} className="h-2" aria-label={t('onboard.progress', { pct })} />
                <span className="shrink-0 text-sm text-muted-foreground">{t('onboard.progress', { pct })}</span>
              </div>
              {offline && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <WifiOff aria-hidden="true" className="size-4" />
                  {t('onboard.offline')}
                </p>
              )}
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div
              key={phase === 'questions' ? (current?.id ?? 'loading') : phase}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
            >
              {body()}
            </motion.div>
          </AnimatePresence>
          {phase === 'questions' && (
            <div className="mt-8 flex justify-between gap-2">
              <Button variant="ghost" size="lg" className="rounded-full" disabled={!history.length} onClick={back}>
                <ArrowLeft data-icon="inline-start" />
                {t('onboard.back')}
              </Button>
              <Button variant="ghost" size="lg" className="rounded-full" disabled={!current || loading} onClick={skipOne}>
                {current?.sensitive ? t('start.preferNot') : t('onboard.skip')}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
