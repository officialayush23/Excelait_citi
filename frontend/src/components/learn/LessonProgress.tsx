import { Check, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { LessonStage } from './api'

const STEPS = ['reading', 'writing', 'recording'] as const

/** Three steps: Reading your chapter, Writing the lesson, Recording audio. */
export function LessonProgress({ stage, className }: { stage: LessonStage | 'uploading'; className?: string }) {
  const { t } = useTranslation()
  const current = stage === 'uploading' ? 0 : stage === 'done' ? 3 : Math.max(0, STEPS.indexOf(stage as (typeof STEPS)[number]))
  return (
    <ol className={cn('flex flex-col gap-3', className)} aria-live="polite">
      {STEPS.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={s} className={cn('flex items-center gap-3 text-base', !done && !active && 'text-muted-foreground')}>
            <span
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full border',
                done && 'border-transparent bg-success text-white',
                active && 'border-transparent bg-highlight text-highlight-foreground',
              )}
            >
              {done ? <Check className="size-5" /> : active ? <Loader2 className="size-5 animate-spin" /> : <span className="text-sm">{i + 1}</span>}
            </span>
            <span className={cn(active && 'font-medium')}>{t(`learn.stage.${s}`)}</span>
          </li>
        )
      })}
      <p className="text-sm text-muted-foreground">{t('learn.stageHint')}</p>
    </ol>
  )
}
