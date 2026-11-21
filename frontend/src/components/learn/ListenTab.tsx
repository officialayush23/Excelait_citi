import { Pause, Play, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { Section } from './api'

const SPEEDS = [0.75, 1, 1.25]

/** Play all sections in order or one at a time; the section being read is highlighted. */
export function ListenTab({ sections }: { sections: Section[] }) {
  const { t } = useTranslation()
  const audio = useRef<HTMLAudioElement>(null)
  const items = useRef<(HTMLLIElement | null)[]>([])
  const [current, setCurrent] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [all, setAll] = useState(false)
  const [speed, setSpeed] = useState(1)
  const hasAudio = sections.some((s) => s.audio_url)

  const nextWithAudio = (from: number) => sections.findIndex((s, i) => i >= from && !!s.audio_url)

  const playAt = (i: number, playAll: boolean) => {
    const el = audio.current
    const url = sections[i]?.audio_url
    if (!el || !url) return
    setAll(playAll)
    setCurrent(i)
    if (el.src !== url) el.src = url
    el.playbackRate = speed
    void el.play().catch(() => setPlaying(false))
  }

  const toggle = (i: number) => {
    const el = audio.current
    if (!el) return
    if (current === i && playing) return el.pause()
    if (current === i && !playing) return void el.play()
    playAt(i, false)
  }

  const toggleAll = () => {
    const el = audio.current
    if (!el) return
    if (playing) return el.pause()
    if (current !== null && el.src && !el.ended) return void el.play()
    const first = nextWithAudio(0)
    if (first >= 0) playAt(first, true)
  }

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed
  }, [speed])

  useEffect(() => {
    if (current !== null) items.current[current]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [current])

  const onEnded = () => {
    setPlaying(false)
    if (!all || current === null) return
    const n = nextWithAudio(current + 1)
    if (n >= 0) playAt(n, true)
    else setAll(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <audio ref={audio} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={onEnded} className="hidden" />

      {hasAudio ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-3xl border bg-card/95 p-3 backdrop-blur">
          <Button onClick={toggleAll} className="h-14 flex-1 rounded-full text-lg sm:flex-none sm:px-8">
            {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {playing ? t('learn.pause') : current !== null ? t('learn.resume') : t('learn.playAll')}
          </Button>
          <div className="flex gap-1" role="radiogroup" aria-label={t('learn.speed')}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={speed === s}
                onClick={() => setSpeed(s)}
                className={cn('h-12 min-w-14 rounded-full border px-3 text-base', speed === s ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card')}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border bg-card px-4 py-3 text-muted-foreground">{t('learn.noAudio')}</p>
      )}

      <ol className="flex flex-col gap-3">
        {sections.map((s, i) => {
          const on = current === i
          return (
            <li
              key={i}
              ref={(el) => {
                items.current[i] = el
              }}
              className={cn('rounded-3xl border bg-card p-4 transition-colors sm:p-5', on && 'border-transparent bg-highlight text-highlight-foreground ring-2 ring-ring/40')}
              aria-current={on ? 'true' : undefined}
            >
              <div className="mb-2 flex items-center gap-3">
                {s.audio_url ? (
                  <button
                    type="button"
                    onClick={() => toggle(i)}
                    aria-label={on && playing ? t('learn.pause') : t('learn.playPart')}
                    className={cn('grid size-12 shrink-0 place-items-center rounded-full border', on ? 'bg-background text-foreground' : 'bg-surface')}
                  >
                    {on && playing ? <Pause className="size-5" /> : <Play className="size-5" />}
                  </button>
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-full border text-muted-foreground"><Volume2 className="size-5 opacity-40" /></span>
                )}
                <h3 className="text-lg font-semibold leading-snug">{s.heading}</h3>
              </div>
              <p className="text-lg leading-relaxed">{s.text}</p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
