import { ArrowRight, Award, Bookmark, ListChecks, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatInr } from '@/lib/format'
import { to } from '@/lib/links'
import { useUi } from '@/stores/ui'

import { pick, shortDate } from './helpers'
import { Section } from './Parts'
import type { ProfileData } from './types'

function Empty({ text, cta, href }: { text: string; cta: string; href: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-muted-foreground">{text}</p>
      <Button asChild variant="outline" className="h-11 rounded-full px-5">
        <Link to={href}>{cta}</Link>
      </Button>
    </div>
  )
}

/** Saved careers, plans, money and credentials: the parts of the app this profile feeds. */
export function ConnectedSections({ data }: { data: ProfileData }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const { saved_careers, plans, money, credentials } = data
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section icon={<Bookmark />} title={t('profile.savedTitle')}>
        {saved_careers.length === 0 ? (
          <Empty text={t('profile.savedEmpty')} cta={t('profile.exploreCareers')} href={to.careers()} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {saved_careers.map((c) => (
              <Link key={c.slug} to={to.career(c.slug)} className="inline-flex min-h-11 items-center rounded-full bg-tile-peach px-4 font-medium text-tile-foreground hover:opacity-80">
                {pick(c.name_i18n, lang) || c.name}
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<ListChecks />} title={t('profile.plansTitle')}>
        {plans.length === 0 ? (
          <Empty text={t('profile.plansEmpty')} cta={t('profile.makePlan')} href={to.plan()} />
        ) : (
          <ul className="flex flex-col gap-3">
            {plans.map((p) => (
              <li key={p.id}>
                <Link to={to.planItem(p.id)} className="block min-h-12 rounded-2xl bg-surface p-3 hover:bg-accent/40">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">{p.title}</p>
                    <p className="text-sm tabular-nums text-muted-foreground">{p.done}/{p.total}</p>
                  </div>
                  <Progress value={p.total ? (p.done / p.total) * 100 : 0} className="mt-2" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<Wallet />} title={t('profile.moneyTitle')}>
        {money.eligible.length === 0 && money.needs_info === 0 ? (
          <Empty text={t('profile.moneyEmpty')} cta={t('profile.openMoney')} href={to.money()} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-3xl font-semibold tracking-tight">{formatInr(money.eligible_inr)}</p>
            <p className="text-sm text-muted-foreground">{t('profile.moneyLine', { count: money.eligible.length })}</p>
            <div className="flex flex-wrap gap-2">
              {money.eligible.map((s) => (
                <Link key={s.slug} to={to.scheme(s.slug)} className="inline-flex min-h-11 items-center rounded-full bg-tile-mint px-4 text-sm font-medium text-tile-foreground hover:opacity-80">{s.name}</Link>
              ))}
            </div>
            {money.needs_info > 0 && <p className="text-sm text-muted-foreground">{t('profile.moneyNeeds', { count: money.needs_info })}</p>}
            <Button asChild className="h-11 w-fit rounded-full px-5">
              <Link to={to.money()}>
                {t('profile.openMoney')}
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        )}
      </Section>

      <Section icon={<Award />} title={t('profile.credTitle')}>
        {credentials.length === 0 ? (
          <Empty text={t('profile.credEmpty')} cta={t('profile.openPassport')} href="/app/passport" />
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {credentials.map((c) => (
                <li key={c.public_id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-3">
                  <span className="font-medium">{c.skill}</span>
                  <span className="text-sm text-muted-foreground">{shortDate(c.issued_at, lang)}</span>
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" className="h-11 w-fit rounded-full px-5">
              <Link to="/app/passport">{t('profile.openPassport')}</Link>
            </Button>
          </div>
        )}
      </Section>
    </div>
  )
}
