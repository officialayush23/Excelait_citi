import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, ChevronDown, Lock, Sparkles, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDateText } from '@/components/cards/kit'
import { cn } from '@/lib/utils'

import { DaysText, ProgressRing, RefChips, useStepText } from './parts'
import type { RoadmapStep } from './types'

type Props = {
  step: RoadmapStep
  goalTitle?: string
  last?: boolean
  onStatus: (status: 'done' | 'todo') => void
  onSubtask: (id: string, done: boolean) => void
  busy?: boolean
}

/** One node on the chain: ring, status, date with days left, fixed-date badge, links, and an expandable "what to do now". */
export function StepNode({ step: s, goalTitle, last, onStatus, onSubtask, busy }: Props) {
  const { t } = useTranslation()
  const date = useDateText()
  const text = useStepText()
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(s.bucket === 'now')
  const done = s.status === 'done'
  const micro = s.kind === 'micro'
  const stretch = s.kind === 'stretch'
  return (
    <li className="relative flex gap-3 sm:gap-4">
      {/* the connecting path */}
      <div className="flex flex-col items-center">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? t('roadmap.markNotDone', { step: s.title }) : t('roadmap.markDone', { step: s.title })}
          disabled={busy}
          onClick={() => onStatus(done ? 'todo' : 'done')}
          className="relative grid place-items-center rounded-full bg-card focus-visible:ring-2 focus-visible:ring-ring"
        >
          {done ? (
            <span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="size-6" /></span>
          ) : (
            <ProgressRing value={s.progress} size={48} label={t('roadmap.stepPct', { pct: s.progress })} />
          )}
        </button>
        {!last && <span className={cn('mt-1 w-0.5 flex-1 rounded-full', done ? 'bg-primary/60' : 'bg-border')} aria-hidden="true" />}
      </div>

      <div className={cn('mb-4 min-w-0 flex-1 rounded-[1.5rem] border bg-card p-4 shadow-xs', s.bucket === 'now' && 'border-primary/50 ring-1 ring-primary/20', done && 'opacity-70', micro && 'border-dashed')}>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">{t(`roadmap.kind.${s.kind}`, { defaultValue: s.kind })}</span>
          {micro && <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary"><Zap className="size-3" />{t('roadmap.small')}</span>}
          {stretch && <span className="inline-flex items-center gap-1 rounded-full bg-tile-lilac px-2 py-0.5 font-medium text-tile-foreground"><Sparkles className="size-3" />{t('roadmap.optional')}</span>}
          {s.hard_deadline && <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', s.at_risk ? 'bg-destructive/15 text-destructive' : 'bg-tile-peach text-tile-foreground')}><Lock className="size-3" />{s.at_risk ? t('roadmap.atRisk') : t('roadmap.fixedDate')}</span>}
          {s.done_by && done && <span className="text-muted-foreground">{s.done_by === 'evidence' ? t('roadmap.noticed') : t('roadmap.youMarked')}</span>}
          {goalTitle && <span className="truncate text-muted-foreground">· {goalTitle}</span>}
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1.5 flex w-full items-start justify-between gap-2 text-left">
          <span className={cn('font-semibold leading-snug', done && 'line-through')}>{s.title}</span>
          <ChevronDown className={cn('mt-0.5 size-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        {s.due_date && (
          <p className="mt-1 text-sm text-muted-foreground">
            {date(s.due_date)}{!done && s.days_left !== null && s.days_left !== undefined && <> · <span className={cn(s.at_risk && 'font-semibold text-destructive')}><DaysText days={s.days_left} /></span></>}
          </p>
        )}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.2 }} className="overflow-hidden"
            >
              <div className="mt-3 flex flex-col gap-3">
                {text.why(s) && <p className="text-sm text-muted-foreground">{text.why(s)}</p>}
                {!done && text.now(s) && (
                  <div className="rounded-2xl bg-primary/10 p-3">
                    <p className="text-xs font-semibold tracking-wide text-primary uppercase">{t('roadmap.doNow')}</p>
                    <p className="mt-0.5 text-sm font-medium">{text.now(s)}</p>
                  </div>
                )}
                {s.subtasks.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {s.subtasks.map((st) => (
                      <li key={st.id}>
                        <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-accent">
                          <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={st.done} disabled={busy} onChange={(e) => onSubtask(st.id, e.target.checked)} />
                          <span className={cn('text-sm', st.done && 'text-muted-foreground line-through')}>{text.sub(st.key, st.title)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {s.kind === 'course' && s.detail?.startsWith('http') && (
                  <a href={s.detail} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary underline-offset-4 hover:underline">{t('roadmap.openCourse')}</a>
                )}
                <RefChips refs={s.refs} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </li>
  )
}
