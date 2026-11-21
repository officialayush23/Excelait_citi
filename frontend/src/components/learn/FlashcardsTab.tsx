import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { Flashcard } from './api'

/** One card at a time; tap to flip. */
export function FlashcardsTab({ cards }: { cards: Flashcard[] }) {
  const { t } = useTranslation()
  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)
  if (!cards.length) return <p className="text-muted-foreground">{t('learn.noCards')}</p>
  const card = cards[i]
  const go = (d: number) => {
    setFlipped(false)
    setI((i + d + cards.length) % cards.length)
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? t('learn.showFront') : t('learn.showBack')}
        className="w-full max-w-lg [perspective:1000px]"
      >
        <div className={cn('relative min-h-64 transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none', flipped && '[transform:rotateY(180deg)]')}>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl border bg-card p-6 [backface-visibility:hidden]">
            <p className="text-2xl font-semibold leading-snug">{card.front}</p>
            <p className="text-sm text-muted-foreground">{t('learn.tapToFlip')}</p>
          </div>
          <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-highlight p-6 text-highlight-foreground [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <p className="text-xl leading-relaxed">{card.back}</p>
          </div>
        </div>
      </button>
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => go(-1)} aria-label={t('learn.prevCard')} className="size-14 rounded-full"><ChevronLeft className="size-6" /></Button>
        <span className="min-w-16 text-center text-muted-foreground">{i + 1} / {cards.length}</span>
        <Button variant="outline" onClick={() => go(1)} aria-label={t('learn.nextCard')} className="size-14 rounded-full"><ChevronRight className="size-6" /></Button>
      </div>
    </div>
  )
}
