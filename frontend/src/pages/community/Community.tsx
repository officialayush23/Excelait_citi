import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GraduationCap, Lock, MessagesSquare, Plus, Search, Sparkles, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useAuth } from '@/auth/AuthProvider'
import { Composer } from '@/components/community/Composer'
import { PostCard } from '@/components/community/PostCard'
import { PostSkeletons, type Post } from '@/components/community/shared'
import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { careerBySlug, careerName, examBySlug } from '@/data/catalogue'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

const TABS = ['questions', 'board', 'stories', 'seniors', 'circles'] as const
type Tab = (typeof TABS)[number]
const TAB_KIND: Partial<Record<Tab, Post['kind']>> = { questions: 'question', board: 'opportunity', stories: 'story' }
const KIND_TAB: Record<string, Tab> = { question: 'questions', opportunity: 'board', story: 'stories' }

type Group = { id: string; slug: string; name: string; kind: string; women_only: boolean; description: string | null }
type Senior = { id: string; full_name: string | null; senior_path: string | null; bio: string | null }
type FeedPost = Post & { has_accepted?: boolean }

export function Community() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [composer, setComposer] = useState(false)

  // Old notification links point at ?post=<id>.
  const legacyPost = params.get('post')
  if (legacyPost) return <Navigate to={`/app/community/${legacyPost}`} replace />

  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : KIND_TAB[params.get('kind') ?? ''] ?? 'questions'

  function setTab(next: Tab) {
    const p = new URLSearchParams(params)
    p.set('tab', next)
    p.delete('kind')
    if (next === 'circles' || next === 'seniors') p.delete('group')
    setParams(p, { replace: true })
  }

  return (
    <>
      <PageHeader
        title={t('community.title')}
        subtitle={t('community.subtitle')}
        back
        actions={
          <Button size="lg" className="h-12 rounded-full px-5 text-base" onClick={() => setComposer(true)}>
            <Plus className="size-5" />
            {t('community.ask')}
          </Button>
        }
      />

      <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label={t('community.title')}>
        <div className="flex w-max gap-2">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'h-11 shrink-0 rounded-full border px-5 text-base font-medium transition-colors',
                tab === id ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card text-foreground/80 hover:text-foreground',
              )}
            >
              {t(`community.tabs.${id}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'seniors' ? <Seniors /> : tab === 'circles' ? <Circles onOpen={(id) => setParams({ tab: 'questions', group: id })} /> : <Feed tab={tab} />}

      <Composer open={composer} onOpenChange={setComposer} defaultKind={tab === 'board' ? 'opportunity' : tab === 'stories' ? 'story' : 'question'} groupId={params.get('group')} />
    </>
  )
}

function Feed({ tab }: { tab: Tab }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const [params, setParams] = useSearchParams()
  const career = params.get('career')
  const exam = params.get('exam')
  const group = params.get('group')
  const kind = TAB_KIND[tab]
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), 350)
    return () => clearTimeout(id)
  }, [q])

  const posts = useQuery({
    queryKey: ['community', 'posts', kind, career, exam, group, search],
    queryFn: () => {
      const p = new URLSearchParams()
      if (kind) p.set('kind', kind)
      if (career) p.set('career', career)
      if (exam) p.set('exam', exam)
      if (group) p.set('group', group)
      if (search) p.set('q', search)
      return api<{ posts: FeedPost[] }>(`/api/v1/community/posts?${p}`)
    },
  })

  function drop(key: string) {
    const p = new URLSearchParams(params)
    p.delete(key)
    setParams(p, { replace: true })
  }

  const active: { key: string; label: string }[] = []
  if (career) active.push({ key: 'career', label: careerBySlug[career] ? careerName(careerBySlug[career], lang) : career })
  if (exam) active.push({ key: 'exam', label: examBySlug[exam]?.name ?? exam })
  if (group) active.push({ key: 'group', label: t('community.thisCircle') })

  const girlsOnly = posts.error instanceof ApiError && posts.error.status === 403

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('community.searchPlaceholder')} aria-label={t('common.search')} className="h-12 rounded-full pl-12 text-base" />
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {active.map((a) => (
            <button key={a.key} type="button" onClick={() => drop(a.key)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-nav-active px-3.5 text-sm font-medium text-nav-active-foreground">
              {a.label}
              <X className="size-3.5" aria-label={t('common.clear')} />
            </button>
          ))}
        </div>
      )}

      {tab === 'board' && <p className="rounded-2xl bg-surface p-3 text-sm text-muted-foreground">{t('community.boardNote')}</p>}

      {posts.isPending ? (
        <PostSkeletons />
      ) : girlsOnly ? (
        <div className="rounded-3xl border bg-card">
          <EmptyState icon={<Lock />} title={t('community.girlsOnlyTitle')} body={t('community.girlsOnlyBody')} />
        </div>
      ) : posts.isError ? (
        <div className="rounded-3xl border bg-card">
          <EmptyState
            icon={<MessagesSquare />}
            title={t('community.loadFailTitle')}
            body={t('community.loadFailBody')}
            action={<Button className="h-11 rounded-full px-6" onClick={() => void posts.refetch()}>{t('community.retry')}</Button>}
          />
        </div>
      ) : posts.data.posts.length === 0 ? (
        <div className="rounded-3xl border bg-card">
          <EmptyState icon={<MessagesSquare />} title={t(`community.empty.${tab}.title`)} body={t(`community.empty.${tab}.body`)} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.data.posts.map((p) => (
            <PostCard key={p.id} post={p} answered={p.has_accepted} />
          ))}
        </div>
      )}
    </div>
  )
}

function Circles({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const groups = useQuery({ queryKey: ['community', 'groups'], queryFn: () => api<{ joined: Group[]; suggested: Group[] }>('/api/v1/community/groups') })
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api(`/api/v1/community/groups/${id}/join?on=${on}`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['community', 'groups'] }),
    onError: (e) => toast.error(e instanceof ApiError && e.status === 403 ? t('community.girlsOnlyBody') : t('community.tryAgain')),
  })

  if (groups.isPending) return <PostSkeletons count={3} />
  if (groups.isError)
    return (
      <div className="rounded-3xl border bg-card">
        <EmptyState icon={<Users />} title={t('community.loadFailTitle')} body={t('community.loadFailBody')} action={<Button className="h-11 rounded-full px-6" onClick={() => void groups.refetch()}>{t('community.retry')}</Button>} />
      </div>
    )

  const { joined, suggested } = groups.data
  const row = (g: Group, isJoined: boolean) => (
    <li key={g.id} className="flex items-center gap-3 rounded-2xl border bg-card p-3">
      <button type="button" onClick={() => isJoined && onOpen(g.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" disabled={!isJoined}>
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl text-tile-foreground', g.women_only ? 'bg-tile-rose' : g.kind === 'exam' ? 'bg-tile-lilac' : 'bg-tile-sky')}>
          {g.women_only ? <Sparkles className="size-5" /> : <Users className="size-5" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{g.women_only ? t('community.girlsSpace') : g.name}</span>
          <span className="block truncate text-sm text-muted-foreground">{isJoined ? t('community.openCircle') : g.women_only ? t('community.girlsSpaceDesc') : t(`community.circleKind.${g.kind}`, { defaultValue: '' })}</span>
        </span>
      </button>
      <Button
        variant={isJoined ? 'outline' : 'default'}
        className="h-11 shrink-0 rounded-full px-5"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate({ id: g.id, on: !isJoined })}
      >
        {isJoined ? t('community.leave') : t('community.join')}
      </Button>
    </li>
  )

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t('community.myCircles')}</h2>
        {joined.length ? (
          <ul className="flex flex-col gap-2">{joined.map((g) => row(g, true))}</ul>
        ) : (
          <div className="rounded-3xl border bg-card">
            <EmptyState icon={<Users />} title={t('community.noCirclesTitle')} body={t('community.noCirclesBody')} />
          </div>
        )}
      </section>
      {suggested.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t('community.suggested')}</h2>
          <ul className="flex flex-col gap-2">{suggested.map((g) => row(g, false))}</ul>
        </section>
      )}
    </div>
  )
}

function Seniors() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), 350)
    return () => clearTimeout(id)
  }, [q])
  const seniors = useQuery({
    queryKey: ['community', 'seniors', search],
    queryFn: () => api<{ seniors: Senior[] }>(`/api/v1/community/seniors${search ? `?q=${encodeURIComponent(search)}` : ''}`),
  })
  const me = seniors.data?.seniors.find((s) => s.id === session?.user.id)
  const [path, setPath] = useState('')
  const [bio, setBio] = useState('')
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (me) {
      setPath(me.senior_path ?? '')
      setBio(me.bio ?? '')
    }
  }, [me])

  const save = useMutation({
    mutationFn: (is_senior: boolean) =>
      api('/api/v1/community/me/senior', { method: 'PUT', body: JSON.stringify({ is_senior, senior_path: is_senior ? path.trim() : null, bio: is_senior ? bio.trim() || null : null }) }),
    onSuccess: (_, is_senior) => {
      toast.success(is_senior ? t('community.seniorSaved') : t('community.seniorStopped'))
      setEditing(false)
      void qc.invalidateQueries({ queryKey: ['community', 'seniors'] })
    },
    onError: () => toast.error(t('community.tryAgain')),
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-3xl bg-tile-lilac p-5 text-tile-foreground">
        <div className="flex items-start gap-3">
          <GraduationCap className="mt-0.5 size-6 shrink-0" />
          <div>
            <h2 className="text-lg font-semibold">{t('community.seniorsTitle')}</h2>
            <p className="mt-1 text-sm opacity-80">{t('community.seniorsBody')}</p>
          </div>
        </div>
        {!editing && (
          <Button className="mt-4 h-12 rounded-full px-6 text-base" onClick={() => setEditing(true)}>
            {me ? t('community.editSenior') : t('community.becomeSenior')}
          </Button>
        )}
        {editing && (
          <form
            className="mt-4 flex flex-col gap-3 rounded-2xl bg-card p-4 text-card-foreground"
            onSubmit={(e) => {
              e.preventDefault()
              if (path.trim().length >= 2) save.mutate(true)
            }}
          >
            <label htmlFor="senior-path" className="text-sm font-medium">{t('community.seniorPath')}</label>
            <Input id="senior-path" value={path} onChange={(e) => setPath(e.target.value)} maxLength={200} placeholder={t('community.seniorPathHint')} className="h-12 rounded-2xl px-4 text-base" />
            <label htmlFor="senior-bio" className="text-sm font-medium">{t('community.seniorBio')}</label>
            <Textarea id="senior-bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={3} placeholder={t('community.seniorBioHint')} className="rounded-2xl px-4 py-3 text-base" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="h-12 rounded-full px-6 text-base" disabled={save.isPending || path.trim().length < 2}>{t('common.save')}</Button>
              <Button type="button" variant="ghost" className="h-12 rounded-full px-5" onClick={() => setEditing(false)}>{t('community.cancel')}</Button>
              {me && (
                <Button type="button" variant="ghost" className="h-12 rounded-full px-5 text-destructive" disabled={save.isPending} onClick={() => save.mutate(false)}>
                  {t('community.stopSenior')}
                </Button>
              )}
            </div>
          </form>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('community.seniorSearch')} aria-label={t('common.search')} className="h-12 rounded-full pl-12 text-base" />
      </div>

      {seniors.isPending ? (
        <PostSkeletons count={3} />
      ) : seniors.isError ? (
        <div className="rounded-3xl border bg-card">
          <EmptyState icon={<GraduationCap />} title={t('community.loadFailTitle')} body={t('community.loadFailBody')} action={<Button className="h-11 rounded-full px-6" onClick={() => void seniors.refetch()}>{t('community.retry')}</Button>} />
        </div>
      ) : seniors.data.seniors.length === 0 ? (
        <div className="rounded-3xl border bg-card">
          <EmptyState icon={<GraduationCap />} title={t('community.noSeniorsTitle')} body={t('community.noSeniorsBody')} />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {seniors.data.seniors.map((s) => (
            <li key={s.id} className="flex gap-3 rounded-2xl border bg-card p-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-highlight text-lg font-semibold text-highlight-foreground">{(s.full_name || '?').slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0">
                <p className="font-semibold">
                  {s.full_name || t('community.someone')}
                  {s.id === session?.user.id && <span className="ml-2 text-sm font-normal text-muted-foreground">({t('community.you')})</span>}
                </p>
                {s.senior_path && <p className="text-sm font-medium text-foreground/80">{s.senior_path}</p>}
                {s.bio && <p className="mt-1 text-sm text-muted-foreground">{s.bio}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
