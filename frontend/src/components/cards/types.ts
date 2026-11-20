/**
 * Shapes of the cards Saathi returns (backend/app/services/assistant.py `run_tool`).
 * Cards are built by fixed tools, never by the model, so every number here is real.
 */

export type I18nName = { name: string; name_i18n?: Record<string, string> | null }
export type Ref = { slug: string; name: string; name_i18n?: Record<string, string> | null }
export type Result = 'eligible' | 'needs_info' | 'not_eligible'

export type MatchReason = { code: string; points: number; detail: (string | number)[] }

export type CareerItem = I18nName & {
  slug: string
  score: number
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

export type Card =
  | { type: 'careers'; what_if?: { can_relocate?: boolean; needs_income_soon?: boolean }; items: CareerItem[] }
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
  | { type: 'question'; field: string | null }

export type CardType = Card['type']
export type CardOf<T extends CardType> = Extract<Card, { type: T }>
