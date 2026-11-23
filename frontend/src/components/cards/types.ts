/**
 * Shapes of the cards Saathi returns (backend/app/services/assistant.py `run_tool`).
 * Cards are built by fixed tools, never by the model, so every number here is real.
 */

export type I18nName = { name: string; name_i18n?: Record<string, string> | null }
export type Ref = { slug: string; name: string; name_i18n?: Record<string, string> | null }
export type Result = 'eligible' | 'needs_info' | 'not_eligible'

export type MatchReason = { code: string; points: number; detail: (string | number)[] }

/** Where a career's pay or path figure was seen (shared/catalogue/careers.json `sources`). */
export type SourceRef = { title?: string | null; url: string; site?: string | null }
/** 'now', or 'after_18' etc. when the student is too young for this work. */
export type AgeStatus = 'now' | `after_${number}`

export type CareerItem = I18nName & {
  slug: string
  score: number
  age_status?: AgeStatus
  sources?: SourceRef[]
  checked_on?: string | null
  reasons: MatchReason[]
  gaps: { code: string; detail: (string | number)[] }[]
  category: string
  pay_min: number | null
  pay_max: number | null
  earning_speed: 'fast' | 'medium' | 'slow'
}

export type ExamRef = { slug: string; name: string; next: string | null; official_url: string }

export type SchemeStatus = {
  slug: string
  name: string
  benefit_amount: number | null
  benefit_text: string
  official_url: string
  result: Result
  missing: string[]
  failed: string[]
  documents: string[] | { slug: string; name: string }[]
}

export type Resource = { slug: string; title: string; provider?: string | null; url: string; kind?: string | null; languages?: string[] | null }

export type ProgramData = I18nName & {
  slug: string
  level?: string | null
  duration_months?: number | null
  entry?: string | null
  where?: string | null
  college_kind?: string | null
  official_url?: string | null
  verify?: string[] | null
  exams: ExamRef[]
  schemes: SchemeStatus[]
  careers: Ref[]
  resources: Resource[]
}

export type CareerData = I18nName & {
  slug: string
  category: string
  pay_min: number | null
  pay_max: number | null
  min_education?: string | null
  earning_speed?: string | null
  cost_band?: string | null
  nsqf_level?: number | null
  needs_city?: boolean | null
  path: string[]
  programs: ProgramData[]
  exams: ExamRef[]
  schemes: SchemeStatus[]
  resources: Resource[]
  related: Ref[]
  saved?: boolean
  age_status?: AgeStatus
  sources?: SourceRef[]
  checked_on?: string | null
}

export type ExamData = {
  slug: string
  name: string
  conducting_body?: string | null
  eligibility?: string | null
  typical_months?: number[]
  official_url?: string | null
  next: string | null
  programs: { slug: string; name: string }[]
  careers: Ref[]
  resources: Resource[]
}

export type SchemeData = Omit<SchemeStatus, 'documents'> & {
  kind?: string | null
  state?: string | null
  ministry?: string | null
  apply_url?: string | null
  verify?: string[] | null
  documents: { slug: string; name: string }[]
  programs: { slug: string; name: string }[]
  careers: Ref[]
}

export type College = {
  aishe_code: string
  name: string
  state?: string | null
  district?: string | null
  location?: string | null
  college_type?: string | null
  management?: string | null
  university?: string | null
  kind?: string | null
  org_id?: string | null
}

export type Offer = {
  id: string
  kind: string
  title: string
  description?: string | null
  location?: string | null
  is_remote?: boolean | null
  stipend_monthly?: number | null
  fee_inr?: number | null
  deadline?: string | null
  apply_url?: string | null
  org_name?: string | null
  verified?: boolean
  match: Result
  missing?: string[]
  criteria_labels?: string[]
}

export type Post = {
  id: string
  kind: string
  title: string
  body?: string | null
  answer_count?: number | null
  score?: number | null
  deadline?: string | null
  created_at?: string
  author_name?: string | null
  author_senior?: boolean | null
  author_path?: string | null
}

export type Senior = { id: string; full_name?: string | null; senior_path?: string | null; bio?: string | null }

export type PlanSummary = { id: string; career_slug: string; title: string; status: string; total: number; done: number }

export type PlanStep = {
  id?: string
  position: number
  kind: 'exam' | 'program' | 'scheme' | 'document' | 'course' | 'milestone' | string
  ref_id?: string | null
  title: string
  detail?: string | null
  due_date?: string | null
  done_at?: string | null
}

export type PlanData = { id: string; career_slug: string; title: string; status: string; created_at?: string; steps: PlanStep[] }

export type WebResult = { title: string; url: string; snippet: string }

