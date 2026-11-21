import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, RotateCcw, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { ErrorNote } from '@/components/partner/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Review queue for Skill Passport submissions. Coded to the contract:
 *   GET  /api/v1/passport/review                       -> { submissions: Submission[] } (a bare array also works)
 *   POST /api/v1/passport/review/{id} {decision: 'approve' | 'needs_work', comment, criteria: [{id, ok}]}
 * Evidence entries may be plain URLs or {url|signed_url, content_type?}; the API signs them.
 */
type Evidence = { url: string; isImage: boolean }
type Submission = {
  id: string
  student: string
  task: string
  instructions: string | null
  note: string | null
  created_at: string | null
  evidence: Evidence[]
  criteria: { id: string; name: string; pass?: string }[]
}

type Raw = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const IMG = /\.(png|jpe?g|gif|webp|avif|heic)(\?|$)/i

function normalize(r: Raw): Submission {
  const ev: unknown[] = r.evidence ?? r.evidence_urls ?? r.evidence_signed ?? []
  const evidence = ev
    .map((e): Evidence | null => {
      if (typeof e === 'string') return { url: e, isImage: IMG.test(e) || e.includes('/image') }
      const o = e as Raw
      const url = o.signed_url ?? o.url ?? o.signedUrl
      if (!url) return null
      return { url, isImage: (o.content_type ?? o.type ?? '').startsWith('image') || IMG.test(String(o.path ?? url)) }
    })
    .filter((x): x is Evidence => !!x)
  const crit: unknown[] = Array.isArray(r.rubric) ? r.rubric : (r.criteria ?? r.rubric?.criteria ?? r.task?.rubric?.criteria ?? [])
  return {
    id: r.id ?? r.submission_id,
    student: r.student_name ?? r.student?.full_name ?? r.student?.name ?? 'Student',
    task: r.task_title ?? r.task?.title ?? 'Task',
    instructions: r.instructions ?? r.task?.instructions ?? null,
    note: r.note ?? null,
    created_at: r.created_at ?? null,
    evidence,
    criteria: crit
      .map((c, i) =>
        typeof c === 'string'
          ? { id: `c${i + 1}`, name: c }
          : { id: String((c as Raw).id ?? `c${i + 1}`), name: String((c as Raw).name ?? (c as Raw).title ?? ''), pass: (c as Raw).pass_text as string | undefined },
      )
      .filter((c) => c.name),
  }
}

function useQueue() {
  return useQuery({
    queryKey: ['teacher', 'verify'],
    queryFn: async () => {
      const res = await api<Raw[] | { submissions?: Raw[]; items?: Raw[] }>('/api/v1/passport/review')
      const list = Array.isArray(res) ? res : (res.submissions ?? res.items ?? [])
      return list.map(normalize)
    },
  })
}

export function Verify() {
  const { t } = useTranslation()
  const q = useQueue()
  return (
    <>
      <PageHeader title={t('nav.verify')} subtitle={t('teacher.verify.lead')} />
      {q.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {q.data.map((s) => (
            <ReviewCard key={s.id} s={s} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={<ClipboardCheck />} title={t('teacher.verify.emptyTitle')} body={t('teacher.verify.emptyBody')} />
      )}
    </>
  )
}

function ReviewCard({ s }: { s: Submission }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [met, setMet] = useState<Record<string, boolean>>({})
  const [comment, setComment] = useState('')
  const allMet = s.criteria.every((c) => met[c.id])
  const send = useMutation({
    mutationFn: (decision: 'approved' | 'resubmit') =>
      api(`/api/v1/passport/review/${s.id}`, {
        method: 'POST',
        body: JSON.stringify({ decision: decision === 'approved' ? 'approve' : 'needs_work', comment: comment.trim(), criteria: s.criteria.map((c) => ({ id: c.id, ok: !!met[c.id] })) }),
      }),
    onSuccess: (_d, decision) => {
      toast.success(decision === 'approved' ? t('teacher.verify.approved') : t('teacher.verify.sentBack'))
      void qc.invalidateQueries({ queryKey: ['teacher', 'verify'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('teacher.error')),
  })

  return (
    <li className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{s.task}</h2>
          <p className="text-sm text-muted-foreground">
            {s.student}
            {s.created_at && ` · ${new Date(s.created_at).toLocaleDateString()}`}
          </p>
        </div>
      </div>
      {s.instructions && <p className="mt-2 text-sm text-muted-foreground">{s.instructions}</p>}
      {s.note && <p className="mt-3 rounded-xl bg-muted p-3 text-sm">“{s.note}”</p>}

      {s.evidence.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {s.evidence.map((e, i) => (
            <a key={i} href={e.url} target="_blank" rel="noreferrer" className="group block size-28 overflow-hidden rounded-xl border bg-muted sm:size-32">
              {e.isImage ? (
                <img src={e.url} alt={t('teacher.verify.evidence', { n: i + 1 })} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" />
              ) : (
                <span className="grid size-full place-items-center p-2 text-center text-xs">{t('teacher.verify.openFile', { n: i + 1 })}</span>
              )}
            </a>
          ))}
        </div>
      )}

      {s.criteria.length > 0 && (
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-medium">{t('teacher.verify.criteria')}</legend>
          <div className="flex flex-col gap-2">
            {s.criteria.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm has-[:checked]:bg-muted">
                <input type="checkbox" className="size-5 accent-current" checked={!!met[c.id]} onChange={(e) => setMet((m) => ({ ...m, [c.id]: e.target.checked }))} />
                <span>
                  <span className="font-medium">{c.name}</span>
                  {c.pass && <span className="block text-muted-foreground">{c.pass}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <Textarea className="mt-4" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('teacher.verify.comment')} aria-label={t('teacher.verify.comment')} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="rounded-full" disabled={!allMet || send.isPending} onClick={() => send.mutate('approved')}>
          <ThumbsUp data-icon="inline-start" />
          {t('teacher.verify.approve')}
        </Button>
        <Button variant="outline" className={cn('rounded-full')} disabled={comment.trim().length < 3 || send.isPending} onClick={() => send.mutate('resubmit')}>
          <RotateCcw data-icon="inline-start" />
          {t('teacher.verify.needsWork')}
        </Button>
      </div>
      {!allMet && s.criteria.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{t('teacher.verify.approveHint')}</p>}
    </li>
  )
}
