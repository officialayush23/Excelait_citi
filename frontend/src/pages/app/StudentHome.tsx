import { ArrowRight, BookOpen, Compass, Wallet } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { KpiCard, KpiRow } from '@/components/page/Kpi'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { useFacts } from '@/data/facts'
import { profileComplete, useEligibility, useMatches } from '@/data/insights'
import { cn } from '@/lib/utils'

const NEXT = [
  { key: 'nextCareers', to: '/app/careers', icon: Compass, tone: 'bg-tile-lilac' },
  { key: 'nextMoney', to: '/app/money', icon: Wallet, tone: 'bg-tile-peach' },
  { key: 'nextLearn', to: '/app/learn', icon: BookOpen, tone: 'bg-tile-mint' },
] as const

/** The simpler, larger student home: one main action, then what comes next. */
export function StudentHome() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const firstName = profile?.full_name?.split(' ')[0] || t('home.friend')
  const facts = useFacts((s) => s.facts)
  const pending = useFacts((s) => s.pending)
  const done = profileComplete(facts)
  const matches = useMatches()
  const { rupees, eligible, oneAway } = useEligibility()

  return (
    <>
      <PageHeader
        title={t('home.hello', { name: firstName })}
        subtitle={t('home.studentLead')}
        actions={
          <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
            <Link to={done ? '/app/careers' : '/app/start'}>
              {done ? t('home.seeCareers') : t('home.startProfile')}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        }
      />

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
                to={to}
                className="group flex h-full items-start gap-4 rounded-2xl border bg-card p-5 transition-colors hover:bg-accent"
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
