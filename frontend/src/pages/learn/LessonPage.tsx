import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { LoadError, Note, PageSkeleton, PillTabs } from '@/components/explore/shared'
import { useDeleteLesson, useLesson, useShare } from '@/components/learn/api'
import { FlashcardsTab } from '@/components/learn/FlashcardsTab'
import { LessonProgress } from '@/components/learn/LessonProgress'
import { ListenTab } from '@/components/learn/ListenTab'
import { QuizTab } from '@/components/learn/QuizTab'
import { ReadTab } from '@/components/learn/ReadTab'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ApiError } from '@/lib/api'

type Tab = 'listen' | 'read' | 'quiz' | 'cards'

export function LessonPage() {
  const { id } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const lesson = useLesson(id)
  const [tab, setTab] = useState<Tab>('listen')
  const share = useShare(id ?? '')
  const del = useDeleteLesson()

  if (lesson.isLoading) return <PageSkeleton />
  if (lesson.isError || !lesson.data)
    return <LoadError notFound={lesson.error instanceof ApiError && lesson.error.status === 404} onRetry={() => void lesson.refetch()} />
  const l = lesson.data

  const remove = () => {
    if (!window.confirm(t('learn.deleteConfirm'))) return
    del.mutate(l.id, { onSuccess: () => navigate('/app/lessons', { replace: true }), onError: () => toast.error(t('learn.tryAgain')) })
  }

  const owner = l.is_owner && (
    <Button variant="outline" onClick={remove} disabled={del.isPending} aria-label={t('learn.delete')} className="size-11 rounded-full">
      <Trash2 className="size-5" />
    </Button>
  )

  if (l.status !== 'ready') {
    return (
      <div className="flex flex-col gap-5 pb-8">
        <PageHeader title={l.title} back actions={owner} />
        {l.status === 'processing' ? (
          <div className="rounded-3xl border bg-card p-5"><LessonProgress stage={l.stage ?? 'writing'} /></div>
        ) : (
          <div className="flex flex-col gap-3">
            <Note tone="warn">{l.error ?? t('learn.failed')}</Note>
            <Button asChild className="h-12 w-fit rounded-full px-6 text-base"><Link to="/app/lessons">{t('learn.tryAnother')}</Link></Button>
          </div>
        )}
      </div>
    )
  }

  const sections = l.sections ?? []
  const tabs: { id: Tab; label: string }[] = [
    { id: 'listen', label: t('learn.tab.listen') },
    { id: 'read', label: t('learn.tab.read') },
    { id: 'quiz', label: t('learn.tab.quiz') },
    { id: 'cards', label: t('learn.tab.cards') },
  ]

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PageHeader title={l.title} subtitle={l.summary ?? undefined} back actions={owner} />
      {l.is_owner && (
        <label className="flex min-h-14 items-center justify-between gap-4 rounded-2xl border bg-card px-4 py-3">
          <span>
            <span className="block font-medium">{t('learn.shareLabel')}</span>
            <span className="block text-sm text-muted-foreground">{l.is_public ? t('learn.shareOn') : t('learn.shareOff')}</span>
          </span>
          <Switch
            checked={l.is_public}
            disabled={share.isPending}
            onCheckedChange={(v) => share.mutate(v, { onError: () => toast.error(t('learn.tryAgain')) })}
            aria-label={t('learn.shareLabel')}
          />
        </label>
      )}
      {l.error && <Note tone="warn">{t('learn.someAudioMissing')}</Note>}
      <PillTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'listen' && <ListenTab sections={sections} />}
      {tab === 'read' && <ReadTab summary={l.summary} sections={sections} terms={l.key_terms ?? []} />}
      {tab === 'quiz' && <QuizTab key={l.id} lessonId={l.id} questions={l.quiz?.questions ?? []} />}
      {tab === 'cards' && <FlashcardsTab cards={l.flashcards ?? []} />}
      <p className="text-sm text-muted-foreground">{t('learn.grounded')}</p>
    </div>
  )
}
