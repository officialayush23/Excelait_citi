import { ArrowRight, BarChart3, Compass, Plus, UserRound, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { Bars, BentoCard, BentoHead, Donut, Legend } from '@/components/bento/Bento'
import { Composer, SaathiAvatar, SuggestionChips, useOnline } from '@/components/cards/SaathiKit'
import { AnimatedNumber } from '@/components/motion-primitives/animated-number'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { careerBySlug, careerName, schemes } from '@/data/catalogue'
import { useFacts } from '@/data/facts'
import { profileComplete, useEligibility, useMatches } from '@/data/insights'
import { to } from '@/lib/links'

/** What "complete" means on the home ring. Private ones are counted but shown apart. */
const OPEN_KEYS = ['class_level', 'age', 'district', 'interests', 'subjects', 'marks_percent', 'needs_income_soon', 'can_relocate']
const PRIVATE_KEYS = ['social_category', 'family_income_annual', 'gender']

function answered(v: unknown) {
  return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
}

/** The student home as a bento board: money card, Saathi, profile ring, fit bars, career list. */
export function StudentHome() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const online = useOnline()
  const firstName = profile?.full_name?.split(' ')[0] || t('home.friend')
  const facts = useFacts((s) => s.facts)
  const pending = useFacts((s) => s.pending)
  const done = profileComplete(facts)
  const matches = useMatches()
  const { rupees, eligible, oneAway } = useEligibility()
  const lang = i18n.language

  const ask = (message: string) => navigate('/app/saathi', { state: { message } })

  const openDone = OPEN_KEYS.filter((k) => answered(facts[k])).length
  const privDone = PRIVATE_KEYS.filter((k) => answered(facts[k])).length
  const total = OPEN_KEYS.length + PRIVATE_KEYS.length
  const pct = Math.round(((openDone + privDone) / total) * 100)

  const shown = done ? matches : []
  const bars = shown.slice(0, 7).map((m) => {
    const c = careerBySlug[m.slug]
    return { key: m.slug, label: c ? careerName(c, lang) : m.slug, value: m.score, to: to.career(m.slug) }
  })
  const topScore = shown[0]?.score ?? 0

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('home.hello', { name: firstName })}
            <SpeakButton text={t('home.hello', { name: firstName })} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">{done ? t('saathi.homeLead') : t('home.studentLead')}</p>
        </div>
        {!done && (
          <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
            <Link to="/app/start">
              {t('home.startProfile')}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        )}
      </div>

      {pending > 0 && <p className="text-sm text-muted-foreground">{t('home.pendingSync', { count: pending })}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
        {/* Money card + careers list, like the wallet column in the reference */}
        <BentoCard className="lg:col-span-4 lg:row-span-2">
          <div className="relative mb-5 pt-5">
            <div aria-hidden="true" className="absolute inset-x-6 top-0 h-10 rounded-3xl bg-hero/35" />
            <div aria-hidden="true" className="absolute inset-x-3 top-2.5 h-10 rounded-3xl bg-hero/60" />
            <Link
              to="/app/money"
              className="relative block overflow-hidden rounded-3xl bg-gradient-to-br from-hero to-hero-2 p-5 text-hero-foreground shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span aria-hidden="true" className="pointer-events-none absolute -right-10 -bottom-16 size-48 rounded-full bg-white/10" />
              <div className="flex items-start justify-between">
                <span className="flex gap-1" aria-hidden="true">
                  <span className="size-6 rounded-full bg-white/85" />
                  <span className="-ml-3 size-6 rounded-full bg-white/45" />
                </span>
                <span className="grid size-10 place-items-center rounded-full bg-white/20 ring-1 ring-white/40" aria-hidden="true">
                  <Plus className="size-5" />
                </span>
              </div>
              <p className="mt-6 text-sm font-medium opacity-85">{t('bento.moneyTitle')}</p>
              <p className="text-4xl font-semibold tracking-tight tabular-nums sm:text-[2.6rem]">
                <span className="mr-0.5 text-[0.65em] opacity-80">₹</span>
                <AnimatedNumber value={rupees} springOptions={{ bounce: 0, duration: 1200 }} />
              </p>
              <p className="mt-3 text-sm opacity-85">
                {oneAway.length ? t('home.oneAway', { count: oneAway.length }) : t('home.eligibleCount', { count: eligible.length })}
                {' · '}
                {t('bento.schemesChecked', { count: schemes.length })}
              </p>
            </Link>
          </div>

          <BentoHead title={t('bento.topCareers')} to="/app/careers" label={t('bento.seeAll')} />
          {shown.length ? (
            <ul className="flex flex-col gap-1">
              {shown.slice(0, 5).map((m) => {
                const c = careerBySlug[m.slug]
                if (!c) return null
                const name = careerName(c, lang)
                return (
                  <li key={m.slug}>
                    <Link
                      to={to.career(m.slug)}
                      className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-tile-mint text-sm font-semibold text-tile-foreground">
                        {name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{name}</span>
                        {c.pay_min && c.pay_max ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {t('bento.perMonth', { min: Math.round(c.pay_min / 1000), max: Math.round(c.pay_max / 1000) })}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{t('bento.fit', { pct: m.score })}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">{t('bento.noCareers')}</p>
          )}
        </BentoCard>

        {/* Profile ring */}
        <BentoCard className="items-center lg:col-span-4" delay={0.05}>
          <div className="w-full">
            <BentoHead icon={<UserRound />} title={t('bento.profileTitle')} to="/app/profile" label={t('bento.open')} />
          </div>
          <Donut
            parts={[
              { value: openDone, className: 'stroke-chart-1' },
              { value: privDone, className: 'stroke-chart-2' },
              { value: total - openDone - privDone, className: '', striped: true },
            ]}
          >
            <span>
              <span className="block text-3xl font-semibold tabular-nums">{pct}%</span>
              <span className="block text-xs text-muted-foreground">{t('bento.ofProfile')}</span>
            </span>
          </Donut>
          <div className="mt-4">
            <Legend
              items={[
                { label: t('bento.answered'), className: 'bg-chart-1' },
                { label: t('bento.private'), className: 'bg-chart-2' },
                { label: t('bento.missing'), className: 'text-foreground/70', striped: true },
              ]}
            />
          </div>
        </BentoCard>

        {/* Saathi, in the "exchange" slot */}
        <BentoCard className="gap-4 lg:col-span-4" delay={0.1}>
          <div className="flex items-center gap-3">
            <SaathiAvatar className="size-11" />
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1 text-base font-semibold tracking-tight">
                {t('saathi.homeTitle')}
                <SpeakButton text={`${t('saathi.homeTitle')}. ${t('saathi.homeBody')}`} />
              </h2>
              <p className="line-clamp-2 text-xs text-muted-foreground sm:text-sm">{t('saathi.homeBody')}</p>
            </div>
          </div>
          {online ? (
            <>
              <Composer onSend={ask} />
              <SuggestionChips onPick={ask} className="sm:grid-cols-2 lg:grid-cols-2 [&_button]:sm:text-sm" />
            </>
          ) : (
            <p className="flex items-start gap-2 rounded-2xl bg-muted p-4 text-sm" role="status">
              <WifiOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              {t('saathi.offline')}
            </p>
          )}
          <Button asChild className="mt-auto h-11 w-full rounded-full bg-cta text-cta-foreground hover:bg-cta/90">
            <Link to="/app/saathi">
              {t('saathi.openChat')}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </BentoCard>

        {/* Career fit bars */}
        <BentoCard className="lg:col-span-8" delay={0.15}>
          <BentoHead icon={<BarChart3 />} title={t('bento.fitTitle')} to="/app/careers" label={t('bento.seeAll')} />
          <div className="mb-4 flex flex-wrap items-baseline gap-2">
            <p className="text-3xl font-semibold tracking-tight tabular-nums">{t('bento.matched', { count: shown.length })}</p>
            {topScore > 0 && (
              <span className="rounded-full bg-chart-2 px-2.5 py-0.5 text-xs font-semibold text-black">{t('bento.topFit', { pct: topScore })}</span>
            )}
          </div>
          {bars.length ? (
            <Bars data={bars} />
          ) : (
            <Link
              to="/app/start"
              className="flex items-center gap-3 rounded-2xl bg-muted p-4 text-sm transition-colors hover:bg-accent"
            >
              <Compass className="size-5 shrink-0" aria-hidden="true" />
              <span className="flex-1">{t('home.nextCareers')}</span>
              <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            </Link>
          )}
        </BentoCard>
      </div>
    </div>
  )
}
