import { ArrowDown, ArrowUp, Camera, FileText, Images, Upload, X } from 'lucide-react'
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
const MAX_PHOTO_BYTES = 8 * 1024 * 1024
const MAX_PHOTOS = 10
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAIN = ['hi', 'mr', 'en']

type Photo = { id: string; file: File; url: string }

let photoSeq = 0
const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
const isPhoto = (f: File) => PHOTO_TYPES.includes(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)

export function UploadCard() {
  const { t, i18n } = useTranslation()
  const pdfInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
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

  // Thumbnails use object URLs; give them back when the card goes away.
  const live = useRef<Photo[]>([])
  useEffect(() => {
    live.current = photos
  }, [photos])
  useEffect(() => () => live.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  const clearPhotos = () => {
    setPhotos((cur) => {
      cur.forEach((p) => URL.revokeObjectURL(p.url))
      return []
    })
  }

  const pickPdf = (f: File | undefined) => {
    setError(null)
    if (!f) return
    if (!isPdf(f)) return setError(t('learn.notPdf'))
    if (f.size > MAX_BYTES) return setError(t('learn.tooBig'))
    clearPhotos()
    setFile(f)
  }

  const addPhotos = (list: FileList | null) => {
    setError(null)
    const picked = Array.from(list ?? [])
    if (!picked.length) return
    if (picked.some((f) => !isPhoto(f))) return setError(t('learn.notImage'))
    if (picked.some((f) => f.size > MAX_PHOTO_BYTES)) return setError(t('learn.photoTooBig'))
    if (photos.length + picked.length > MAX_PHOTOS) return setError(t('learn.tooManyPhotos'))
    setFile(null)
    setPhotos((cur) => [...cur, ...picked.map((f) => ({ id: `p${++photoSeq}`, file: f, url: URL.createObjectURL(f) }))])
  }

  const removePhoto = (id: string) =>
    setPhotos((cur) => {
      cur.filter((p) => p.id === id).forEach((p) => URL.revokeObjectURL(p.url))
      return cur.filter((p) => p.id !== id)
    })

  const move = (i: number, by: -1 | 1) =>
    setPhotos((cur) => {
      const j = i + by
      if (j < 0 || j >= cur.length) return cur
      const next = [...cur]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const files = file ? [file] : photos.map((p) => p.file)

  const start = () => {
    if (!files.length) return
    setError(null)
    upload.mutate(
      { files, language, title },
      {
        onSuccess: (r) => setLessonId(r.id),
        onError: (e) => setError(e instanceof ApiError ? e.message : t('learn.tryAgain')),
      },
    )
  }

  const reset = () => {
    setFile(null)
    clearPhotos()
    setTitle('')
    setLessonId(null)
    setError(null)
    upload.reset()
  }

  const status = lesson.data?.status
  const busy = upload.isPending || status === 'processing' || (!!lessonId && !lesson.data)
  const langs = more ? LANGUAGES : LANGUAGES.filter((l) => MAIN.includes(l.code))
  const ocr = lesson.data?.status === 'processing' && lesson.data.stage === 'reading' ? lesson.data.progress?.ocr : undefined

  return (
    <section className="flex flex-col gap-4 rounded-3xl border bg-card p-5 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('learn.uploadTitle')}</h2>
        <p className="text-muted-foreground">{t('learn.uploadBodyPhotos')}</p>
      </div>

      {busy && <LessonProgress stage={upload.isPending ? 'uploading' : (lesson.data?.stage ?? 'writing')} ocr={ocr} />}

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
          <input ref={pdfInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { pickPdf(e.target.files?.[0]); e.target.value = '' }} />
          {/* Phones open the camera for this one (one picture per tap); the other picks several from the gallery. */}
          <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
          <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />

          {file && (
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
          )}

          {photos.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('learn.photoOrder')}</span>
              <ol className="flex flex-col gap-2">
                {photos.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-2xl border bg-surface p-2">
                    <img src={p.url} alt={t('learn.photoN', { n: i + 1 })} className="size-16 shrink-0 rounded-lg object-cover" />
                    <span className="min-w-0 flex-1 truncate font-medium">{t('learn.photoN', { n: i + 1 })}</span>
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('learn.moveUp')} className="grid size-11 place-items-center rounded-full hover:bg-muted disabled:opacity-30">
                      <ArrowUp className="size-5" />
                    </button>
                    <button type="button" disabled={i === photos.length - 1} onClick={() => move(i, 1)} aria-label={t('learn.moveDown')} className="grid size-11 place-items-center rounded-full hover:bg-muted disabled:opacity-30">
                      <ArrowDown className="size-5" />
                    </button>
                    <button type="button" onClick={() => removePhoto(p.id)} aria-label={t('learn.removePhoto')} className="grid size-11 place-items-center rounded-full hover:bg-muted">
                      <X className="size-5" />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {!file && photos.length === 0 && (
            <button
              type="button"
              onClick={() => pdfInput.current?.click()}
              className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center hover:bg-muted/50"
            >
              <Upload className="size-8" />
              <span className="text-lg font-medium">{t('learn.pickPdf')}</span>
              <span className="text-sm text-muted-foreground">{t('learn.pdfHint')}</span>
            </button>
          )}

          {!file && (
            <div className="flex flex-col gap-2">
              {photos.length === 0 && <span className="text-center text-sm text-muted-foreground">{t('learn.orPhotos')}</span>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => cameraInput.current?.click()} disabled={photos.length >= MAX_PHOTOS} className="h-12 flex-1 rounded-full px-5 text-base">
                  <Camera className="size-5" /> {photos.length ? t('learn.addMorePhotos') : t('learn.takePhoto')}
                </Button>
                <Button type="button" variant="outline" onClick={() => galleryInput.current?.click()} disabled={photos.length >= MAX_PHOTOS} className="h-12 flex-1 rounded-full px-5 text-base">
                  <Images className="size-5" /> {t('learn.choosePhotos')}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{t('learn.photoHint')}</p>
              <p className="rounded-xl bg-muted/60 p-3 text-sm">{t('learn.photoTip')}</p>
            </div>
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

          <Button disabled={!files.length} onClick={start} className="h-14 rounded-full text-lg">
            {photos.length ? t('learn.makeFromPhotos', { count: photos.length }) : t('learn.make')}
          </Button>
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
