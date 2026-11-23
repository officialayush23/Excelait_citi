import { Compass, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

import { RIASEC, pick } from './helpers'
import { Section } from './Parts'
import type { ProfileData } from './types'

/** The six RIASEC types as friendly bars, top ones highlighted; or an invitation to take the quiz. */
export function InterestSection({ interests }: { interests: ProfileData['interests'] }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const { riasec, top, labels, tags, quiz_done } = interests

  if (!quiz_done || !riasec)
    return (
      <Section icon={<Compass />} title={t('profile.interestTitle')} hint={t('profile.quizHint')}>
        <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
          <Link to={`${to.start()}?quiz=1`}>
            <Sparkles data-icon="inline-start" />
            {t('profile.quizCta')}
          </Link>
        </Button>
      </Section>
    )

  const name = (c: (typeof RIASEC)[number]) => (labels[c] ? pick(labels[c], lang) : t(`profile.riasec.${c}.name`))
  const topNames = top.map(name).join(', ')
  return (
    <Section icon={<Compass />} title={t('profile.interestTitle')} hint={t('profile.interestHint')} speak={`${t('profile.interestTitle')}. ${t('profile.topLine', { names: topNames })}`}>
      <ul className="flex flex-col gap-3">
        {RIASEC.map((c, i) => {
          const isTop = top.includes(c)
          const v = Math.max(0, Math.min(100, riasec[c] ?? 0))
          return (
            <li key={c} className={cn('rounded-2xl p-3', isTop && 'bg-surface')}>
              <div className="flex items-baseline justify-between gap-3">
                <p className={cn('font-medium', isTop && 'font-semibold')}>{name(c)}</p>
                <p className="text-sm tabular-nums text-muted-foreground">{v}</p>
              </div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${name(c)} ${v}`}>
                <motion.div
                  className={cn('h-full rounded-full', isTop ? 'bg-primary' : 'bg-muted-foreground/40')}
                  initial={{ width: 0 }}
                  animate={{ width: `${v}%` }}
                  transition={{ delay: 0.05 * i, duration: 0.6, ease: 'easeOut' }}
                />
              </div>
              {isTop && <p className="mt-1.5 text-sm text-muted-foreground">{t(`profile.riasec.${c}.meaning`)}</p>}
            </li>
          )
        })}
      </ul>
      {tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex min-h-8 items-center rounded-full bg-secondary px-3 text-sm">{tag}</span>
          ))}
        </div>
      )}
      <Button asChild variant="outline" className="mt-4 h-11 rounded-full px-5">
        <Link to={`${to.start()}?quiz=1`}>{t('profile.retakeQuiz')}</Link>
      </Button>
    </Section>
  )
}
