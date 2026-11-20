/**
 * The catalogue ships inside the app, so careers and eligibility work with no network
 * from the very first launch. Admin edits on the server reach phones through /catalogue.
 */
import careersDoc from '@shared/catalogue/careers.json'
import examsDoc from '@shared/catalogue/exams.json'
import fieldsDoc from '@shared/rules/fields.json'
import schemesDoc from '@shared/rules/schemes.json'

import type { Career } from '@/engine/matching'
import type { RuleNode } from '@/engine/rules'

export type Scheme = {
  slug: string
  name: string
  kind: string
  level: string
  state: string | null
  ministry: string
  benefit_amount: number | null
  benefit_text: string
  official_url: string
  apply_url?: string
  documents: string[]
  sources: string[]
  verify: string[]
  is_active?: boolean
  rule: RuleNode
}

export type Exam = { slug: string; name: string; conducting_body: string; eligibility: string; typical_months: number[]; official_url: string }
export type Field = { type: 'number' | 'enum' | 'boolean'; ask: number; options?: (string | number)[]; unit?: string; note?: string }

export const careers = careersDoc.careers as Career[]
export const schemes = (schemesDoc.schemes as Scheme[]).filter((s) => s.is_active !== false)
export const allSchemes = schemesDoc.schemes as Scheme[]
export const documentTypes = schemesDoc.document_types as Record<string, string>
export const exams = examsDoc.exams as Exam[]
export const fields = fieldsDoc.fields as unknown as Record<string, Field>
export const interestTags = careersDoc.interest_tags
export const subjectTags = careersDoc.subject_tags
export const checkedOn = schemesDoc.checked_on

export const careerBySlug = Object.fromEntries(careers.map((c) => [c.slug, c]))
export const schemeBySlug = Object.fromEntries(allSchemes.map((s) => [s.slug, s]))
export const examBySlug = Object.fromEntries(exams.map((e) => [e.slug, e]))

export function careerName(c: Career, lang: string) {
  return c.name_i18n[lang] ?? c.name
}