export type LawRule = { id: string; kind: 'allowed' | 'not_allowed' | 'limit'; text: Record<string, string>; policy: boolean; sources: string[] }
export type LawSource = { id: string; title: string; url: string; publisher?: string | null; policy?: boolean }
export type LawData = {
  age: number | null
  band: 'child' | 'adolescent' | 'adult' | 'unknown'
  rules: LawRule[]
  sources: LawSource[]
  checked_on: string
  can_apprentice?: boolean
  can_skill_training?: boolean
  can_take_jobs?: boolean
}

export type RightItem = {
  id: string
  topic: string
  text: Record<string, string>
  text_lang?: string
  numbers?: Record<string, string | number>
  verified: boolean
  policy: boolean
  sources: string[]
}
export type RightsData = {
  age: number | null
  band: 'child' | 'adolescent' | 'adult' | 'unknown'
  minor: boolean
  state: string | null
  lang: string
  rights: RightItem[]
  minimum_wage: { per_day: number; per_month: number; effective_from: string; valid_until?: string | null; source: string; verified: boolean; zone?: string; state: string; skill: string } | null
  minimum_wage_note: 'state_sets_per_employment' | 'not_available' | null
  helplines: { id: string; name: string; number?: string | null; alt_number?: string | null; hours?: string; url?: string; grievance_url?: string }[]
  law_status: { in_force_from: string; summary: string }
  sources: LawSource[]
  checked_on: string
}

/** A scholarship found on Buddy4Study or an official portal (backend/app/services/scholarships.py), matched by fixed code. */
export type ScholarshipMatch = 'likely_eligible' | 'check' | 'not_eligible'
export type FoundScholarship = {
  id?: string | null
  name: string
  provider?: string | null
  provider_type?: 'government' | 'private' | 'csr' | 'ngo' | null
  amount_text?: string | null
  amount?: number | null
  deadline?: string | null
  days_left?: number | null
  documents?: string[]
  how_to_apply?: string | null
  apply_url?: string | null
  source_url: string
  source_site?: string | null
  site_name?: string | null
  last_seen?: string | null
  partial?: boolean
  eligibility_text?: string | null
  match: ScholarshipMatch
  reasons: string[]
  unknown: string[]
}
export type ScholarshipsData = {
  found: FoundScholarship[]
  counts: { verified: number; verified_eligible: number; likely_eligible: number; check: number; not_eligible: number }
  ask: string[]
  checked_on: string
  sites: string[]
  from_store?: boolean
}

export type JobPost = {
  title: string
  employer?: string | null
  place?: string | null
  pay?: string | null
  posted?: string | null
  site: string
  url: string
  /** Set by the backend when the whole monthly pay range is below the state minimum wage. */
  below_minimum_wage?: boolean
  minimum_wage_ref?: { per_month: number; effective_from: string; valid_until?: string | null; source: string; verified: boolean; state: string }
}
export type JobsData = {
  role: string
  place: string
  searched_place: string
  items: JobPost[]
  pages: { title: string; site: string; url: string; snippet?: string }[]
  sites: string[]
  site_names: Record<string, string>
  apprenticeship_only: boolean
  checked_on: string
  nearby: string[]
  minor?: boolean
}

export type Card =
  | { type: 'careers'; what_if?: { can_relocate?: boolean; needs_income_soon?: boolean }; items: CareerItem[]; minor?: boolean }
  | ({ type: 'career' } & CareerData)
  | ({ type: 'program' } & ProgramData)
  | ({ type: 'exam' } & ExamData)
  | { type: 'schemes'; rupees: number; items: SchemeStatus[] }
  | ({ type: 'scheme' } & SchemeData)
  | { type: 'colleges'; query?: Record<string, string | null | undefined>; items: College[]; directory_loaded: boolean }
  | { type: 'resources'; items: Resource[] }
  | { type: 'offers'; items: Offer[] }
  | { type: 'posts'; items: Post[] }
  | { type: 'seniors'; items: Senior[] }
  | { type: 'my_plan'; saved: string[]; plans: PlanSummary[] }
  | ({ type: 'plan' } & PlanData)
  | { type: 'web'; query: string; results: WebResult[]; cached?: boolean }
  | { type: 'question'; field: string | null; question?: string | null; lang?: string; answered?: string; why?: string | null }
  | ({ type: 'law' } & LawData)
  | ({ type: 'jobs' } & JobsData)
  | ({ type: 'scholarships' } & ScholarshipsData)
  | ({ type: 'rights' } & RightsData)

export type CardType = Card['type']
export type CardOf<T extends CardType> = Extract<Card, { type: T }>
