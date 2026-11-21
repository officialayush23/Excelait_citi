import { Check, Copy, Pencil, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Field } from '@/components/partner/shared'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { useCreateClass, useRenameClass, type ClassRow } from './teacherApi'

/** The class code, big enough to read off a board, with copy and read-aloud. */
export function JoinCodeCard({ code, className }: { code: string; className?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error(t('teacher.copyFailed'))
    }
  }
  const spoken = t('teacher.codeSpoken', { code: code.split('').join(' ') })
  return (
    <div className={`flex flex-col items-center gap-3 rounded-2xl bg-highlight p-5 text-highlight-foreground ${className ?? ''}`}>
      <p className="text-sm font-medium opacity-80">{t('teacher.shareCode')}</p>
      <p className="font-mono text-5xl font-bold tracking-[0.25em] sm:text-6xl" aria-label={code.split('').join(' ')}>
        {code}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" className="rounded-full" onClick={() => void copy()}>
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? t('teacher.copied') : t('teacher.copyCode')}
        </Button>
        <span className="rounded-full bg-background/20 text-current [&_button]:text-current">
          <SpeakButton text={spoken} />
        </span>
      </div>
    </div>
  )
}

export function CreateClassDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: ClassRow) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [school, setSchool] = useState('')
  const create = useCreateClass()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate(
      { name, school_name: school || undefined },
      {
        onSuccess: ({ class: c }) => {
          setName('')
          setSchool('')
          onOpenChange(false)
          onCreated(c)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : t('teacher.error')),
      },
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('teacher.createClass')}</DialogTitle>
            <DialogDescription>{t('teacher.createHint')}</DialogDescription>
          </DialogHeader>
          <Field label={t('teacher.className')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('teacher.classNamePlaceholder')} maxLength={80} autoFocus />
          </Field>
          <Field label={t('teacher.schoolName')}>
            <Input value={school} onChange={(e) => setSchool(e.target.value)} maxLength={120} />
          </Field>
          <DialogFooter>
            <Button type="submit" className="rounded-full" disabled={name.trim().length < 2 || create.isPending}>
              <Plus data-icon="inline-start" />
              {create.isPending ? t('teacher.saving') : t('teacher.createClass')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RenameClassButton({ cls }: { cls: ClassRow }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(cls.name)
  const rename = useRenameClass()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    rename.mutate(
      { id: cls.id, name },
      { onSuccess: () => setOpen(false), onError: (err) => toast.error(err instanceof Error ? err.message : t('teacher.error')) },
    )
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="rounded-full"
        aria-label={t('teacher.rename')}
        onClick={() => {
          setName(cls.name)
          setOpen(true)
        }}
      >
        <Pencil />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('teacher.rename')}</DialogTitle>
            </DialogHeader>
            <Field label={t('teacher.className')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
            </Field>
            <DialogFooter>
              <Button type="submit" className="rounded-full" disabled={name.trim().length < 2 || rename.isPending}>
                {t('teacher.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
