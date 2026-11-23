/* eslint-disable react-refresh/only-export-components */
import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

import type { RefLink, RoadmapStep } from './types'

/** A circular progress ring with the % in the middle. */
export function ProgressRing({ value, size = 48, stroke = 5, className, label }: { value: number; size?: number; stroke?: number; className?: string; label?: string }) {
  const reduce = useReducedMotion()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('relative grid shrink-0 place-items-center', className)} style={{ width: size, height: size }} role="img" aria-label={label ?? `${v}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
          className="text-primary" strokeDasharray={c}
          initial={reduce ? false : { strokeDashoffset: c }} animate={{ strokeDashoffset: c - (c * v) / 100 }}
          transition={{ duration: reduce ? 0 : 0.8, ease: 'easeOut' }}
        />
      </svg>
      <span className="absolute text-[0.7rem] font-semibold tabular-nums" style={{ fontSize: size < 44 ? '0.65rem' : undefined }}>{v}%</span>
    </div>
  )
}

/** Translated text with the backend's English as fallback. */
export function useStepText() {
  const { t } = useTranslation()
  return {
    why: (s: RoadmapStep) => (s.copy_key ? t(`roadmap.copy.${s.copy_key}.why`, { defaultValue: s.why ?? '' }) : s.why ?? ''),
    now: (s: RoadmapStep) => (s.copy_key ? t(`roadmap.copy.${s.copy_key}.now`, { defaultValue: s.now_text ?? '' }) : s.now_text ?? ''),
    sub: (key: string | undefined, title: string) => (key ? t(`roadmap.sub.${key}`, { defaultValue: title }) : title),
  }
}

export function refHref(r: RefLink): string | null {
  switch (r.kind) {
    case 'career': return to.career(r.slug)
    case 'exam': return to.exam(r.slug)
    case 'scheme': return to.scheme(r.slug)
    case 'program': return to.course(r.slug)
    case 'document': return to.money()
    case 'community': return to.community()
    case 'job': return to.saathi()
    case 'activity': return r.slug === 'money' ? to.money() : r.slug === 'riasec' || r.slug === 'profile' ? to.start() : null
    default: return null
  }
}

export function RefChips({ refs }: { refs: RefLink[] }) {
  const { t } = useTranslation()
  const shown = refs.filter((r) => refHref(r) && r.slug)
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((r) => (
        <Link key={`${r.kind}-${r.slug}`} to={refHref(r)!} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background/60 px-2.5 py-1 text-xs font-medium hover:bg-accent">
          <span className="text-muted-foreground">{t(`roadmap.ref.${r.kind}`, { defaultValue: r.kind })}</span>
          <span className="truncate">{r.name || r.slug}</span>
        </Link>
      ))}
    </div>
  )
}

/** "in 5 days" / "today" / "3 days ago" in the app's language. */
export function DaysText({ days }: { days: number | null | undefined }) {
  const { t } = useTranslation()
  if (days === null || days === undefined) return null
  if (days === 0) return <>{t('roadmap.today')}</>
  return <>{days > 0 ? t('roadmap.inDays', { count: days }) : t('roadmap.daysAgo', { count: -days })}</>
}
