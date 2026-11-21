import { AlertCircle, BookOpenText, ChevronRight, Globe2, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { LANGUAGES } from '@/i18n'

import type { LessonSummary } from './api'

const langLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code

export function LessonList({ items }: { items: LessonSummary[] }) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col gap-2">
      {items.map((l) => (
        <li key={l.id}>
          <Link to={`/app/lessons/${l.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-3 hover:bg-muted/50">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface">
              {l.status === 'processing' ? <Loader2 className="size-5 animate-spin" /> : l.status === 'failed' ? <AlertCircle className="size-5 text-destructive" /> : <BookOpenText className="size-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{l.title}</span>
              <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span>{langLabel(l.language)}</span>
                {l.status === 'processing' && <span>· {t(`learn.stage.${l.stage === 'recording' ? 'recording' : 'writing'}`)}</span>}
                {l.status === 'failed' && <span>· {t('learn.failedShort')}</span>}
                {l.is_public && (
                  <span className="inline-flex items-center gap-1">· <Globe2 className="size-3.5" />{t('learn.shared')}</span>
                )}
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
