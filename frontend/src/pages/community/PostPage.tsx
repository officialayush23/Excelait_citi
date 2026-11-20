import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, CircleCheck, Flag, Lock, MessageCircle, SearchX, Send, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useAuth } from '@/auth/AuthProvider'
import { ReportDialog } from '@/components/community/ReportDialog'
import { AuthorLine, DeadlineChip, KIND_ICON, KIND_TONE, TagChips, VoiceButton, formatDate, timeAgo, type Post } from '@/components/community/shared'
import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { careerBySlug, careerName, examBySlug } from '@/data/catalogue'
import { api, ApiError } from '@/lib/api'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

type Comment = {
  id: string
  author_id: string
  body: string
  is_accepted: boolean
  verified: boolean
  created_at: string
  author_name: string | null
  author_senior: boolean | null
  author_path: string | null
}
type PostDetail = Post & { author_id: string; comments: Comment[] }

export function PostPage() {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const { id = '' } = useParams()
  const { session, role } = useAuth()
  const qc = useQueryClient()
  const key = ['community', 'post', id]
  const [answer, setAnswer] = useState('')
  const [report, setReport] = useState<{ kind: 'post' | 'comment'; id: string } | null>(null)
  const [myVote, setMyVote] = useState(0)

  const post = useQuery({ queryKey: key, queryFn: () => api<PostDetail>(`/api/v1/community/posts/${id}`), retry: false })
  const refresh = () => void qc.invalidateQueries({ queryKey: key })

  const send = useMutation({
    mutationFn: () => api<{ held_for_review: boolean }>(`/api/v1/community/posts/${id}/comments`, { method: 'POST', body: JSON.stringify({ body: answer.trim() }) }),
    onSuccess: (res) => {
      setAnswer('')
      toast.success(res.held_for_review ? t('community.answerHeld') : t('community.answerSent'))
      refresh()
    },
    onError: () => toast.error(t('community.tryAgain')),
  })
  const accept = useMutation({
    mutationFn: (cid: string) => api(`/api/v1/community/posts/${id}/comments/${cid}/accept`, { method: 'POST' }),
    onSuccess: refresh,
    onError: () => toast.error(t('community.tryAgain')),
  })
  const vote = useMutation({
    mutationFn: (value: -1 | 0 | 1) => api<{ score: number }>(`/api/v1/community/posts/${id}/vote`, { method: 'POST', body: JSON.stringify({ value }) }),
    onSuccess: (res, value) => {
      setMyVote(value)
      qc.setQueryData<PostDetail>(key, (p) => (p ? { ...p, score: res.score } : p))
    },
    onError: () => toast.error(t('community.tryAgain')),
  })

  if (post.isPending)
    return (
      <>
        <PageHeader title={t('community.title')} back />
        <div className="flex flex-col gap-3" aria-busy="true">
          <div className="h-44 animate-pulse rounded-3xl border bg-muted/50" />
          <div className="h-28 animate-pulse rounded-2xl border bg-muted/50" />
        </div>
      </>
    )

  if (post.isError) {
    const forbidden = post.error instanceof ApiError && post.error.status === 403
    return (
      <>
        <PageHeader title={t('community.title')} back />
        <div className="rounded-3xl border bg-card">
          <EmptyState
            icon={forbidden ? <Lock /> : <SearchX />}
            title={forbidden ? t('community.girlsOnlyTitle') : t('community.postGoneTitle')}
            body={forbidden ? t('community.girlsOnlyBody') : t('community.postGoneBody')}
            action={<Button asChild className="h-11 rounded-full px-6"><Link to={to.community()}>{t('community.backToFeed')}</Link></Button>}
          />
        </div>
      </>
    )
  }

  const p = post.data
  const Icon = KIND_ICON[p.kind] ?? KIND_ICON.post
  const isAsker = session?.user.id === p.author_id || ['admin', 'facilitator', 'mentor'].includes(role as string)
  const comments = [...p.comments].sort((a, b) => Number(b.is_accepted) - Number(a.is_accepted) || Number(b.verified) - Number(a.verified))
  const related = [
    ...(p.tags?.careers ?? []).map((c) => ({ key: `c-${c}`, label: careerBySlug[c] ? careerName(careerBySlug[c], lang) : c, to: to.career(c) })),
    ...(p.tags?.exams ?? []).map((x) => ({ key: `e-${x}`, label: examBySlug[x]?.name ?? x, to: to.exam(x) })),
  ]

  return (
    <>
      <PageHeader title={t(`community.kind.${p.kind}`)} back />

      <article className="rounded-3xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl text-tile-foreground', KIND_TONE[p.kind])}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1">
              <h1 className="text-xl font-semibold leading-snug sm:text-2xl">{p.title}</h1>
              <SpeakButton text={`${p.title}. ${p.body ?? ''}`} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <AuthorLine name={p.author_name} senior={p.author_senior} path={p.author_path} />
              <span className="text-xs text-muted-foreground">{timeAgo(p.created_at, lang)}</span>
            </div>
          </div>
        </div>
        {p.body && <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed">{p.body}</p>}
        {p.kind === 'opportunity' && (p.deadline || p.link) && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {p.deadline && <DeadlineChip deadline={p.deadline} />}
            {p.deadline && <span className="text-sm text-muted-foreground">{formatDate(p.deadline, lang)}</span>}
            {p.link && (
              <a href={p.link} target="_blank" rel="noopener noreferrer nofollow" className="text-sm font-medium underline underline-offset-4">
                {t('community.openLink')}
              </a>
            )}
          </div>
        )}
        {p.kind === 'opportunity' && <p className="mt-3 rounded-2xl bg-surface p-3 text-sm text-muted-foreground">{t('community.payNote')}</p>}
        <TagChips tags={p.tags} className="mt-4" />
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          <Button
            variant={myVote === 1 ? 'default' : 'outline'}
            className="h-11 rounded-full px-5"
            disabled={vote.isPending}
            aria-pressed={myVote === 1}
            onClick={() => vote.mutate(myVote === 1 ? 0 : 1)}
          >
            <ThumbsUp className="size-4" />
            {t('community.upvote')} · {p.score}
          </Button>
          <Button variant="ghost" className="h-11 rounded-full px-4 text-muted-foreground" onClick={() => setReport({ kind: 'post', id: p.id })}>
            <Flag className="size-4" />
            {t('community.report')}
          </Button>
        </div>
      </article>

      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <MessageCircle className="size-5" />
          {t('community.answerCount', { count: comments.length })}
        </h2>
        {comments.length === 0 ? (
          <p className="rounded-2xl border bg-card p-5 text-muted-foreground">{t('community.noAnswers')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {comments.map((c) => (
              <li key={c.id} className={cn('rounded-2xl border p-4', c.is_accepted ? 'border-transparent bg-tile-mint text-tile-foreground' : 'bg-card')}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {c.is_accepted && (
                    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-background/60 px-3 text-xs font-semibold">
                      <CircleCheck className="size-3.5" />
                      {t('community.acceptedAnswer')}
                    </span>
                  )}
                  {c.verified && !c.is_accepted && (
                    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-tile-mint px-3 text-xs font-semibold text-tile-foreground">
                      <BadgeCheck className="size-3.5" />
                      {t('community.verified')}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-base leading-relaxed">{c.body}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <AuthorLine name={c.author_name} senior={c.author_senior} path={c.author_path} verified={c.verified && c.is_accepted} />
                  <div className="flex items-center gap-1">
                    <SpeakButton text={c.body} />
                    {isAsker && !c.is_accepted && (
                      <Button size="sm" variant="outline" className="h-10 rounded-full px-4 text-sm" disabled={accept.isPending} onClick={() => accept.mutate(c.id)}>
                        <CircleCheck className="size-4" />
                        {t('community.accept')}
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="size-10 rounded-full" aria-label={t('community.report')} onClick={() => setReport({ kind: 'comment', id: c.id })}>
                      <Flag className="size-4" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-3xl border bg-card p-5">
        <h2 className="mb-3 text-lg font-semibold">{t('community.yourAnswer')}</h2>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (answer.trim()) send.mutate()
          }}
        >
          <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={3000} rows={4} aria-label={t('community.yourAnswer')} placeholder={t('community.answerHint')} className="rounded-2xl px-4 py-3 text-base" />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <VoiceButton onText={(s) => setAnswer((a) => (a ? `${a} ${s}` : s))} />
            <Button type="submit" size="lg" className="h-12 rounded-full px-6 text-base" disabled={!answer.trim() || send.isPending}>
              <Send className="size-5" />
              {t('community.sendAnswer')}
            </Button>
          </div>
        </form>
      </section>

      {related.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">{t('community.related')}</h2>
          <div className="flex flex-col gap-2">
            {related.map((r) => (
              <Link key={r.key} to={r.to} className="flex min-h-12 items-center justify-between rounded-2xl border bg-card px-4 py-3 font-medium hover:bg-accent/40">
                {r.label}
                <span aria-hidden="true">›</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {report && <ReportDialog open onOpenChange={(o) => !o && setReport(null)} kind={report.kind} targetId={report.id} />}
    </>
  )
}
