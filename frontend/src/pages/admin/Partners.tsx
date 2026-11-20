import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Check, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { ListRow, SplitView } from '@/components/page/SplitView'
import { errMsg, type Org } from '@/components/partner/partnerApi'
import { Chip, ErrorNote, ListSkeleton } from '@/components/partner/shared'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'

export function Partners() {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['admin', 'orgs', 'pending'], queryFn: () => api<{ orgs: Org[] }>('/api/v1/admin/orgs/pending').then((r) => r.orgs) })
  const list = q.data ?? []
  const current = list.find((o) => o.id === selectedId) ?? list[0] ?? null

  return (
    <>
      <PageHeader title={t('nav.partners')} subtitle={t('partner.admin.lead')} back />
      {q.error && <ErrorNote error={q.error} onRetry={() => void q.refetch()} />}
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.data && list.length === 0 && (
        <div className="rounded-3xl border bg-card">
          <EmptyState icon={<BadgeCheck />} title={t('partner.admin.emptyTitle')} body={t('partner.admin.emptyBody')} />
        </div>
      )}
      {current && (
        <SplitView
          listTitle={<h2 className="text-lg font-semibold">{t('partner.admin.queue', { count: list.length })}</h2>}
          list={list.map((o) => (
            <ListRow
              key={o.id}
              selected={o.id === current.id}
              onSelect={() => setSelectedId(o.id)}
              leading={
                <span className="grid size-10 place-items-center rounded-xl bg-tile-peach text-tile-foreground">
                  <BadgeCheck className="size-5" />
                </span>
              }
              title={o.name}
              subtitle={[t(`partner.kind.${o.kind}`), o.district, o.state].filter(Boolean).join(' · ')}
            />
          ))}
          detailKey={current.id}
          detail={<ReviewPanel key={current.id} org={current} />}
        />
      )}
    </>
  )
}

function ReviewPanel({ org }: { org: Org }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const review = useMutation({
    mutationFn: (approve: boolean) =>
      api(`/api/v1/admin/orgs/${org.id}/review`, { method: 'POST', body: JSON.stringify({ approve, reason: approve ? null : reason.trim() }) }),
    onSuccess: (_r, approve) => {
      toast.success(t(approve ? 'partner.admin.approved' : 'partner.admin.rejected', { name: org.name }))
      void qc.invalidateQueries({ queryKey: ['admin', 'orgs', 'pending'] })
    },
    onError: (e) => toast.error(errMsg(e, t('partner.errorGeneric'))),
  })

  const rows: [string, string | null][] = [
    [t('partner.org.kind'), t(`partner.kind.${org.kind}`)],
    [t('partner.org.state'), org.state],
    [t('partner.org.district'), org.district],
    [t('partner.org.email'), org.contact_email],
    [t('partner.org.phone'), org.phone],
    [t('partner.org.website'), org.website],
    ['AISHE', org.aishe_code],
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap gap-2">
          <Chip tone="bg-tile-peach text-tile-foreground">{t('partner.verify.pending')}</Chip>
          {org.aishe_code && <Chip tone="bg-tile-sky text-tile-foreground">{t('partner.admin.claimsListing')}</Chip>}
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{org.name}</h2>
        {org.about && <p className="mt-2 whitespace-pre-line text-muted-foreground">{org.about}</p>}
      </div>

      <dl className="flex flex-col gap-2.5 rounded-2xl border bg-card p-4 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 font-medium break-words">
              {v && k === t('partner.org.website') ? (
                <a href={v} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                  {v}
                </a>
              ) : (
                (v ?? '—')
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">{t('partner.admin.checkNote')}</p>

      {review.error && <ErrorNote error={review.error} />}

      {rejecting ? (
        <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
          <label className="text-sm font-medium" htmlFor="reject-reason">
            {t('partner.admin.reasonLabel')}
          </label>
          <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t('partner.admin.reasonPlaceholder')} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" className="rounded-full" onClick={() => setRejecting(false)}>
              {t('partner.cancel')}
            </Button>
            <Button variant="destructive" className="rounded-full" disabled={reason.trim().length < 3 || review.isPending} onClick={() => review.mutate(false)}>
              <X data-icon="inline-start" />
              {t('partner.admin.confirmReject')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button className="h-11 rounded-full px-6" disabled={review.isPending} onClick={() => review.mutate(true)}>
            <Check data-icon="inline-start" />
            {t('partner.admin.approve')}
          </Button>
          <Button variant="outline" className="h-11 rounded-full px-6" disabled={review.isPending} onClick={() => setRejecting(true)}>
            <X data-icon="inline-start" />
            {t('partner.admin.reject')}
          </Button>
        </div>
      )}
    </div>
  )
}
