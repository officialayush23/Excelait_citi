import { ArrowRight } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { to } from '@/lib/links'

import type { ProfileData } from './types'

const R = 44
const C = 2 * Math.PI * R

/** Name, where you study, and a ring showing how much Saathi knows. */
export function ProfileHeader({ data }: { data: ProfileData }) {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const val = (k: string) => data.facts.find((f) => f.key === k)?.value
  const cls = val('class_level')
  const course = val('course')
  const district = val('district')
  const bits = [
    typeof cls === 'number' ? (cls <= 12 ? t('facts.classN', { n: cls }) : t('facts.collegeYear', { n: cls - 12 })) : null,
    typeof course === 'string' ? t(`facts.course.options.${course}`, { defaultValue: course }) : null,
    typeof district === 'string' ? district : null,
  ].filter(Boolean)
  const name = profile?.full_name || t('profile.you')
  const pct = Math.max(0, Math.min(100, Math.round(data.completeness.pct)))
  const next = data.completeness.next.slice(0, 2)
  const done = pct >= 100

  return (
    <div className="mb-6 flex flex-col gap-5 rounded-3xl border bg-card p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="flex items-center gap-4">
        <div className="relative size-24 shrink-0" role="img" aria-label={t('profile.completeness', { pct })}>
          <svg viewBox="0 0 100 100" className="size-full -rotate-90">
            <circle cx="50" cy="50" r={R} fill="none" strokeWidth="9" className="stroke-muted" />
            <motion.circle
              cx="50" cy="50" r={R} fill="none" strokeWidth="9" strokeLinecap="round"
              className="stroke-primary"
              strokeDasharray={C}
              initial={{ strokeDashoffset: C }}
              animate={{ strokeDashoffset: C * (1 - pct / 100) }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-xl font-semibold">{pct}%</span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h2 className="truncate text-2xl font-semibold tracking-tight">{name}</h2>
            <SpeakButton text={`${name}. ${bits.join(', ')}. ${t('profile.completeness', { pct })}`} />
          </div>
          {bits.length > 0 && <p className="text-muted-foreground">{bits.join(' · ')}</p>}
          <p className="text-sm text-muted-foreground">{t('profile.completeness', { pct })}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:items-end">
        {done ? (
          <p className="font-medium">{t('profile.allDone')}</p>
        ) : (
          <>
            <ul className="flex w-full flex-col gap-2 sm:max-w-md">
              {next.map((n) => (
                <li key={n.field} className="rounded-2xl bg-surface p-3">
                  <p className="font-medium">{t(`facts.${n.field}.q`, { defaultValue: n.field })}</p>
                  <p className="text-sm text-muted-foreground">{n.why}</p>
                </li>
              ))}
            </ul>
            <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
              <Link to={to.start()}>
                {t('profile.complete')}
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
