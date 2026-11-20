import { useQueries, useQuery } from '@tanstack/react-query'
import { ArrowRight, BadgeCheck, BellRing, Building2, Flag, Megaphone, MessageSquare, ShieldCheck, UserSearch, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { KpiCard, KpiRow } from '@/components/page/Kpi'
import { PageHeader } from '@/components/page/PageHeader'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

import { useOrgs, type Offer, type Org } from './partnerApi'
import { ErrorNote, VerifyBanner } from './shared'

function QuickLink({ to, icon, title, body }: { to: string; icon: ReactNode; title: string; body: string }) {
  return (
    <Link to={to} className="group flex items-center gap-4 rounded-3xl border bg-card p-4 transition-colors hover:bg-accent sm:p-5">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-muted [&_svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{body}</span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

export function PartnerHome({ roleName }: { roleName: string }) {
  const { t } = useTranslation()
  const orgsQ = useOrgs()
  const orgs: Org[] = orgsQ.data ?? []
  const offerQs = useQueries({
    queries: orgs.map((o) => ({
      queryKey: ['partner', 'offers', o.id],
      queryFn: () => api<{ offers: Offer[] }>(`/api/v1/partner/orgs/${o.id}/offers`).then((r) => r.offers),
    })),
  })
  const loading = orgsQ.isLoading || offerQs.some((q) => q.isLoading)
  const offers = offerQs.flatMap((q) => q.data ?? [])
  const open = offers.filter((o) => o.status === 'open').length
  const applicants = offers.reduce((n, o) => n + o.applicants, 0)
  const notified = offers.reduce((n, o) => n + (o.notified_count ?? 0), 0)
  const primary = orgs[0]

  return (
    <>
      <PageHeader title={roleName} subtitle={primary ? primary.name : t('partner.home.leadNoOrg')} />
      {orgsQ.error && <ErrorNote error={orgsQ.error} onRetry={() => void orgsQ.refetch()} />}
      {primary && primary.verification_status !== 'verified' && (
        <div className="mb-5">
          <VerifyBanner org={primary} />
        </div>
      )}
      {!orgsQ.isLoading && !primary && !orgsQ.error && (
        <Link to="/app/organisation" className="mb-5 flex items-center gap-3 rounded-3xl bg-highlight p-5 text-highlight-foreground">
          <Building2 className="size-6 shrink-0" />
          <span className="flex-1">
            <span className="block font-semibold">{t('partner.noOrgTitle')}</span>
            <span className="block text-sm opacity-80">{t('partner.noOrgBody')}</span>
          </span>
          <ArrowRight className="size-5" />
        </Link>
      )}

      <KpiRow className="xl:grid-cols-3">
        <KpiCard tone="highlight" label={t('partner.kpi.open')} value={loading ? null : open} icon={<Megaphone />} />
        <KpiCard tone="mint" label={t('partner.kpi.applicants')} value={loading ? null : applicants} icon={<Users />} />
        <KpiCard tone="plain" label={t('partner.kpi.notified')} value={loading ? null : notified} hint={t('partner.kpi.notifiedHint')} icon={<BellRing />} className="col-span-2 xl:col-span-1" />
      </KpiRow>

      <div className={cn('mt-8 grid gap-3 lg:grid-cols-3')}>
        <QuickLink to="/app/postings" icon={<Megaphone />} title={t('nav.postings')} body={t('partner.home.postingsBody')} />
        <QuickLink to="/app/applicants" icon={<UserSearch />} title={t('nav.applicants')} body={t('partner.home.applicantsBody')} />
        <QuickLink to="/app/organisation" icon={<Building2 />} title={t('nav.organisation')} body={t('partner.home.orgBody')} />
      </div>
    </>
  )
}

export function AdminHome({ roleName }: { roleName: string }) {
  const { t } = useTranslation()
  const pending = useQuery({ queryKey: ['admin', 'orgs', 'pending'], queryFn: () => api<{ orgs: Org[] }>('/api/v1/admin/orgs/pending').then((r) => r.orgs) })
  const mod = useQuery({
    queryKey: ['admin', 'moderation'],
    queryFn: () => api<{ posts: unknown[]; comments: unknown[]; reports: unknown[] }>('/api/v1/community/moderation'),
  })
  const error = pending.error ?? mod.error

  return (
    <>
      <PageHeader title={roleName} subtitle={t('partner.home.adminLead')} />
      {error && (
        <div className="mb-5">
          <ErrorNote error={error} onRetry={() => { void pending.refetch(); void mod.refetch() }} />
        </div>
      )}
      <KpiRow>
        <KpiCard tone="highlight" label={t('partner.kpi.pendingOrgs')} value={pending.data ? pending.data.length : null} icon={<BadgeCheck />} />
        <KpiCard tone="peach" label={t('partner.kpi.flaggedPosts')} value={mod.data ? mod.data.posts.length : null} icon={<Flag />} />
        <KpiCard tone="plain" label={t('partner.kpi.pendingComments')} value={mod.data ? mod.data.comments.length : null} icon={<MessageSquare />} />
        <KpiCard tone="plain" label={t('partner.kpi.openReports')} value={mod.data ? mod.data.reports.length : null} icon={<ShieldCheck />} />
      </KpiRow>
      <div className="mt-8 grid gap-3 lg:grid-cols-2">
        <QuickLink to="/app/partners" icon={<BadgeCheck />} title={t('nav.partners')} body={t('partner.home.partnersBody')} />
        <QuickLink to="/app/moderation" icon={<ShieldCheck />} title={t('nav.moderation')} body={t('partner.home.moderationBody')} />
      </div>
    </>
  )
}
