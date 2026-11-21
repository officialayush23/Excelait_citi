import { useQuery } from '@tanstack/react-query'
import { Library, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { ErrorNote } from '@/components/partner/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'

type Lesson = { id: string; title: string; language?: string | null; status?: string | null; summary?: string | null; created_at?: string | null; is_public?: boolean }

/** Lessons the teacher has created (GET /api/v1/learn/lessons), with a way to make more. */
export function Modules() {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['teacher', 'lessons'],
    queryFn: async () => {
      try {
        const res = await api<Lesson[] | { lessons?: Lesson[] }>('/api/v1/learn/lessons')
        return Array.isArray(res) ? res : (res.lessons ?? [])
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return [] // lessons API not deployed yet
        throw e
      }
    },
  })
  const create = (
    <Button asChild className="rounded-full">
      <Link to="/app/lessons">
        <Plus data-icon="inline-start" />
        {t('teacher.modules.create')}
      </Link>
    </Button>
  )
  return (
    <>
      <PageHeader title={t('nav.modules')} subtitle={t('teacher.modules.lead')} actions={create} />
      {q.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((l) => (
            <li key={l.id}>
              <Link to={`/app/lessons/${l.id}`} className="block h-full rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/50">
                <p className="font-semibold">{l.title}</p>
                {l.summary && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{l.summary}</p>}
                <p className="mt-3 flex flex-wrap gap-2 text-xs">
                  {l.status && <span className="rounded-full bg-muted px-2 py-0.5 capitalize">{l.status}</span>}
                  {l.language && <span className="rounded-full bg-muted px-2 py-0.5 uppercase">{l.language}</span>}
                  {l.is_public && <span className="rounded-full bg-highlight px-2 py-0.5 text-highlight-foreground">{t('teacher.modules.public')}</span>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Library />} title={t('teacher.modules.emptyTitle')} body={t('teacher.modules.emptyBody')} action={create} />
      )}
    </>
  )
}
