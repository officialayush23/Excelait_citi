import { Hourglass } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Navigate, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { NAV } from '@/config/roles'

/** A section whose features ship in a later phase. Unknown sections go home. */
export function Section() {
  const { t } = useTranslation()
  const { section } = useParams()
  const { role } = useAuth()
  const item = NAV[role].find((i) => i.key === section)
  if (!item) return <Navigate to="/app" replace />

  const name = t(`nav.${item.key}`)
  return (
    <>
      <PageHeader title={name} back />
      <div className="rounded-3xl border bg-card">
        <EmptyState icon={<Hourglass />} title={t('common.comingTitle')} body={t('common.comingBody', { section: name, phase: item.phase })} />
      </div>
    </>
  )
}
