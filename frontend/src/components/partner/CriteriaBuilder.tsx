import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { fields } from '@/data/catalogue'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { lakh } from '@/lib/format'

import { describeCriteria } from './criteria'
import type { Criteria } from './partnerApi'
import { ChipToggle, Field } from './shared'

const ANY = '__any'
const optList = (name: string) => (fields[name]?.options ?? []).map(String)

function NumSelect({ value, options, onChange, format, label }: { value: number | null | undefined; options: number[]; onChange: (v: number | null) => void; format?: (n: number) => string; label: string }) {
  const { t } = useTranslation()
  return (
    <Select value={value == null ? ANY : String(value)} onValueChange={(v) => onChange(v === ANY ? null : Number(v))}>
      <SelectTrigger className="h-10 w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{t('partner.crit.any')}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={String(o)}>
            {format ? format(o) : o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const numOrNull = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s))

export function CriteriaBuilder({ value, onChange }: { value: Criteria; onChange: (c: Criteria) => void }) {
  const { t } = useTranslation()
  const set = (patch: Partial<Criteria>) => onChange({ ...value, ...patch })
  const classes = optList('class_level').map(Number)
  const incomes = optList('family_income_annual').map(Number)
  const courseOpts = optList('course').filter((c) => c !== 'none').map((c) => ({ value: c, label: t(`partner.course.${c}`, { defaultValue: c }) }))
  const stateOpts = optList('state').filter((s) => s !== 'Other').map((s) => ({ value: s, label: s }))
  const catOpts = optList('social_category').map((s) => ({ value: s, label: s }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-2xl bg-highlight p-4 text-highlight-foreground" aria-live="polite">
        <Users className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide opacity-70">{t('partner.crit.preview')}</p>
          <p className="font-medium">{describeCriteria(value, t)}</p>
        </div>
      </div>

      <Field label={t('partner.crit.gender')}>
        <ChipToggle
          options={[{ value: 'female', label: t('partner.crit.girls') }, { value: 'male', label: t('partner.crit.boys') }]}
          value={value.gender ? [value.gender] : []}
          onChange={(v) => set({ gender: (v[v.length - 1] as Criteria['gender']) ?? null })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('partner.crit.classMinLabel')}>
          <NumSelect label={t('partner.crit.classMinLabel')} value={value.class_min} options={classes} onChange={(v) => set({ class_min: v })} />
        </Field>
        <Field label={t('partner.crit.classMaxLabel')}>
          <NumSelect label={t('partner.crit.classMaxLabel')} value={value.class_max} options={classes} onChange={(v) => set({ class_max: v })} />
        </Field>
      </div>

      <Field label={t('partner.crit.coursesLabel')} hint={t('partner.crit.coursesHint')}>
        <ChipToggle options={courseOpts} value={value.courses ?? []} onChange={(v) => set({ courses: v })} />
      </Field>
      <Field label={t('partner.crit.statesLabel')}>
        <ChipToggle options={stateOpts} value={value.states ?? []} onChange={(v) => set({ states: v })} />
      </Field>
      <Field label={t('partner.crit.categoriesLabel')}>
        <ChipToggle options={catOpts} value={value.categories ?? []} onChange={(v) => set({ categories: v })} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('partner.crit.incomeLabel')}>
          <NumSelect label={t('partner.crit.incomeLabel')} value={value.income_max} options={incomes} format={lakh} onChange={(v) => set({ income_max: v })} />
        </Field>
        <Field label={t('partner.crit.marksLabel')}>
          <Input type="number" inputMode="numeric" min={0} max={100} value={value.marks_min ?? ''} onChange={(e) => set({ marks_min: numOrNull(e.target.value) })} className="h-10" />
        </Field>
        <Field label={t('partner.crit.ageMinLabel')}>
          <Input type="number" inputMode="numeric" min={0} max={120} value={value.age_min ?? ''} onChange={(e) => set({ age_min: numOrNull(e.target.value) })} className="h-10" />
        </Field>
        <Field label={t('partner.crit.ageMaxLabel')}>
          <Input type="number" inputMode="numeric" min={0} max={120} value={value.age_max ?? ''} onChange={(e) => set({ age_max: numOrNull(e.target.value) })} className="h-10" />
        </Field>
      </div>
    </div>
  )
}
