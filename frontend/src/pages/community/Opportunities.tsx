import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Briefcase, CircleHelp, Flag, MapPin, ShieldAlert, Users, Wifi } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ReportDialog } from '@/components/community/ReportDialog'
import { DeadlineChip, PostSkeletons, formatDate, timeAgo } from '@/components/community/shared'
import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { formatInr } from '@/lib/format'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

const KINDS = ['internship', 'apprenticeship', 'scholarship', 'training', 'course', 'job', 'workshop', 'bootcamp', 'mentorship', 'admission', 'event', 'resource']
const STEPS = ['applied', 'shortlisted', 'interview', 'offered', 'joined'] as const

type Offer = {
  id: string
  kind: string
  title: string
  description: string | null
  org_name: string | null
  verified: boolean
  fee_inr: number | null
  stipend_monthly: number | null
  deadline: string | null
  location: string | null
  is_remote: boolean
  seats: number | null
  apply_url: string | null
  match: 'eligible' | 'needs_info' | 'not_eligible'
  missing: string[]
  criteria_labels: string[]
}
type Application = {
  id: string
  status: string
  created_at: string
  updated_at: string
  opportunities: { id: string; title: string; kind: string; deadline: string | null; organizations: { name: string } | null } | null
}

export function Opportunities() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'applied' ? 'applied' : 'foryou'
  const kind = params.get('kind') ?? ''
  const selected = params.get('id')

  const data = useQuery({
    queryKey: ['opportunities', kind],
    queryFn: () => api<{ offers: Offer[]; applications: Application[] }>(`/api/v1/opportunities${kind ? `?kind=${kind}` : ''}`),
  })

  function patch(next: Record<string, string | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k)
    setParams(p, { replace: true })
  }

  const current = data.data?.offers.find((o) => o.id === selected)

  return (
    <>
      <PageHeader title={t('community.opp.title')} subtitle={t('community.opp.subtitle')} back />

      <div className="mb-4 flex items-start gap-3 rounded-2xl bg-tile-peach p-4 text-tile-foreground">
        <ShieldAlert className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">{t('community.opp.safetyTitle')}</p>
          <p className="text-sm opacity-85">{t('community.opp.safetyBody')}</p>
        </div>
      </div>

      <div className="mb-4 flex gap-2" role="tablist">
        {(['foryou', 'applied'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => patch({ tab: id === 'applied' ? 'applied' : null })}
            className={cn('h-11 rounded-full border px-5 text-base font-medium', tab === id ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card text-foreground/80 hover:text-foreground')}
          >
            {t(`community.opp.tab.${id}`)}
            {id === 'applied' && data.data ? ` (${data.data.applications.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'foryou' && (
        <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex w-max gap-2">
            {['', ...KINDS].map((k) => (
              <button
                key={k || 'all'}
                type="button"
                aria-pressed={kind === k}
                onClick={() => patch({ kind: k || null })}
                className={cn('h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium', kind === k ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card text-foreground/80 hover:text-foreground')}
              >
                {k ? t(`community.opp.kind.${k}`) : t('community.opp.all')}
              </button>
            ))}
          </div>
        </div>
      )}

      {data.isPending ? (
        <PostSkeletons />
      ) : data.isError ? (
        <div className="rounded-3xl border bg-card">
          <EmptyState
            icon={<Briefcase />}
            title={t('community.loadFailTitle')}
            body={t('community.loadFailBody')}
            action={<Button className="h-11 rounded-full px-6" onClick={() => void data.refetch()}>{t('community.retry')}</Button>}
          />
        </div>
      ) : tab === 'foryou' ? (
        data.data.offers.length === 0 ? (
          <div className="rounded-3xl border bg-card">
            <EmptyState
              icon={<Briefcase />}
              title={t('community.opp.emptyTitle')}
              body={t('community.opp.emptyBody')}
              action={<Button asChild className="h-12 rounded-full px-6 text-base"><Link to={to.start()}>{t('community.opp.fillProfile')}</Link></Button>}
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.data.offers.map((o) => (
              <li key={o.id}>
                <OfferCard offer={o} applied={data.data.applications.some((a) => a.opportunities?.id === o.id)} onOpen={() => patch({ id: o.id })} />
              </li>
            ))}
          </ul>
        )
      ) : (
        <Applications apps={data.data.applications} />
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && patch({ id: null })}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl p-0 sm:mx-auto sm:max-w-xl">
          {current ? (
            <OfferDetail offer={current} applied={!!data.data?.applications.some((a) => a.opportunities?.id === current.id)} onDone={() => patch({ id: null, tab: 'applied' })} />
          ) : (
            <div className="p-6">
              <SheetHeader className="p-0">
                <SheetTitle>{t('community.opp.notFoundTitle')}</SheetTitle>
                <SheetDescription>{data.isPending ? t('common.loading') : t('community.opp.notFoundBody')}</SheetDescription>
              </SheetHeader>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function Money({ offer }: { offer: Offer }) {
  const { t } = useTranslation()
  const free = !offer.fee_inr
  return (
    <div className="flex flex-wrap items-center gap-2">
      {free ? (
        <span className="inline-flex h-8 items-center rounded-full bg-highlight px-3.5 text-sm font-bold uppercase tracking-wide text-highlight-foreground">{t('community.opp.free')}</span>
      ) : (
        <span className="inline-flex h-8 items-center rounded-full bg-tile-rose px-3.5 text-sm font-bold text-tile-foreground">{t('community.opp.fee', { amount: formatInr(offer.fee_inr as number) })}</span>
      )}
      {!!offer.stipend_monthly && (
        <span className="inline-flex h-8 items-center rounded-full bg-tile-mint px-3.5 text-sm font-semibold text-tile-foreground">{t('community.opp.stipend', { amount: formatInr(offer.stipend_monthly) })}</span>
      )}
    </div>
  )
}

function OfferCard({ offer, applied, onOpen }: { offer: Offer; applied: boolean; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <button type="button" onClick={onOpen} className="flex w-full flex-col gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-accent/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">{t(`community.opp.kind.${offer.kind}`, { defaultValue: offer.kind })}</span>
        {offer.verified && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground/80">
            <BadgeCheck className="size-4" />
            {t('community.opp.verified')}
          </span>
        )}
        {applied && <span className="ml-auto rounded-full bg-tile-mint px-2.5 py-0.5 text-xs font-semibold text-tile-foreground">{t('community.opp.appliedTag')}</span>}
      </div>
      <div>
        <h3 className="text-base font-semibold leading-snug sm:text-lg">{offer.title}</h3>
        {offer.org_name && <p className="text-sm text-muted-foreground">{offer.org_name}</p>}
      </div>
      <Money offer={offer} />
      <div className="flex flex-wrap items-center gap-2">
        {offer.deadline && <DeadlineChip deadline={offer.deadline} />}
        {offer.match === 'needs_info' && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-tile-peach px-3 text-xs font-semibold text-tile-foreground">
            <CircleHelp className="size-3.5" />
            {t('community.opp.needsInfoShort', { count: offer.missing.length })}
          </span>
        )}
      </div>
    </button>
  )
}

function OfferDetail({ offer, applied, onDone }: { offer: Offer; applied: boolean; onDone: () => void }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [reporting, setReporting] = useState(false)
  const eligible = offer.match === 'eligible'

  const apply = useMutation({
    mutationFn: () => api(`/api/v1/opportunities/${offer.id}/apply`, { method: 'POST', body: JSON.stringify({ note: note.trim() || null }) }),
    onSuccess: () => {
      toast.success(t('community.opp.applySent'))
      void qc.invalidateQueries({ queryKey: ['opportunities'] })
      onDone()
    },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('community.tryAgain')),
  })

  return (
    <div className="flex flex-col gap-5 p-5">
      <SheetHeader className="gap-2 p-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">{t(`community.opp.kind.${offer.kind}`, { defaultValue: offer.kind })}</span>
          {offer.verified && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold">
              <BadgeCheck className="size-4" />
              {t('community.opp.verified')}
            </span>
          )}
        </div>
        <div className="flex items-start gap-1">
          <SheetTitle className="text-xl leading-snug">{offer.title}</SheetTitle>
          <SpeakButton text={`${offer.title}. ${offer.description ?? ''}`} />
        </div>
        <SheetDescription>{offer.org_name ? t('community.opp.from', { name: offer.org_name }) : ''}</SheetDescription>
      </SheetHeader>

      <Money offer={offer} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        {offer.deadline && (
          <span className="inline-flex items-center gap-2">
            <DeadlineChip deadline={offer.deadline} />
            {formatDate(offer.deadline, lang)}
          </span>
        )}
        {(offer.location || offer.is_remote) && (
          <span className="inline-flex items-center gap-1.5">
            {offer.is_remote ? <Wifi className="size-4" /> : <MapPin className="size-4" />}
            {offer.is_remote ? t('community.opp.remote') : offer.location}
          </span>
        )}
        {!!offer.seats && (
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-4" />
            {t('community.opp.seats', { count: offer.seats })}
          </span>
        )}
      </div>

      {offer.description && <p className="whitespace-pre-wrap text-base leading-relaxed">{offer.description}</p>}

      {offer.criteria_labels.length > 0 && (
        <div className="rounded-2xl bg-surface p-4">
          <p className="mb-2 text-sm font-semibold">{t('community.opp.why')}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {offer.criteria_labels.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {offer.match === 'needs_info' && (
        <div className="rounded-2xl bg-tile-peach p-4 text-tile-foreground">
          <p className="flex items-center gap-2 font-semibold">
            <CircleHelp className="size-5" />
            {t('community.opp.needsInfo')}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {offer.missing.map((m) => (
              <li key={m}>{t(`facts.${m}.q`, { defaultValue: m })}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild className="h-11 rounded-full px-5"><Link to={to.start()}>{t('community.opp.answerNow')}</Link></Button>
            <Button asChild variant="outline" className="h-11 rounded-full bg-card px-5"><Link to={to.money()}>{t('community.opp.seeMoney')}</Link></Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="apply-note" className="text-sm font-medium">{t('community.opp.noteLabel')}</label>
        <Textarea id="apply-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} disabled={!eligible || applied} placeholder={t('community.opp.notePlaceholder')} className="rounded-2xl px-4 py-3 text-base" />
        <Button size="lg" className="h-14 rounded-full text-base" disabled={!eligible || applied || apply.isPending} onClick={() => apply.mutate()}>
          {applied ? t('community.opp.alreadyApplied') : apply.isPending ? t('community.posting') : t('community.opp.apply')}
        </Button>
        {!eligible && !applied && <p className="text-sm text-muted-foreground">{t('community.opp.cannotApply')}</p>}
        {offer.apply_url && (
          <a href={offer.apply_url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm font-medium underline underline-offset-4">
            {t('community.opp.officialLink')}
          </a>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm text-muted-foreground">{t('community.opp.safetyBody')}</p>
        <Button variant="ghost" className="h-11 w-fit rounded-full px-4 text-muted-foreground" onClick={() => setReporting(true)}>
          <Flag className="size-4" />
          {t('community.opp.reportOffer')}
        </Button>
      </div>
      {reporting && <ReportDialog open onOpenChange={(o) => !o && setReporting(false)} kind="opportunity" targetId={offer.id} />}
    </div>
  )
}

function Applications({ apps }: { apps: Application[] }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  if (!apps.length)
    return (
      <div className="rounded-3xl border bg-card">
        <EmptyState icon={<Briefcase />} title={t('community.opp.noAppsTitle')} body={t('community.opp.noAppsBody')} />
      </div>
    )
  return (
    <ul className="flex flex-col gap-3">
      {apps.map((a) => {
        const rejected = a.status === 'rejected'
        const at = STEPS.indexOf(a.status as (typeof STEPS)[number])
        return (
          <li key={a.id} className="rounded-2xl border bg-card p-4">
            <p className="font-semibold">{a.opportunities?.title}</p>
            <p className="text-sm text-muted-foreground">
              {a.opportunities?.organizations?.name} · {t('community.opp.appliedOn', { when: timeAgo(a.created_at, lang) })}
            </p>
            {rejected ? (
              <p className="mt-3 rounded-xl bg-muted p-3 text-sm">{t('community.opp.status.rejected')}</p>
            ) : (
              <ol className="mt-4 flex flex-col gap-3">
                {STEPS.map((s, i) => {
                  const done = i <= at
                  return (
                    <li key={s} className="flex items-center gap-3">
                      <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-xs font-bold', done ? 'border-transparent bg-highlight text-highlight-foreground' : 'text-muted-foreground')}>{done ? '✓' : i + 1}</span>
                      <span className={cn('text-sm', i === at ? 'font-semibold' : done ? '' : 'text-muted-foreground')}>{t(`community.opp.status.${s}`)}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </li>
        )
      })}
    </ul>
  )
}
