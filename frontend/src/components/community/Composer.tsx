import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { KIND_ICON, VoiceButton, type Post } from '@/components/community/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { careerName, careers, exams } from '@/data/catalogue'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

const KINDS = ['question', 'opportunity', 'story', 'resource', 'post'] as const
type Kind = (typeof KINDS)[number]

function Pick({ options, value, onToggle, label }: { options: { id: string; label: string }[]; value: string[]; onToggle: (id: string) => void; label: string }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const shown = options.filter((o) => value.includes(o.id) || o.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12)
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">{label}</label>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('community.searchTags')} className="h-11 rounded-full px-4 text-base" />
      <div className="flex flex-wrap gap-1.5">
        {shown.map((o) => {
          const on = value.includes(o.id)
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o.id)}
              className={cn('h-9 rounded-full border px-3.5 text-sm font-medium', on ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card hover:bg-accent/50')}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Bottom sheet to ask a question or share an opportunity, story or resource. */
export function Composer({ open, onOpenChange, defaultKind = 'question', groupId }: { open: boolean; onOpenChange: (o: boolean) => void; defaultKind?: Kind; groupId?: string | null }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const qc = useQueryClient()
  const [kind, setKind] = useState<Kind>(defaultKind)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [careerTags, setCareerTags] = useState<string[]>([])
  const [examTags, setExamTags] = useState<string[]>([])
  const [deadline, setDeadline] = useState('')
  const [link, setLink] = useState('')
  const [held, setHeld] = useState(false)

  const toggle = (list: string[], set: (v: string[]) => void) => (id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const post = useMutation({
    mutationFn: () =>
      api<Post & { held_for_review: boolean }>('/api/v1/community/posts', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          title: title.trim(),
          body: body.trim() || null,
          group_id: groupId ?? null,
          tags: { careers: careerTags, exams: examTags },
          deadline: kind === 'opportunity' && deadline ? deadline : null,
          link: kind === 'opportunity' && link.trim() ? link.trim() : null,
          language: lang,
        }),
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['community', 'posts'] })
      if (res.held_for_review) {
        setHeld(true)
        return
      }
      toast.success(t('community.posted'))
      reset()
      onOpenChange(false)
    },
    onError: () => toast.error(t('community.tryAgain')),
  })

  function reset() {
    setTitle('')
    setBody('')
    setCareerTags([])
    setExamTags([])
    setDeadline('')
    setLink('')
    setHeld(false)
  }

  const canSend = title.trim().length >= 3 && !post.isPending

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <SheetContent side="bottom" className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-3xl p-0 sm:mx-auto sm:max-w-xl">
        <SheetHeader className="p-5 pb-2">
          <SheetTitle className="text-xl">{t('community.askTitle')}</SheetTitle>
          <SheetDescription>{t('community.askBody')}</SheetDescription>
        </SheetHeader>

        {held ? (
          <div className="flex flex-col items-center gap-4 p-6 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-tile-peach text-tile-foreground">
              <ShieldAlert className="size-7" />
            </span>
            <p className="text-lg font-semibold">{t('community.heldTitle')}</p>
            <p className="text-muted-foreground">{t('community.heldBody')}</p>
            <Button
              size="lg"
              className="h-12 rounded-full px-8 text-base"
              onClick={() => {
                reset()
                onOpenChange(false)
              }}
            >
              {t('community.ok')}
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-5 p-5 pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (canSend) post.mutate()
            }}
          >
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('community.kindLabel')}>
              {KINDS.map((k) => {
                const Icon = KIND_ICON[k]
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => setKind(k)}
                    className={cn('inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium', kind === k ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card hover:bg-accent/50')}
                  >
                    <Icon className="size-4" />
                    {t(`community.kind.${k}`)}
                  </button>
                )
              })}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="post-title" className="text-sm font-medium">{t('community.titleLabel')}</label>
              <Input id="post-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t(`community.titleHint.${kind}`)} className="h-12 rounded-2xl px-4 text-base" />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="post-body" className="text-sm font-medium">{t('community.bodyLabel')}</label>
              <Textarea id="post-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={4} placeholder={t('community.bodyHint')} className="rounded-2xl px-4 py-3 text-base" />
              <VoiceButton onText={(s) => setBody((b) => (b ? `${b} ${s}` : s))} />
            </div>

            {kind === 'opportunity' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label htmlFor="post-deadline" className="text-sm font-medium">{t('community.deadlineLabel')}</label>
                  <Input id="post-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="h-12 rounded-2xl px-4 text-base" />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="post-link" className="text-sm font-medium">{t('community.linkLabel')}</label>
                  <Input id="post-link" type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" className="h-12 rounded-2xl px-4 text-base" />
                </div>
              </div>
            )}

            <Pick label={t('community.careerTags')} options={careers.map((c) => ({ id: c.slug, label: careerName(c, lang) }))} value={careerTags} onToggle={toggle(careerTags, setCareerTags)} />
            <Pick label={t('community.examTags')} options={exams.map((x) => ({ id: x.slug, label: x.name }))} value={examTags} onToggle={toggle(examTags, setExamTags)} />

            <p className="flex items-start gap-2 rounded-2xl bg-surface p-3 text-sm text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              {t('community.safeNote')}
            </p>

            <Button type="submit" size="lg" disabled={!canSend} className="h-14 rounded-full text-base">
              {post.isPending ? t('community.posting') : t('community.post')}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
