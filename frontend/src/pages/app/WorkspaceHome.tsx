import { ArrowRight, Hourglass } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { EmptyState } from '@/components/page/EmptyState'
import { FilterBar } from '@/components/page/FilterBar'
import { KpiCard, KpiRow, type Tone } from '@/components/page/Kpi'
import { PageHeader } from '@/components/page/PageHeader'
import { ListRow, SplitView } from '@/components/page/SplitView'
import { AdminHome, PartnerHome } from '@/components/partner/OpsHome'
import { pathFor } from '@/components/shell/Nav'
import { Button } from '@/components/ui/button'
import { NAV, type Role } from '@/config/roles'

/** KPI labels per role. Values stay empty (—) until the feature behind each one ships. */
const KPIS: Record<Exclude<Role, 'student'>, { key: string; prefix?: string; tone: Tone }[]> = {
  facilitator: [
    { key: 'students', tone: 'plain' },
    { key: 'rupeesUnlocked', prefix: '₹', tone: 'highlight' },
    { key: 'toVerify', tone: 'plain' },
    { key: 'atRisk', tone: 'plain' },
  ],
  partner: [
    { key: 'postings', tone: 'plain' },
    { key: 'applicants', tone: 'highlight' },
    { key: 'shortlisted', tone: 'plain' },
  ],
  mentor: [
    { key: 'questions', tone: 'highlight' },
    { key: 'answered', tone: 'plain' },
    { key: 'sessions', tone: 'plain' },
  ],
  parent: [
    { key: 'updates', tone: 'plain' },
    { key: 'consents', tone: 'plain' },
  ],
  funder: [
    { key: 'reached', tone: 'plain' },
    { key: 'rupeesUnlocked', prefix: '₹', tone: 'highlight' },
    { key: 'claimed', prefix: '₹', tone: 'plain' },
    { key: 'placed', tone: 'plain' },
  ],
  admin: [
    { key: 'pendingPartners', tone: 'highlight' },
    { key: 'schemes', tone: 'plain' },
    { key: 'careers', tone: 'plain' },
    { key: 'reports', tone: 'plain' },
  ],
}

/**
 * The denser dashboard for teachers, partners, mentors, parents, funders and admins:
 * KPI row, filter bar, and the list + detail split view from the dark reference.
 */
export function WorkspaceHome() {
  const { t } = useTranslation()
  const { role } = useAuth()
  if (role === 'partner') return <PartnerHome roleName={t('roles.partner.name')} />
  if (role === 'admin') return <AdminHome roleName={t('roles.admin.name')} />
  return <GenericWorkspaceHome />
}

function GenericWorkspaceHome() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const items = NAV[role]
  const [selected, setSelected] = useState(0)
  const [filters, setFilters] = useState<string[]>([])
  const kpis = KPIS[role as Exclude<Role, 'student'>] ?? []
  const item = items[selected]
  const roleName = t(`roles.${role}.name`)

  const shownItems = filters.length ? items.filter((i) => filters.includes(String(i.phase))) : items
  const phases = [...new Set(items.map((i) => i.phase))].sort()

  return (
    <>
      <PageHeader title={roleName} subtitle={t('home.roleLead', { role: roleName })} />

      <KpiRow className={kpis.length === 3 ? 'xl:grid-cols-3' : kpis.length === 2 ? 'xl:grid-cols-2' : undefined}>
        {kpis.map((k) => (
          <KpiCard key={k.key} label={t(`kpi.${k.key}`)} value={null} prefix={k.prefix} tone={k.tone} />
        ))}
      </KpiRow>

      <div className="mt-8">
        <FilterBar
          chips={phases.map((p) => ({ id: String(p), label: t('home.phase', { phase: p }) }))}
          active={filters}
          onToggle={(id) => setFilters((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))}
          onClear={() => setFilters([])}
        />
        <SplitView
          listTitle={<h2 className="font-semibold">{t('home.workspace')}</h2>}
          list={shownItems.map((it) => {
            const i = items.indexOf(it)
            const Icon = it.icon
            return (
              <ListRow
                key={it.key}
                selected={i === selected}
                onSelect={() => setSelected(i)}
                leading={
                  <span className="grid size-10 place-items-center rounded-xl bg-muted text-foreground">
                    <Icon className="size-5" />
                  </span>
                }
                title={t(`nav.${it.key}`)}
                subtitle={t('home.phase', { phase: it.phase })}
              />
            )
          })}
          detailKey={item?.key}
          detail={
            item && (
              <EmptyState
                icon={<Hourglass />}
                title={t(`nav.${item.key}`)}
                body={t('common.comingBody', { section: t(`nav.${item.key}`), phase: item.phase })}
                action={
                  <Button asChild variant="outline" className="rounded-full">
                    <Link to={pathFor(item, selected)}>
                      {t('common.open')}
                      <ArrowRight data-icon="inline-end" />
                    </Link>
                  </Button>
                }
              />
            )
          }
        />
      </div>
    </>
  )
}
