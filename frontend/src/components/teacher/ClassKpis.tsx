import { CircleAlert, ClipboardList, IndianRupee, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { KpiCard, KpiRow } from '@/components/page/Kpi'
import { formatInr } from '@/lib/format'

import { Bar } from './shared'
import type { Dashboard } from './teacherApi'

export function ClassKpis({ totals }: { totals: Dashboard['totals'] }) {
  const { t } = useTranslation()
  const pct = totals.eligible_inr > 0 ? Math.round((100 * totals.claimed_inr) / totals.eligible_inr) : 0
  return (
    <KpiRow>
      <KpiCard
        label={t('teacher.kpi.students')}
        value={totals.students}
        icon={<Users />}
        hint={t('teacher.kpi.profilesHint', { pct: totals.profiles_complete_pct, careers: totals.careers_chosen_pct })}
      />
      <KpiCard
        label={t('teacher.kpi.rupees')}
        value={totals.eligible_inr}
        prefix="₹"
        tone="highlight"
        icon={<IndianRupee />}
        className="col-span-2 xl:col-span-1"
        hint={t('teacher.kpi.claimed', { amount: formatInr(totals.claimed_inr), pct })}
        footer={<Bar value={pct} />}
      />
      <KpiCard label={t('teacher.kpi.plans')} value={totals.plans_made} icon={<ClipboardList />} hint={t('teacher.kpi.apps', { count: totals.applications })} />
      <KpiCard
        label={t('teacher.kpi.atRisk')}
        value={totals.at_risk}
        icon={<CircleAlert />}
        tone={totals.at_risk > 0 ? 'rose' : 'mint'}
        hint={totals.at_risk > 0 ? t('teacher.kpi.atRiskHint') : t('teacher.kpi.allGood')}
      />
    </KpiRow>
  )
}
