import { Compass, Sparkles, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { careerBySlug, careerName } from '@/data/catalogue'
import { useFacts } from '@/data/facts'
import { useMatches } from '@/data/insights'
import { riasecTop } from '@/engine/matching'
import { optionLabel, typeDesc, typeLabel, type Lang } from '@/engine/questions'

type Props = { lang: Lang; onMore?: () => void; onQuiz?: () => void; moreLeft: number }

/** "Here's what we learned about you": a short read-back after onboarding, linking to the full profile. */
export function LearnedSummary({ lang, onMore, onQuiz, moreLeft }: Props) {
  const { t } = useTranslation()
  const facts = useFacts((s) => s.facts)
  const matches = useMatches()
  const stage = facts.stage ?? null
  const interests = ((facts.interests as string[]) ?? []).map((k) => t(`tags.${k}`, { defaultValue: k }))
  const skills = ((facts.skills as string[]) ?? []).map((k) => optionLabel('skills', k, lang))
  const top = riasecTop((facts.riasec as Record<string, number>) ?? null)
  const careers = matches.slice(0, 3).map((m) => careerBySlug[m.slug]).filter(Boolean)

  const rows: { label: string; value: ReactNode }[] = []
  if (stage) rows.push({ label: t('onboard.summary.stage'), value: optionLabel('stage', stage, lang) })
  if (interests.length) rows.push({ label: t('onboard.summary.interests'), value: interests.join(', ') })
  if (skills.length) rows.push({ label: t('onboard.summary.skills'), value: skills.join(', ') })
  if (top.length)
    rows.push({
      label: t('onboard.summary.type'),
      value: (
        <span className="flex flex-col gap-0.5">
          {top.map((c) => (
            <span key={c}>
              <strong>{typeLabel(c, lang)}</strong> <span className="text-muted-foreground">({typeDesc(c, lang)})</span>
            </span>
          ))}
        </span>
      ),
    })
  if (careers.length) rows.push({ label: t('onboard.summary.careers'), value: careers.map((c) => careerName(c, lang)).join(', ') })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-tile-mint text-tile-foreground">
          <Sparkles aria-hidden="true" className="size-6" />
        </span>
        <div>
          <h3 className="text-2xl font-semibold tracking-tight">{t('onboard.summary.title')}</h3>
          <p className="text-muted-foreground">{t('onboard.summary.subtitle')}</p>
        </div>
      </div>
      {rows.length ? (
        <dl className="grid gap-3 rounded-2xl border p-4">
          {rows.map((r) => (
            <div key={r.label} className="grid gap-0.5 sm:grid-cols-[12rem_1fr]">
              <dt className="text-sm text-muted-foreground">{r.label}</dt>
              <dd className="font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground">{t('onboard.summary.empty')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg" className="h-12 rounded-full px-6">
          <Link to="/app/profile">
            <UserRound data-icon="inline-start" />
            {t('onboard.summary.profile')}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-6">
          <Link to="/app/careers">{t('onboard.summary.careersCta')}</Link>
        </Button>
        {onQuiz && (
          <Button size="lg" variant="outline" className="h-12 rounded-full px-6" onClick={onQuiz}>
            <Compass data-icon="inline-start" />
            {t('onboard.summary.quiz')}
          </Button>
        )}
        {onMore && moreLeft > 0 && (
          <Button size="lg" variant="ghost" className="h-12 rounded-full px-6" onClick={onMore}>
            {t('onboard.summary.more')}
          </Button>
        )}
      </div>
    </div>
  )
}
