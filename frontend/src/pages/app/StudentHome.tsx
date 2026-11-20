import { ArrowRight, BookOpen, Compass, Wallet, WifiOff } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { Composer, SaathiAvatar, SuggestionChips, useOnline } from '@/components/cards/SaathiKit'
import { KpiCard, KpiRow } from '@/components/page/Kpi'
import { PageHeader } from '@/components/page/PageHeader'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { useFacts } from '@/data/facts'
import { profileComplete, useEligibility, useMatches } from '@/data/insights'
import { cn } from '@/lib/utils'

const NEXT = [
  { key: 'nextCareers', to: '/app/careers', icon: Compass, tone: 'bg-tile-lilac' },
  { key: 'nextMoney', to: '/app/money', icon: Wallet, tone: 'bg-tile-peach' },
  { key: 'nextLearn', to: '/app/learn', icon: BookOpen, tone: 'bg-tile-mint' },
] as const

/** The student home: Saathi first, then the numbers, then what comes next. */
export function StudentHome() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const online = useOnline()
  const firstName = profile?.full_name?.split(' ')[0] || t('home.friend')
  const facts = useFacts((s) => s.facts)
  const pending = useFacts((s) => s.pending)
  const done = profileComplete(facts)
  const matches = useMatches()
  const { rupees, eligible, oneAway } = useEligibility()

  /** The chat page sends this on arrival. */
  const ask = (message: string) => navigate('/app/saathi', { state: { message } })

  return (
    <>
      <PageHeader
        title={t('home.hello', { name: firstName })}
        subtitle={done ? t('saathi.homeLead') : t('home.studentLead')}
        actions={
          <Button asChild size="lg" variant={done ? 'outline' : 'default'} className="h-12 rounded-full px-6 text-base">
            <Link to={done ? '/app/careers' : '/app/start'}>
              {done ? t('home.seeCareers') : t('home.startProfile')}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        }
      />

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="saathi-home-title"
        className="mb-6 flex flex-col gap-4 rounded-3xl border bg-card p-4 sm:p-6"
      >
        <div className="flex items-center gap-3">
          <SaathiAvatar className="size-12" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <h2 id="saathi-home-title" className="text-xl font-semibold tracking-tight sm:text-2xl">
                {t('saathi.homeTitle')}
              </h2>
              <SpeakButton text={`${t('saathi.homeTitle')}. ${t('saathi.homeBody')}`} />
            </div>
            <p className="text-sm text-muted-foreground sm:text-base">{t('saathi.homeBody')}</p>
          </div>
          <Button asChild variant="ghost" className="hidden h-11 rounded-full sm:inline-flex">
            <Link to="/app/saathi">
              {t('saathi.openChat')}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>

        {online ? (
          <>
            <Composer onSend={ask} />
            <SuggestionChips onPick={ask} />
          </>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4" role="status">
            <p className="flex items-start gap-2">
              <WifiOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              {t('saathi.offline')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="h-11 rounded-full px-4">
                <Link to="/app/careers">
                  <Compass className="size-4" />
                  {t('saathi.openCareers')}
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-full px-4">
                <Link to="/app/money">
                  <Wallet className="size-4" />
                  {t('saathi.openMoney')}
                </Link>
              </Button>
            </div>
          </div>
        )}
      </motion.section>

      {pending > 0 && <p className="mb-3 text-sm text-muted-foreground">{t('home.pendingSync', { count: pending })}</p>}
      {/* Lessons and applications arrive with Learn and Connect; until then they honestly show zero. */}
      <KpiRow>
        <KpiCard tone="lilac" label={t('home.kpi.careers')} value={done ? matches.length : 0} icon={<Compass />} />
        <KpiCard
          tone="peach"
          label={t('home.kpi.rupees')}
          value={rupees}
          prefix="₹"
          hint={oneAway.length ? t('home.oneAway', { count: oneAway.length }) : t('home.eligibleCount', { count: eligible.length })}
          icon={<Wallet />}
        />
        <KpiCard tone="mint" label={t('home.kpi.lessons')} value={0} icon={<BookOpen />} />
        <KpiCard tone="rose" label={t('home.kpi.applications')} value={0} />
      </KpiRow>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-semibold tracking-tight">{t('home.nextTitle')}</h2>
        <motion.ul
          initial="hidden"
          animate="show"
          transition={{ staggerChildren: 0.07, delayChildren: 0.15 }}
          className="grid gap-3 md:grid-cols-3"
        >
          {NEXT.map(({ key, to, icon: Icon, tone }) => (
            <motion.li key={key} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>
              <Link
                to={key === 'nextCareers' && !done ? '/app/start' : to}
                className="group flex h-full items-start gap-4 rounded-2xl border bg-card p-5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className={cn('grid size-12 shrink-0 place-items-center rounded-xl text-tile-foreground', tone)}>
                  <Icon className="size-6" />
                </span>
                <span className="flex-1 text-base leading-snug">{t(`home.${key}`)}</span>
                <ArrowRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </motion.li>
          ))}
        </motion.ul>
      </section>
    </>
  )
}
