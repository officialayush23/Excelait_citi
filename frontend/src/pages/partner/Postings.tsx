import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BellRing, Megaphone, Pencil, Plus, Send, Users, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { describeCriteria } from '@/components/partner/criteria'
import { OfferSheet } from '@/components/partner/OfferSheet'
import { useActiveOrg, useOffers, type Offer } from '@/components/partner/partnerApi'
import { Chip, ErrorNote, ListSkeleton, OfferChip, OrgSwitcher, VerifyBanner } from '@/components/partner/shared'
import { EmptyState } from '@/components/page/EmptyState'
import { KpiCard, KpiRow } from '@/components/page/Kpi'
import { PageHeader } from '@/components/page/PageHeader'
import { ListRow, SplitView } from '@/components/page/SplitView'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { careerBySlug } from '@/data/catalogue'
import { api } from '@/lib/api'
import { formatInr } from '@/lib/format'

export function Postings() {
  const { t } = useTranslation()
  const { org, orgs, setOrgId, isLoading: orgsLoading, error: orgsError, refetch } = useActiveOrg()
  const offers = useOffers(org?.id)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ open: boolean; offer: Offer | null }>({ open: false, offer: null })

  if (orgsLoading)
    return (
      <>
        <PageHeader title={t('nav.postings')} back />
        <ListSkeleton rows={3} />
      </>
    )
  if (orgsError)
    return (
      <>
        <PageHeader title={t('nav.postings')} back />
        <ErrorNote error={orgsError} onRetry={() => void refetch()} />
      </>
    )
  if (!org)
    return (
      <>
        <PageHeader title={t('nav.postings')} back />
        <div className="rounded-3xl border bg-card">
          <EmptyState
            icon={<Megaphone />}
            title={t('partner.noOrgTitle')}
            body={t('partner.noOrgBody')}
            action={
              <Button asChild className="h-11 rounded-full px-6">
                <Link to="/app/organisation">{t('partner.noOrgAction')}</Link>
              </Button>
            }
          />
        </div>
      </>
    )

  const list = offers.data ?? []
  const current = list.find((o) => o.id === selectedId) ?? list[0] ?? null
  const open = list.filter((o) => o.status === 'open').length
  const applicants = list.reduce((n, o) => n + o.applicants, 0)
  const notified = list.reduce((n, o) => n + (o.notified_count ?? 0), 0)

  return (
    <>
      <PageHeader
        title={t('nav.postings')}
        subtitle={t('partner.postings.lead')}
        back
        actions={
          <Button className="h-10 rounded-full px-5" onClick={() => setSheet({ open: true, offer: null })}>
            <Plus data-icon="inline-start" />
            {t('partner.postings.new')}
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3">
        <OrgSwitcher orgs={orgs} value={org.id} onChange={(id) => { setOrgId(id); setSelectedId(null) }} />
        {org.verification_status !== 'verified' && <VerifyBanner org={org} />}
      </div>

      <KpiRow className="mb-6 xl:grid-cols-3">
        <KpiCard tone="highlight" label={t('partner.kpi.open')} value={offers.isLoading ? null : open} icon={<Megaphone />} />
        <KpiCard tone="mint" label={t('partner.kpi.applicants')} value={offers.isLoading ? null : applicants} icon={<Users />} />
        <KpiCard tone="plain" label={t('partner.kpi.notified')} value={offers.isLoading ? null : notified} hint={t('partner.kpi.notifiedHint')} icon={<BellRing />} className="col-span-2 xl:col-span-1" />
      </KpiRow>

      {offers.error && <ErrorNote error={offers.error} onRetry={() => void offers.refetch()} />}
      {offers.isLoading && <ListSkeleton rows={4} />}

      {offers.data && list.length === 0 && (
        <div className="rounded-3xl border bg-card">
          <EmptyState
            icon={<Megaphone />}
            title={t('partner.postings.emptyTitle')}
            body={t('partner.postings.emptyBody')}
            action={
              <Button className="h-11 rounded-full px-6" onClick={() => setSheet({ open: true, offer: null })}>
                <Plus data-icon="inline-start" />
                {t('partner.postings.new')}
              </Button>
            }
          />
        </div>
      )}

      {current && (
        <SplitView
          listTitle={<h2 className="text-lg font-semibold">{t('partner.postings.listTitle')}</h2>}
          list={list.map((o) => (
            <ListRow
              key={o.id}
              selected={o.id === current.id}
              onSelect={() => setSelectedId(o.id)}
              leading={
                <span className="grid size-10 place-items-center rounded-xl bg-muted text-foreground">
                  <Megaphone className="size-5" />
                </span>
              }
              title={o.title}
              subtitle={t('partner.postings.rowSub', { kind: t(`partner.offerKind.${o.kind}`), n: o.applicants })}
              trailing={<OfferChip status={o.status} />}
            />
          ))}
          detailKey={current.id}
          detail={<OfferDetail org={org} offer={current} onEdit={() => setSheet({ open: true, offer: current })} />}
        />
      )}

      <OfferSheet orgId={org.id} offer={sheet.offer} open={sheet.open} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} />
    </>
  )
}

