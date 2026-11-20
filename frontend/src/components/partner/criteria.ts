import type { TFunction } from 'i18next'

import { lakh } from '@/lib/format'

import type { Criteria } from './partnerApi'

/** Turns the criteria into a short human sentence, e.g. "Girls, Class 11 or above, in Maharashtra". */
export function describeCriteria(c: Criteria, t: TFunction): string {
  const parts: string[] = []
  if (c.gender) parts.push(t(`partner.crit.gender_${c.gender}`))
  if (c.class_min != null && c.class_max != null) parts.push(t('partner.crit.classBetween', { min: c.class_min, max: c.class_max }))
  else if (c.class_min != null) parts.push(t('partner.crit.classMin', { n: c.class_min }))
  else if (c.class_max != null) parts.push(t('partner.crit.classMax', { n: c.class_max }))
  if (c.courses?.length) parts.push(t('partner.crit.courses', { list: c.courses.map((x) => t(`partner.course.${x}`, { defaultValue: x })).join(', ') }))
  if (c.states?.length) parts.push(t('partner.crit.states', { list: c.states.join(', ') }))
  if (c.categories?.length) parts.push(t('partner.crit.categories', { list: c.categories.join(', ') }))
  if (c.income_max != null) parts.push(t('partner.crit.income', { amount: lakh(c.income_max) }))
  if (c.marks_min != null) parts.push(t('partner.crit.marks', { n: c.marks_min }))
  if (c.age_min != null && c.age_max != null) parts.push(t('partner.crit.ageBetween', { min: c.age_min, max: c.age_max }))
  else if (c.age_min != null) parts.push(t('partner.crit.ageMin', { n: c.age_min }))
  else if (c.age_max != null) parts.push(t('partner.crit.ageMax', { n: c.age_max }))
  return parts.length ? parts.join(', ') : t('partner.crit.everyone')
}

export function hasCriteria(c: Criteria): boolean {
  return Object.values(c).some((v) => (Array.isArray(v) ? v.length > 0 : v != null))
}
