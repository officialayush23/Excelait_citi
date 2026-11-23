import { BookOpenCheck, Check, Lock, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { FactQuestion, useFactOptions } from '@/components/student/FactQuestion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { fields } from '@/data/catalogue'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

import { ConfirmDialog } from './ConfirmDialog'
import { countSensitive, editableText, editedIsValid, groupFacts, parseEdited, pick, shortDate, shortNote } from './helpers'
import { Section } from './Parts'
import type { ProfileFact } from './types'

/** Facts the question widget can edit even though the rules file does not list them. */
const QUESTION_KEYS = new Set(['district', 'hours_per_week', 'needs_income_soon', 'can_relocate'])

function FactValue({ fact }: { fact: ProfileFact }) {
  const { t } = useTranslation()
  const options = useFactOptions(fact.key)
  const v = fact.value
  if (Array.isArray(v)) return <>{v.join(', ')}</>
  const hit = options?.find((o) => o.value === String(v))
  if (hit) return <>{hit.label}</>
  if (typeof v === 'boolean') return <>{v ? t('common.yes') : t('common.no')}</>
  if (typeof v === 'number' && fields[fact.key]?.unit === 'percent') return <>{v}%</>
  return <>{String(v ?? '')}</>
}

function SourceChip({ fact, open, onToggle }: { fact: ProfileFact; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const date = shortDate(fact.at, lang)
  const label = [t(`profile.source.${fact.source}`, { defaultValue: fact.source }), date].filter(Boolean).join(' · ')
  const cls = 'inline-flex min-h-8 items-center rounded-full bg-secondary px-3 text-xs font-medium text-secondary-foreground'
  if (!fact.note) return <span className={cls}>{label}</span>
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className={cn(cls, 'underline decoration-dotted underline-offset-4 hover:bg-accent')}>
      {label}
    </button>
  )
}

function FactRow({ fact, onSave, onDelete }: { fact: ProfileFact; onSave: (key: string, value: unknown) => Promise<void>; onDelete: (key: string) => Promise<void> }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const [editing, setEditing] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [text, setText] = useState('')
  const label = pick(fact.label, lang) || fact.key
  const asQuestion = !Array.isArray(fact.value) && (fact.key in fields || QUESTION_KEYS.has(fact.key))

  async function save(value: unknown) {
    try {
      await onSave(fact.key, value)
      setEditing(false)
      toast.success(t('profile.saved'))
    } catch {
      toast.error(t('profile.saveFailed'))
    }
  }

  return (
    <li className="rounded-2xl border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          {!editing && (
            <p className="mt-0.5 break-words text-lg font-semibold">
              <FactValue fact={fact} />
            </p>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            <Button
              type="button" variant="ghost" size="icon" className="size-11 rounded-full"
              aria-label={t('profile.editFact', { label })}
              onClick={() => {
                setText(editableText(fact.value))
                setEditing(true)
              }}
            >
              <Pencil />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="size-11 rounded-full text-destructive" aria-label={t('profile.deleteFact', { label })} onClick={() => setConfirm(true)}>
              <Trash2 />
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-3 flex flex-col gap-3">
          {asQuestion ? (
            <FactQuestion field={fact.key} compact onAnswer={(v) => void save(v)} />
          ) : (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault()
                if (editedIsValid(fact.value, text)) void save(parseEdited(fact.value, text))
              }}
            >
              <Input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                type={typeof fact.value === 'number' ? 'number' : 'text'}
                inputMode={typeof fact.value === 'number' ? 'decimal' : undefined}
                aria-label={label}
                className="h-12 rounded-full px-5 text-base"
              />
              <Button type="submit" size="lg" className="h-12 rounded-full px-6" disabled={!editedIsValid(fact.value, text)}>
                <Check data-icon="inline-start" />
                {t('common.save')}
              </Button>
            </form>
          )}
          {Array.isArray(fact.value) && <p className="text-xs text-muted-foreground">{t('profile.listHint')}</p>}
          <Button type="button" variant="ghost" className="h-11 w-fit rounded-full" onClick={() => setEditing(false)}>
            <X data-icon="inline-start" />
            {t('profile.cancel')}
          </Button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SourceChip fact={fact} open={noteOpen} onToggle={() => setNoteOpen((o) => !o)} />
        {fact.sensitive && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" />
            {t('profile.privateLabel')}
          </span>
        )}
      </div>
      {noteOpen && fact.note && <p className="mt-2 rounded-xl bg-card p-3 text-sm italic text-muted-foreground">“{shortNote(fact.note)}”</p>}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('profile.deleteTitle', { label })}
        body={t('profile.deleteBody')}
        confirmLabel={t('profile.delete')}
        onConfirm={async () => {
          try {
            await onDelete(fact.key)
            toast.success(t('profile.deleted'))
          } catch {
            toast.error(t('profile.deleteFailed'))
            throw new Error('delete failed')
          }
        }}
      />
    </li>
  )
}

/** Everything Saathi has learned, grouped, with where it came from. Edit or delete any of it. */
export function FactsSection({ facts, onSave, onDelete }: { facts: ProfileFact[]; onSave: (key: string, value: unknown) => Promise<void>; onDelete: (key: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [showPrivate, setShowPrivate] = useState(false)
  const groups = groupFacts(facts, showPrivate)
  const priv = countSensitive(facts)
  const intro = t('profile.factsHint')

  return (
    <Section id="facts" icon={<BookOpenCheck />} title={t('profile.factsTitle')} hint={intro}>
      {priv > 0 && (
        <label className="mb-4 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-2">
          <span className="flex items-center gap-2 font-medium">
            <Lock className="size-4" />
            {t('profile.showPrivate', { count: priv })}
          </span>
          <Switch checked={showPrivate} onCheckedChange={setShowPrivate} aria-label={t('profile.showPrivate', { count: priv })} />
        </label>
      )}
      {groups.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-muted-foreground">{t('profile.factsEmpty')}</p>
          <Button asChild size="lg" className="h-12 rounded-full px-6">
            <Link to={to.saathi()}>{t('profile.talkToSaathi')}</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ group, facts: list }) => (
            <div key={group}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t(`profile.group.${group}`)}</h3>
              <ul className="grid gap-3 lg:grid-cols-2">
                {list.map((f) => (
                  <FactRow key={f.key} fact={f} onSave={onSave} onDelete={onDelete} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