function OfferDetail({ org, offer, onEdit }: { org: { id: string; verification_status: string }; offer: Offer; onEdit: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'publish' | 'close' | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['partner', 'offers', org.id] })

  const publish = useMutation({
    mutationFn: () => api<Offer>(`/api/v1/partner/orgs/${org.id}/offers/${offer.id}/publish`, { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(t('partner.postings.published', { count: r.notified_count ?? 0 }))
      setConfirm(null)
      void refresh()
    },
  })
  const close = useMutation({
    mutationFn: () => api<Offer>(`/api/v1/partner/orgs/${org.id}/offers/${offer.id}/close`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(t('partner.postings.closed'))
      setConfirm(null)
      void refresh()
    },
  })

  const verified = org.verification_status === 'verified'
  const careers = offer.career_slugs.map((s) => careerBySlug[s]?.name ?? s)
  const fee = offer.fee_inr ? formatInr(offer.fee_inr) : t('partner.form.freeLabel')

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap gap-2">
          <OfferChip status={offer.status} />
          <Chip>{t(`partner.offerKind.${offer.kind}`)}</Chip>
          <Chip tone={offer.fee_inr ? 'bg-tile-peach text-tile-foreground' : 'bg-tile-mint text-tile-foreground'}>{fee}</Chip>
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{offer.title}</h2>
        {offer.description && <p className="mt-2 whitespace-pre-line text-muted-foreground">{offer.description}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('partner.kpi.applicants')} value={String(offer.applicants)} />
        <Stat label={t('partner.postings.notifiedLabel')} value={offer.status === 'draft' ? '—' : String(offer.notified_count ?? 0)} />
        <Stat label={t('partner.form.deadline')} value={offer.deadline ?? '—'} />
        <Stat label={t('partner.form.seats')} value={offer.seats != null ? String(offer.seats) : '—'} />
      </div>

      <dl className="flex flex-col gap-3 rounded-2xl border bg-card p-4 text-sm">
        <Row label={t('partner.postings.forWhom')} value={describeCriteria(offer.criteria ?? {}, t)} />
        <Row label={t('partner.form.where')} value={offer.is_remote ? t('partner.form.remote') : [offer.location, offer.district, offer.state].filter(Boolean).join(', ') || '—'} />
        {careers.length > 0 && <Row label={t('partner.form.careers')} value={careers.join(', ')} />}
        {offer.program_slugs.length > 0 && <Row label={t('partner.form.programs')} value={offer.program_slugs.join(', ')} />}
      </dl>

      {(publish.error || close.error) && !confirm && <ErrorNote error={publish.error ?? close.error} />}

      <div className="flex flex-wrap gap-2">
        {offer.status !== 'closed' && (
          <Button variant="outline" className="rounded-full" onClick={onEdit}>
            <Pencil data-icon="inline-start" />
            {t('partner.postings.edit')}
          </Button>
        )}
        {offer.status === 'draft' && (
          <Button className="rounded-full" onClick={() => setConfirm('publish')}>
            <Send data-icon="inline-start" />
            {t('partner.postings.publish')}
          </Button>
        )}
        {offer.status === 'open' && (
          <Button variant="destructive" className="rounded-full" onClick={() => setConfirm('close')}>
            <XCircle data-icon="inline-start" />
            {t('partner.postings.close')}
          </Button>
        )}
        <Button asChild variant="ghost" className="rounded-full">
          <Link to={`/app/applicants?offer=${offer.id}`}>
            <Users data-icon="inline-start" />
            {t('partner.postings.viewApplicants')}
          </Link>
        </Button>
      </div>
      {offer.status === 'draft' && !verified && <p className="text-sm text-muted-foreground">{t('partner.postings.needVerified')}</p>}

      <Dialog open={confirm === 'publish'} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('partner.postings.publishTitle')}</DialogTitle>
            <DialogDescription>{t('partner.postings.publishBody')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl bg-surface p-3 text-sm">
            <p className="font-medium">{offer.title}</p>
            <p className="text-muted-foreground">{describeCriteria(offer.criteria ?? {}, t)}</p>
          </div>
          {!verified && <ErrorNote error={new Error(t('partner.postings.needVerified'))} />}
          {publish.error && <ErrorNote error={publish.error} />}
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setConfirm(null)}>
              {t('partner.cancel')}
            </Button>
            <Button className="rounded-full" disabled={publish.isPending || !verified} onClick={() => publish.mutate()}>
              {publish.isPending ? t('partner.postings.publishing') : t('partner.postings.publishConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm === 'close'} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('partner.postings.closeTitle')}</DialogTitle>
            <DialogDescription>{t('partner.postings.closeBody')}</DialogDescription>
          </DialogHeader>
          {close.error && <ErrorNote error={close.error} />}
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setConfirm(null)}>
              {t('partner.cancel')}
            </Button>
            <Button variant="destructive" className="rounded-full" disabled={close.isPending} onClick={() => close.mutate()}>
              {t('partner.postings.closeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold">{value}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

