import { useQuery } from '@tanstack/react-query'
import { Award, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CredentialCard } from '@/components/passport/CredentialCard'
import { SkillRow } from '@/components/passport/SkillRow'
import type { Credential, Skill } from '@/components/passport/shared'
import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

export function Passport() {
  const { t } = useTranslation()
  const me = useQuery({ queryKey: ['passport-me'], queryFn: () => api<{ credentials: Credential[] }>('/api/v1/passport/me') })
  const skills = useQuery({ queryKey: ['passport-skills'], queryFn: () => api<{ skills: Skill[] }>('/api/v1/passport/skills') })

  const mine = skills.data?.skills.filter((s) => s.for_my_careers) ?? []
  const others = skills.data?.skills.filter((s) => !s.for_my_careers) ?? []
  const [showAll, setShowAll] = useState(false)
  const SHOWN = 4

  return (
    <>
      <PageHeader title={t('passport.title')} subtitle={t('passport.subtitle')} back />

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">{t('passport.walletTitle')}</h2>
        {me.isPending ? (
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        ) : me.isError ? (
          <Retry onRetry={() => void me.refetch()} />
        ) : me.data.credentials.length === 0 ? (
          <div className="rounded-3xl border bg-card">
            <EmptyState icon={<Award />} title={t('passport.walletEmpty')} body={t('passport.walletEmptyBody')} />
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {me.data.credentials.map((c) => (
              <li key={c.id}>
                <CredentialCard credential={c} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">{t('passport.toProve')}</h2>
        {skills.isPending ? (
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        ) : skills.isError ? (
          <Retry onRetry={() => void skills.refetch()} />
        ) : skills.data.skills.length === 0 ? (
          <p className="text-muted-foreground">{t('passport.noSkills')}</p>
        ) : (
          <div className="flex flex-col gap-6">
            {mine.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('passport.forMyCareers')}</h3>
                <ul className="flex flex-col gap-3">{mine.map((s) => <SkillRow key={s.id} skill={s} />)}</ul>
              </div>
            )}
            {others.length > 0 && (
              <div>
                {mine.length > 0 && <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('passport.moreSkills')}</h3>}
                <ul className="flex flex-col gap-3">{(showAll ? others : others.slice(0, SHOWN)).map((s) => <SkillRow key={s.id} skill={s} />)}</ul>
                {!showAll && others.length > SHOWN && (
                  <Button variant="outline" className="mt-3 w-full rounded-full" onClick={() => setShowAll(true)}>
                    {t('passport.showAll', { count: others.length })}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  )
}

function Retry({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-3xl border bg-card p-6 text-center">
      <p className="mb-3 text-muted-foreground">{t('community.loadFailTitle')}</p>
      <Button className="h-11 rounded-full px-6" onClick={onRetry}>{t('community.retry')}</Button>
    </div>
  )
}
