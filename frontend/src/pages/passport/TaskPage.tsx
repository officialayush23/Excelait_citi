import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, CheckCircle2, Clock, ImagePlus, Loader2, Mic, RotateCcw, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { MAX_BYTES, MAX_PHOTOS, type Criterion, type I18n, type Skill, type Submission, loc, shrinkImage, submitTask } from '@/components/passport/shared'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { startRecording, transcribe } from '@/lib/voice'
import { useUi } from '@/stores/ui'

type TaskData = {
  task: { id: string; title: string; title_i18n: I18n; instructions: string; steps: string[]; evidence_hint: string | null }
  skill: Pick<Skill, 'name' | 'name_i18n'> | null
  rubric: Criterion[]
  submissions: Submission[]
  credential_public_id: string | null
}
type Photo = { file: File; url: string }

export function TaskPage() {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['passport-task', id], queryFn: () => api<TaskData>(`/api/v1/passport/tasks/${id}`) })

  const [photos, setPhotos] = useState<Photo[]>([])
  const [note, setNote] = useState('')
  const [rec, setRec] = useState<{ stop: () => Promise<Blob> } | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const photosRef = useRef<Photo[]>([])
  useEffect(() => { photosRef.current = photos }, [photos])
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  const send = useMutation({
    mutationFn: () => submitTask(id, photos.map((p) => p.file), note),
    onSuccess: () => {
      toast.success(t('passport.task.sent'))
      photos.forEach((p) => URL.revokeObjectURL(p.url))
      setPhotos([])
      setNote('')
      void qc.invalidateQueries({ queryKey: ['passport-task', id] })
      void qc.invalidateQueries({ queryKey: ['passport-skills'] })
    },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('passport.task.failed')),
  })

  async function addFiles(list: FileList | null) {
    if (!list) return
    const next = [...photos]
    for (const f of Array.from(list)) {
      if (next.length >= MAX_PHOTOS) {
        toast.error(t('passport.task.maxPhotos'))
        break
      }
      try {
        const small = await shrinkImage(f)
        if (small.size > MAX_BYTES) throw new Error('big')
        next.push({ file: small, url: URL.createObjectURL(small) })
      } catch {
        toast.error(t('passport.task.badFile'))
      }
    }
    setPhotos(next)
  }

  async function toggleMic() {
    if (rec) {
      const r = rec
      setRec(null)
      setTranscribing(true)
      try {
        const text = await transcribe(await r.stop(), lang)
        setNote((n) => (n ? `${n} ${text}` : text).slice(0, 2000))
      } catch {
        toast.error(t('passport.task.micError'))
      } finally {
        setTranscribing(false)
      }
      return
    }
    try {
      setRec(await startRecording())
    } catch {
      toast.error(t('passport.task.micError'))
    }
  }

  if (q.isPending) return <><PageHeader title="" back /><Loader2 className="size-6 animate-spin text-muted-foreground" /></>
  if (q.isError)
    return (
      <>
        <PageHeader title={t('passport.title')} back />
        <div className="rounded-3xl border bg-card">
          <EmptyState icon={<Clock />} title={t('passport.task.notFound')} body={t('community.loadFailBody')} action={<Button className="h-11 rounded-full px-6" onClick={() => void q.refetch()}>{t('community.retry')}</Button>} />
        </div>
      </>
    )

  const { task, skill, rubric, submissions, credential_public_id } = q.data
  const last = submissions[0]
  const waiting = last?.status === 'submitted'
  const approved = last?.status === 'approved' || !!credential_public_id
  const canSend = !waiting && !approved
  const empty = photos.length === 0 && !note.trim()

  return (
    <>
      <PageHeader title={loc(task.title, task.title_i18n, lang)} subtitle={skill ? loc(skill.name, skill.name_i18n, lang) : undefined} back />

      {waiting && <Banner tone="bg-tile-sky" icon={<Clock className="size-6" />} title={t('passport.task.waitingTitle')} body={t('passport.task.waitingBody')} />}
      {approved && (
        <Banner tone="bg-highlight text-highlight-foreground" icon={<CheckCircle2 className="size-6" />} title={t('passport.task.approvedTitle')} body={t('passport.task.approvedBody')}
          action={<Button asChild className="h-11 rounded-full px-5"><Link to="/app/passport">{t('passport.task.viewCredential')}</Link></Button>} />
      )}
      {last?.status === 'resubmit' && (
        <Banner tone="bg-tile-peach" icon={<RotateCcw className="size-6" />} title={t('passport.task.needsWorkTitle')} body={last.review?.comment || ''}>
          {last.review && last.review.criteria.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {last.review.criteria.map((c) => {
                const name = rubric.find((r) => r.id === c.id)?.name ?? c.id
                return (
                  <li key={c.id}>
                    <span className="font-semibold">{c.ok ? '✓' : '✗'} {name}</span>
                    {c.comment && <span> — {c.comment}</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </Banner>
      )}

      <section className="mb-5 rounded-3xl border bg-card p-5">
        <h2 className="mb-2 text-lg font-semibold">{t('passport.task.steps')}</h2>
        <p className="mb-3 text-muted-foreground">{task.instructions}</p>
        <ol className="flex flex-col gap-2">
          {task.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold">{i + 1}</span>
              <span className="text-sm leading-relaxed sm:text-base">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-5 rounded-3xl bg-surface p-5">
        <h2 className="text-lg font-semibold">{t('passport.task.rubricTitle')}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{t('passport.task.rubricHint')}</p>
        <ul className="flex flex-col gap-2">
          {rubric.map((c) => (
            <li key={c.id} className="flex gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <span className="text-sm"><span className="font-semibold">{c.name}</span>{c.pass_text ? ` — ${c.pass_text}` : ''}</span>
            </li>
          ))}
        </ul>
      </section>

      {canSend && (
        <section className="mb-8 flex flex-col gap-4 rounded-3xl border bg-card p-5">
          <div>
            <h2 className="text-lg font-semibold">{t('passport.task.evidenceTitle')}</h2>
            <p className="text-sm text-muted-foreground">{task.evidence_hint ?? t('passport.task.evidenceHint')}</p>
          </div>

          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {photos.map((p, i) => (
                <li key={p.url} className="relative aspect-square overflow-hidden rounded-xl border">
                  <img src={p.url} alt="" className="size-full object-cover" />
                  <button type="button" aria-label={t('passport.task.remove')} onClick={() => { URL.revokeObjectURL(p.url); setPhotos(photos.filter((_, j) => j !== i)) }}
                    className="absolute right-1 top-1 grid size-8 place-items-center rounded-full bg-background/90 text-foreground shadow">
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
            <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
            <Button type="button" className="h-12 rounded-full px-5" disabled={photos.length >= MAX_PHOTOS} onClick={() => cameraRef.current?.click()}>
              <Camera className="size-5" />{t('passport.task.takePhoto')}
            </Button>
            <Button type="button" variant="outline" className="h-12 rounded-full px-5" disabled={photos.length >= MAX_PHOTOS} onClick={() => galleryRef.current?.click()}>
              <ImagePlus className="size-5" />{t('passport.task.addPhoto')}
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="task-note" className="text-sm font-medium">{t('passport.task.noteLabel')}</label>
            <Textarea id="task-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} placeholder={t('passport.task.notePlaceholder')} className="rounded-2xl px-4 py-3 text-base" />
            <Button type="button" variant="outline" className={cn('h-11 w-fit rounded-full px-4', rec && 'border-destructive text-destructive')} disabled={transcribing} onClick={() => void toggleMic()}>
              {transcribing ? <Loader2 className="size-4 animate-spin" /> : rec ? <Square className="size-4" /> : <Mic className="size-4" />}
              {transcribing ? t('passport.task.transcribing') : rec ? t('passport.task.stopRecording') : t('passport.task.speak')}
            </Button>
          </div>

          <Button size="lg" className="h-14 rounded-full text-base" disabled={send.isPending || empty} onClick={() => send.mutate()}>
            {send.isPending ? t('passport.task.submitting') : last?.status === 'resubmit' ? t('passport.task.tryAgain') : t('passport.task.submit')}
          </Button>
          {empty && <p className="text-center text-sm text-muted-foreground">{t('passport.task.needPhotoOrNote')}</p>}
        </section>
      )}

      {last && last.evidence_urls.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">{t('passport.task.yourSubmission')}</h2>
          <ul className="grid grid-cols-3 gap-2">
            {last.evidence_urls.map((u) => (
              <li key={u} className="aspect-square overflow-hidden rounded-xl border"><img src={u} alt="" className="size-full object-cover" /></li>
            ))}
          </ul>
          {last.note && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{last.note}</p>}
        </section>
      )}
    </>
  )
}

function Banner({ tone, icon, title, body, action, children }: { tone: string; icon: React.ReactNode; title: string; body: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={cn('mb-5 flex items-start gap-3 rounded-3xl p-5 text-tile-foreground', tone)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {body && <p className="text-sm opacity-90">{body}</p>}
        {children}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  )
}
