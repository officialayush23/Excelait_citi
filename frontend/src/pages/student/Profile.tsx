import { UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { BeyondMarks } from '@/components/profile/BeyondMarks'
import { ConnectedSections } from '@/components/profile/ConnectedSections'
import { FactsSection } from '@/components/profile/FactsSection'
import { InterestSection } from '@/components/profile/InterestSection'
import { KnowledgeMap } from '@/components/profile/KnowledgeMap'
import { PrivacySection } from '@/components/profile/PrivacySection'
import { ProfileHeader } from '@/components/profile/ProfileHeader'
import { useProfile } from '@/components/profile/useProfile'
import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function Profile() {
  const { t } = useTranslation()
  const { result, isLoading, isError, refetch, saveFact, removeFact } = useProfile()

  async function deleteAll(keys: string[]) {
    const done = await Promise.allSettled(keys.map((k) => removeFact(k, { refresh: false })))
    await refetch()
    return { failed: done.filter((d) => d.status === 'rejected').length }
  }

  return (
    <>
      <PageHeader title={t('profile.title')} subtitle={t('profile.subtitle')} back />
      {isLoading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-44 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
        </div>
      )}
      {isError && !result && (
        <div className="rounded-3xl border bg-card">
          <EmptyState
            icon={<UserRound />}
            title={t('profile.errorTitle')}
            body={t('profile.errorBody')}
            action={<Button size="lg" className="h-12 rounded-full px-6" onClick={() => void refetch()}>{t('profile.retry')}</Button>}
          />
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-4 sm:gap-6">
          {result.mock && <p className="rounded-2xl bg-tile-peach px-4 py-2 text-sm text-tile-foreground">Dev preview: sample data (profile endpoint not found).</p>}
          <ProfileHeader data={result.data} />
          <BeyondMarks facts={Object.fromEntries(result.data.facts.map((f) => [f.key, f.value]))} showPrivate={false} />
          <FactsSection facts={result.data.facts} onSave={saveFact} onDelete={(k) => removeFact(k)} />
          <InterestSection interests={result.data.interests} />
          <KnowledgeMap graph={result.data.graph} />
          <ConnectedSections data={result.data} />
          <PrivacySection data={result.data} onDeleteAll={deleteAll} />
        </div>
      )}
    </>
  )
}
