import { useQuery } from '@tanstack/react-query'
import { BadgeCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

import { type Credential, loc } from './shared'

/** Lets a student tick which verified credentials to show to a partner. */
export function CredentialPicker({ value, onChange, disabled }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const q = useQuery({ queryKey: ['passport-me'], queryFn: () => api<{ credentials: Credential[] }>('/api/v1/passport/me') })
  const creds = (q.data?.credentials ?? []).filter((c) => !c.revoked_at)
  if (q.isPending || q.isError) return null
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4">
      <p className="text-sm font-semibold">{t('passport.attach.title')}</p>
      {creds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('passport.attach.none')}{' '}
          <Link to="/app/passport" className="font-medium underline underline-offset-4">{t('passport.attach.openPassport')}</Link>
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('passport.attach.hint')}</p>
          <ul className="flex flex-col gap-2">
            {creds.map((c) => {
              const on = value.includes(c.id)
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => onChange(on ? value.filter((x) => x !== c.id) : [...value, c.id])}
                    className={cn('flex min-h-12 w-full items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left', on && 'border-foreground')}
                  >
                    <span className={cn('grid size-6 shrink-0 place-items-center rounded-md border text-xs font-bold', on && 'bg-highlight text-highlight-foreground')}>{on ? '✓' : ''}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{loc(c.payload.credentialSubject.skill, c.skill_name_i18n, lang)}</span>
                    <BadgeCheck className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
