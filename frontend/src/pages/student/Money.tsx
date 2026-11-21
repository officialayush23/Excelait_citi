import { CircleCheck, CircleHelp, CircleX, ExternalLink, FileCheck2, Info, Wallet } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { EmptyState } from '@/components/page/EmptyState'
import { KpiCard, KpiRow } from '@/components/page/Kpi'
import { PageHeader } from '@/components/page/PageHeader'
import { ListRow, SplitView } from '@/components/page/SplitView'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { FactQuestion } from '@/components/student/FactQuestion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { checkedOn, documentTypes } from '@/data/catalogue'
import { getKv, setKv } from '@/data/db'
import { useFacts } from '@/data/facts'
import { sortByAsk, useEligibility, type SchemeCheck } from '@/data/insights'
import { formatInr } from '@/lib/format'
import { cn } from '@/lib/utils'

const ICON = { eligible: CircleCheck, needs_info: CircleHelp, not_eligible: CircleX }
const TONE = { eligible: 'bg-tile-mint', needs_info: 'bg-tile-peach', not_eligible: 'bg-muted' }

export function Money() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const { checks, eligible, rupees, oneAway } = useEligibility()
  const facts = useFacts((s) => s.facts)
  const selected = params.get('scheme')
  const current = checks.find((c) => c.scheme.slug === selected) ?? checks[0]

  if (!Object.keys(facts).length || !current)
    return (
      <>
        <PageHeader title={t('nav.money')} back />
        <div className="rounded-3xl border bg-card">
          <EmptyState
            icon={<Wallet />}
            title={t('money.emptyTitle')}
            body={t('money.emptyBody')}
            action={
              <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
                <Link to="/app/start">{t('home.startProfile')}</Link>
              </Button>
            }
          />
        </div>
      </>
    )

  return (
    <>
      <PageHeader title={t('nav.money')} subtitle={t('money.subtitle')} back />
      <KpiRow className="mb-6">
        <KpiCard tone="highlight" label={t('money.kpiRupees')} value={rupees} prefix="₹" hint={t('money.kpiRupeesHint')} icon={<Wallet />} />
        <KpiCard tone="mint" label={t('money.kpiEligible')} value={eligible.length} icon={<CircleCheck />} />
        <KpiCard tone="peach" label={t('money.kpiOneAway')} value={oneAway.length} icon={<CircleHelp />} />
        <KpiCard tone="plain" label={t('money.kpiChecked')} value={checks.length} hint={t('money.checkedOn', { date: checkedOn })} />
      </KpiRow>
      <SplitView
        listTitle={<h2 className="text-lg font-semibold">{t('money.listTitle')}</h2>}
        list={checks.map((c) => {
          const Icon = ICON[c.result]
          return (
            <ListRow
              key={c.scheme.slug}
              selected={c.scheme.slug === current.scheme.slug}
              onSelect={() => setParams({ scheme: c.scheme.slug }, { replace: true })}
              leading={
                <span className={cn('grid size-11 place-items-center rounded-xl text-tile-foreground', TONE[c.result])}>
                  <Icon className="size-5" />
                </span>
              }
              title={c.scheme.name}
              subtitle={c.result === 'needs_info' && c.missing.length === 1 ? t('money.oneAway') : t(`money.result.${c.result}`)}
              trailing={c.scheme.benefit_amount ? formatInr(c.scheme.benefit_amount) : undefined}
            />
          )
        })}
        detailKey={current.scheme.slug}
        detail={<SchemeDetail check={current} />}
      />
    </>
  )
}

function SchemeDetail({ check }: { check: SchemeCheck }) {
  const { t } = useTranslation()
  const update = useFacts((s) => s.update)
  const { scheme, result } = check
  const nextField = sortByAsk(check.missing)[0]
  const Icon = ICON[result]
  const verdict = t(`money.verdict.${result}`)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{t(`kinds.${scheme.kind}`, { defaultValue: scheme.kind })}</Badge>
          <Badge variant="outline">{scheme.state ?? t('money.allIndia')}</Badge>
        </div>
        <div className="mt-3 flex items-center gap-1">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{scheme.name}</h2>
          <SpeakButton text={`${scheme.name}. ${verdict}. ${scheme.benefit_text}`} />
        </div>
        <p className="mt-2 text-muted-foreground">{scheme.benefit_text}</p>
        <p className="mt-1 text-xs text-muted-foreground">{scheme.ministry}</p>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={result + check.missing.join()}
          initial={{ rotateX: -80, opacity: 0 }}
          animate={{ rotateX: 0, opacity: 1 }}
          exit={{ rotateX: 80, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className={cn('flex items-start gap-3 rounded-2xl p-4 text-tile-foreground', TONE[result])}
        >
          <Icon className="mt-0.5 size-6 shrink-0" />
          <div>
            <p className="text-lg font-semibold">{verdict}</p>
            {result === 'not_eligible' && (
              <ul className="mt-1 list-disc pl-5 text-sm">
                {check.failed.map((f) => (
                  <li key={f.id}>{t('money.failedBecause', { rule: f.label })}</li>
                ))}
              </ul>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {result === 'needs_info' && nextField && (
        <div className="rounded-2xl border bg-card p-4">
          <p className="mb-3 text-sm text-muted-foreground">{t('money.answersLeft', { count: check.missing.length })}</p>
          <FactQuestion key={nextField} field={nextField} compact onAnswer={(v) => void update({ [nextField]: v })} />
        </div>
      )}

      {check.passed.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">{t('money.youMeet')}</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {check.passed.map((p) => (
              <li key={p.id} className="flex items-start gap-2">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-highlight" />
                {p.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result !== 'not_eligible' && <Documents slugs={scheme.documents} />}

      {scheme.verify.length > 0 && (
        <section className="rounded-2xl border border-dashed p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Info className="size-4" />
            {t('money.verifyTitle')}
          </h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {scheme.verify.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {scheme.apply_url && result === 'eligible' && (
          <Button asChild size="lg" className="rounded-full">
            <a href={scheme.apply_url} target="_blank" rel="noreferrer">
              {t('money.apply')}
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        )}
        <Button asChild variant="outline" size="lg" className="rounded-full">
          <a href={scheme.official_url} target="_blank" rel="noreferrer">
            {t('money.official')}
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('money.disclaimer')}</p>
    </div>
  )
}

/** The papers to collect, ticked off on the phone. */
function Documents({ slugs }: { slugs: string[] }) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const key = `docs:${session?.user.id}`
  const [have, setHave] = useState<string[]>([])
  useEffect(() => {
    void getKv<string[]>(key).then((v) => setHave(v ?? []))
  }, [key])
  function toggle(slug: string) {
    const next = have.includes(slug) ? have.filter((x) => x !== slug) : [...have, slug]
    setHave(next)
    void setKv(key, next)
  }
  if (!slugs.length) return null
  const done = slugs.filter((s) => have.includes(s)).length
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <FileCheck2 className="size-5" />
        {t('money.documents', { done, total: slugs.length })}
      </h3>
      <ul className="flex flex-col gap-2">
        {slugs.map((s) => (
          <li key={s}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border bg-card px-4 py-2">
              <input type="checkbox" className="size-5 accent-current" checked={have.includes(s)} onChange={() => toggle(s)} />
              <span className={cn(have.includes(s) && 'text-muted-foreground line-through')}>{t(`docs.${s}`, { defaultValue: documentTypes[s] ?? s })}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
