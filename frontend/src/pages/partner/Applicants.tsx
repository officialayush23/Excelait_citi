import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { APPLICATION_STATUSES, errMsg, useActiveOrg, useOffers, type Applicant, type ApplicationStatus } from '@/components/partner/partnerApi'
import { Chip, ErrorNote, ListSkeleton, OfferChip, OrgSwitcher } from '@/components/partner/shared'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'

const STATUS_TONE: Record<ApplicationStatus, string> = {
  applied: 'bg-muted text-foreground',
  shortlisted: 'bg-tile-sky text-tile-foreground',
  interview: 'bg-tile-lilac text-tile-foreground',
  offered: 'bg-tile-peach text-tile-foreground',
  joined: 'bg-tile-mint text-tile-foreground',
  rejected: 'bg-tile-rose text-tile-foreground',
}

export function Applicants() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const { org, orgs, setOrgId, isLoading, error, refetch } = useActiveOrg()
  const offers = useOffers(org?.id)
  const list = offers.data ?? []
  const offerId = params.get('offer')
  const offer = list.find((o) => o.id === offerId) ?? list[0] ?? null

  if (isLoading)
    return (
      <>
        <PageHeader title={t('nav.applicants')} back />
        <ListSkeleton rows={4} />
      </>
    )
  if (error)
    return (
      <>
        <PageHeader title={t('nav.applicants')} back />
        <ErrorNote error={error} onRetry={() => void refetch()} />
      </>
    )
  if (!org || (offers.data && list.length === 0))
    return (
      <>
        <PageHeader title={t('nav.applicants')} back />
        <div className="rounded-3xl border bg-card">
          <EmptyState
            icon={<UserSearch />}
            title={t(org ? 'partner.applicants.noOffersTitle' : 'partner.noOrgTitle')}
            body={t(org ? 'partner.applicants.noOffersBody' : 'partner.noOrgBody')}
            action={
              <Button asChild className="h-11 rounded-full px-6">
                <Link to={org ? '/app/postings' : '/app/organisation'}>{t(org ? 'partner.applicants.goPostings' : 'partner.noOrgAction')}</Link>
              </Button>
            }
          />
        </div>
      </>
    )

  return (
    <>
      <PageHeader title={t('nav.applicants')} subtitle={t('partner.applicants.lead')} back />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <OrgSwitcher orgs={orgs} value={org.id} onChange={(id) => { setOrgId(id); setParams({}, { replace: true }) }} />
        {offers.isLoading ? (
          <div className="h-10 w-full max-w-md animate-pulse rounded-full bg-muted" />
        ) : (
          <Select value={offer?.id ?? ''} onValueChange={(v) => setParams({ offer: v }, { replace: true })}>
            <SelectTrigger className="h-10 w-full max-w-md rounded-full bg-card" aria-label={t('partner.applicants.pick')}>
              <SelectValue placeholder={t('partner.applicants.pick')} />
            </SelectTrigger>
            <SelectContent>
              {list.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.title} ({o.applicants})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {offer && <OfferChip status={offer.status} />}
      </div>

      {offers.error && <ErrorNote error={offers.error} onRetry={() => void offers.refetch()} />}
      {offer && <ApplicantTable orgId={org.id} offerId={offer.id} />}
    </>
  )
}

function ApplicantTable({ orgId, offerId }: { orgId: string; offerId: string }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const key = ['partner', 'applicants', orgId, offerId]
  const q = useQuery({ queryKey: key, queryFn: () => api<{ applicants: Applicant[] }>(`/api/v1/partner/orgs/${orgId}/offers/${offerId}/applicants`).then((r) => r.applicants) })

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: ApplicationStatus }) =>
      api(`/api/v1/partner/orgs/${orgId}/applications/${v.id}`, { method: 'PATCH', body: JSON.stringify({ status: v.status }) }),
    onSuccess: () => {
      toast.success(t('partner.applicants.updated'))
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: ['partner', 'offers', orgId] })
    },
    onError: (e) => toast.error(errMsg(e, t('partner.errorGeneric'))),
  })

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })

  if (q.isLoading) return <ListSkeleton rows={5} />
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
  const rows = q.data ?? []
  if (!rows.length)
    return (
      <div className="rounded-3xl border bg-card">
        <EmptyState icon={<UserSearch />} title={t('partner.applicants.emptyTitle')} body={t('partner.applicants.emptyBody')} />
      </div>
    )

  return (
    <div className="overflow-hidden rounded-3xl border bg-card">
      <p className="border-b px-5 py-3 text-sm text-muted-foreground">{t('partner.applicants.notifyNote')}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-surface text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">{t('partner.applicants.name')}</th>
              <th className="px-3 py-3 font-medium">{t('partner.applicants.note')}</th>
              <th className="px-3 py-3 font-medium">{t('partner.applicants.appliedOn')}</th>
              <th className="px-5 py-3 font-medium">{t('partner.applicants.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t align-top">
                <td className="px-5 py-3 font-medium">{a.profiles?.full_name ?? t('partner.applicants.anonymous')}</td>
                <td className="max-w-xs px-3 py-3 text-muted-foreground">{a.note || '—'}</td>
                <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{fmt(a.created_at)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Select value={a.status} disabled={setStatus.isPending} onValueChange={(v) => setStatus.mutate({ id: a.id, status: v as ApplicationStatus })}>
                      <SelectTrigger className="h-9 w-40 rounded-full" aria-label={t('partner.applicants.status')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {APPLICATION_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {t(`partner.appStatus.${s}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Chip tone={STATUS_TONE[a.status]} className="hidden lg:inline-flex">
                      {t(`partner.appStatus.${a.status}`)}
                    </Chip>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
