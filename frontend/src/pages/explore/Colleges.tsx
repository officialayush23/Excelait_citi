import { Building2, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { COLLEGE_KINDS, CollegeCard, ListSkeleton, Note, useColleges } from '@/components/explore/shared'
import { EmptyState } from '@/components/page/EmptyState'
import { PageHeader } from '@/components/page/PageHeader'
import { Input } from '@/components/ui/input'
import { useFacts } from '@/data/facts'

const selectCls = 'h-12 w-full rounded-xl border bg-card px-3 text-base'

export function Colleges() {
  const { t } = useTranslation()
  const facts = useFacts((s) => s.facts)
  const [params, setParams] = useSearchParams()
  const factState = typeof facts.state === 'string' && facts.state !== 'Other' ? facts.state : ''
  // Prefill from the student's facts only until they touch the filter.
  const state = params.has('state') ? (params.get('state') ?? '') : factState
  const kind = params.get('kind') ?? ''
  const district = params.get('district') ?? ''
  const [text, setText] = useState(params.get('q') ?? '')
  const [q, setQ] = useState(text)
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350)
    return () => clearTimeout(id)
  }, [text])

  const set = (k: string, v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      n.set(k, v)
      return n
    }, { replace: true })

  const res = useColleges({ kind, state, district, q, limit: 50 })

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={t('nav.colleges')} subtitle={t('explore.collegesSubtitle')} back />
      <div className="grid gap-3 rounded-3xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative sm:col-span-2 lg:col-span-4">
          <span className="sr-only">{t('explore.searchByName')}</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('explore.searchByName')} className="h-12 rounded-xl pl-10 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('explore.collegeType')}
          <select value={kind} onChange={(e) => set('kind', e.target.value)} className={selectCls}>
            <option value="">{t('explore.anyType')}</option>
            {COLLEGE_KINDS.map((k) => <option key={k} value={k}>{t(`explore.kind.${k}`, { defaultValue: k })}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('explore.state')}
          <Input value={state} onChange={(e) => set('state', e.target.value)} className="h-12 rounded-xl text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('explore.district')}
          <Input value={district} onChange={(e) => set('district', e.target.value)} className="h-12 rounded-xl text-base" />
        </label>
      </div>

      {res.isLoading && <ListSkeleton rows={5} />}
      {res.isError && (
        <div className="rounded-3xl border bg-card">
          <EmptyState icon={<Building2 />} title={t('explore.errorTitle')} body={t('explore.errorBody')} />
        </div>
      )}
      {res.data && res.data.directory_size === 0 && <Note>{t('explore.directoryComing')}</Note>}
      {res.data && res.data.directory_size > 0 && res.data.colleges.length === 0 && (
        <div className="rounded-3xl border bg-card">
          <EmptyState icon={<Building2 />} title={t('explore.noCollegesTitle')} body={t('explore.noCollegesBody')} />
        </div>
      )}
      {res.data && res.data.colleges.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">{t('explore.collegesFound', { count: res.data.colleges.length })}</p>
          <div className="grid gap-2 lg:grid-cols-2">{res.data.colleges.map((c) => <CollegeCard key={c.aishe_code} c={c} />)}</div>
        </>
      )}
      <Note>
        {t('explore.claimNote')}{' '}
        <Link to="/app/organisation" className="font-medium underline underline-offset-4">{t('explore.claimLink')}</Link>
      </Note>
    </div>
  )
}
