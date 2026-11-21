import { GraduationCap } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { useJoinClass, useMyClasses } from './teacherApi'

/** Student-side card: type the short code your teacher reads out to join their class. */
export function JoinClassCard() {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const mine = useMyClasses()
  const join = useJoinClass()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    join.mutate(code, {
      onSuccess: ({ class: c }) => {
        setCode('')
        toast.success(t('teacher.join.joined', { name: c.name }))
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : t('teacher.join.error')),
    })
  }

  const classes = mine.data?.classes ?? []
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted"><GraduationCap className="size-5" /></span>
        <div>
          <h2 className="font-semibold">{t('teacher.join.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('teacher.join.body')}</p>
        </div>
      </div>
      {classes.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {classes.map((c) => (
            <li key={c.id} className="rounded-full bg-muted px-3 py-1 text-sm">
              {c.name}
              {c.teacher_name ? ` · ${c.teacher_name}` : ''}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={10}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label={t('teacher.join.codeLabel')}
          placeholder={t('teacher.join.placeholder')}
          className="h-11 rounded-full text-center font-mono text-lg tracking-[0.3em] uppercase"
        />
        <Button type="submit" className="h-11 rounded-full px-6" disabled={code.replace(/\W/g, '').length < 6 || join.isPending}>
          {join.isPending ? t('teacher.join.joining') : t('teacher.join.action')}
        </Button>
      </form>
    </section>
  )
}
