import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, EyeOff, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { errMsg } from '@/components/partner/partnerApi'
import { Chip, ErrorNote, ListSkeleton } from '@/components/partner/shared'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type Post = { id: string; title: string | null; body: string | null; kind: string | null; created_at: string }
type Comment = { id: string; post_id: string; body: string; created_at: string }
type Report = { id: string; target_kind: string; target_id: string; reason: string | null; created_at: string }
type Queue = { posts: Post[]; comments: Comment[]; reports: Report[] }

type Tab = 'posts' | 'comments' | 'reports'

export function Moderation() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('posts')
  const q = useQuery({ queryKey: ['admin', 'moderation'], queryFn: () => api<Queue>('/api/v1/community/moderation') })
  const data = q.data
  const counts: Record<Tab, number> = { posts: data?.posts.length ?? 0, comments: data?.comments.length ?? 0, reports: data?.reports.length ?? 0 }

  return (
    <>
      <PageHeader title={t('nav.moderation')} subtitle={t('partner.mod.lead')} back />
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {(['posts', 'comments', 'reports'] as Tab[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
              tab === k ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card text-foreground/80 hover:text-foreground',
            )}
          >
            {t(`partner.mod.tab_${k}`)}
            <span className={cn('grid min-w-5 place-items-center rounded-full px-1.5 text-xs', tab === k ? 'bg-background/20' : 'bg-muted')}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {q.error && <ErrorNote error={q.error} onRetry={() => void q.refetch()} />}
      {q.isLoading && <ListSkeleton rows={4} />}
      {data && counts[tab] === 0 && (
        <div className="rounded-3xl border bg-card">
          <EmptyState icon={<ShieldCheck />} title={t('partner.mod.emptyTitle')} body={t(`partner.mod.empty_${tab}`)} />
        </div>
      )}
      {data && tab === 'posts' && (
        <ul className="flex flex-col gap-3">
          {data.posts.map((p) => (
            <ModItem key={p.id} kind="post" id={p.id} chip={p.kind ?? undefined} title={p.title ?? undefined} body={p.body ?? ''} at={p.created_at} />
          ))}
        </ul>
      )}
      {data && tab === 'comments' && (
        <ul className="flex flex-col gap-3">
          {data.comments.map((c) => (
            <ModItem key={c.id} kind="comment" id={c.id} body={c.body} at={c.created_at} />
          ))}
        </ul>
      )}
      {data && tab === 'reports' && (
        <ul className="flex flex-col gap-3">
          {data.reports.map((r) => (
            <ModItem
              key={r.id}
              kind={r.target_kind === 'post' || r.target_kind === 'comment' ? r.target_kind : null}
              id={r.target_id}
              chip={t(`partner.mod.target_${r.target_kind}`, { defaultValue: r.target_kind })}
              body={r.reason || t('partner.mod.noReason')}
              at={r.created_at}
              reportId={r.id}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function ModItem({
  kind, id, chip, title, body, at, reportId,
}: { kind: 'post' | 'comment' | null; id: string; chip?: string; title?: string; body: string; at: string; reportId?: string }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const act = useMutation({
    mutationFn: (approve: boolean) => api('/api/v1/community/moderation', { method: 'POST', body: JSON.stringify({ kind, target_id: id, approve }) }),
    onSuccess: (_r, approve) => {
      toast.success(t(approve ? 'partner.mod.approvedToast' : 'partner.mod.hiddenToast'))
      void qc.invalidateQueries({ queryKey: ['admin', 'moderation'] })
    },
    onError: (e) => toast.error(errMsg(e, t('partner.errorGeneric'))),
  })
  return (
    <li className="flex flex-col gap-3 rounded-3xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5" data-report={reportId}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {chip && <Chip>{chip}</Chip>}
          <span className="text-xs text-muted-foreground">{new Date(at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
        {title && <p className="mt-2 font-semibold">{title}</p>}
        <p className="mt-1 whitespace-pre-line break-words text-muted-foreground">{body}</p>
      </div>
      {kind ? (
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" className="rounded-full" disabled={act.isPending} onClick={() => act.mutate(true)}>
            <Check data-icon="inline-start" />
            {t('partner.mod.approve')}
          </Button>
          <Button variant="destructive" className="rounded-full" disabled={act.isPending} onClick={() => act.mutate(false)}>
            <EyeOff data-icon="inline-start" />
            {t('partner.mod.hide')}
          </Button>
        </div>
      ) : null}
    </li>
  )
}
