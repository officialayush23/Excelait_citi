import { FileText, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LANGUAGES } from '@/i18n'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

import { useLesson, useUpload } from './api'
import { LessonProgress } from './LessonProgress'

const MAX_BYTES = 10 * 1024 * 1024
const MAIN = ['hi', 'mr', 'en']

export function UploadCard() {
  const { t, i18n } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState(MAIN.includes(i18n.language) ? i18n.language : 'hi')
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lessonId, setLessonId] = useState<string | null>(null)
  const upload = useUpload()
  const lesson = useLesson(lessonId ?? undefined)

  useEffect(() => {
    if (lesson.data?.status === 'failed') setError(lesson.data.error ?? t('learn.failed'))
  }, [lesson.data?.status, lesson.data?.error, t])

  const pick = (f: File | undefined) => {
    setError(null)
    if (!f) return
    if (!(f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))) return setError(t('learn.notPdf'))
    if (f.size > MAX_BYTES) return setError(t('learn.tooBig'))
    setFile(f)
  }

  const start = () => {
    if (!file) return
    setError(null)
    upload.mutate(
      { file, language, title },
      {
        onSuccess: (r) => setLessonId(r.id),
        onError: (e) => setError(e instanceof ApiError && e.status === 422 && /scan/i.test(e.message) ? t('learn.scan') : e instanceof ApiError ? e.message : t('learn.tryAgain')),
      },
    )
  }

  const reset = () => {
    setFile(null)
    setTitle('')
    setLessonId(null)
    setError(null)
    upload.reset()
  }

  const status = lesson.data?.status
  const busy = upload.isPending || status === 'processing' || (!!lessonId && !lesson.data)
  const langs = more ? LANGUAGES : LANGUAGES.filter((l) => MAIN.includes(l.code))

  return (
    <section className="flex flex-col gap-4 rounded-3xl border bg-card p-5 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('learn.uploadTitle')}</h2>
        <p className="text-muted-foreground">{t('learn.uploadBody')}</p>
      </div>

      {busy && <LessonProgress stage={upload.isPending ? 'uploading' : (lesson.data?.stage ?? 'writing')} />}

      {status === 'ready' && lessonId && (
        <div className="flex flex-col gap-3 rounded-2xl bg-highlight p-4 text-highlight-foreground">
          <p className="text-lg font-medium">{t('learn.readyTitle', { title: lesson.data?.title })}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="h-12 rounded-full px-6 text-base"><Link to={`/app/lessons/${lessonId}`}>{t('learn.openLesson')}</Link></Button>
            <Button variant="outline" onClick={reset} className="h-12 rounded-full px-6 text-base">{t('learn.another')}</Button>
          </div>
        </div>
      )}

      {!busy && status !== 'ready' && (
        <>
          <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <div className="flex items-center gap-3 rounded-2xl border bg-surface p-3">
              <FileText className="size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <button type="button" onClick={() => setFile(null)} aria-label={t('learn.removeFile')} className="grid size-11 place-items-center rounded-full hover:bg-muted">
                <X className="size-5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center hover:bg-muted/50"
            >
              <Upload className="size-8" />
              <span className="text-lg font-medium">{t('learn.pickPdf')}</span>
              <span className="text-sm text-muted-foreground">{t('learn.pickHint')}</span>
            </button>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('learn.language')}</span>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {langs.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={language === l.code}
                  onClick={() => setLanguage(l.code)}
                  className={cn(
                    'h-11 rounded-full border px-5 text-base',
                    language === l.code ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card hover:bg-muted',
                  )}
                >
                  {l.label}
                </button>
              ))}
              {!more && (
                <button type="button" onClick={() => setMore(true)} className="h-11 rounded-full px-4 text-sm text-muted-foreground underline-offset-4 hover:underline">
                  {t('learn.moreLanguages')}
                </button>
              )}
            </div>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('learn.titleLabel')}</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder={t('learn.titlePlaceholder')} className="h-12 rounded-xl text-base" />
          </label>

          <Button disabled={!file} onClick={start} className="h-14 rounded-full text-lg">{t('learn.make')}</Button>
        </>
      )}

      {error && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p>{error}</p>
          {lessonId && <Button variant="outline" onClick={reset} className="h-11 w-fit rounded-full px-5">{t('learn.tryAnother')}</Button>}
        </div>
      )}
    </section>
  )
}
