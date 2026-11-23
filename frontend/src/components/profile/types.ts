/** Shape of GET /api/v1/students/me/profile (the contract with the backend). */
export type I18nText = { en: string; hi?: string; mr?: string }
export type FactGroup = 'basics' | 'study' | 'interests' | 'skills' | 'money' | 'personal' | 'work'
export type FactSource = 'onboarding' | 'saathi' | 'teacher' | 'quiz' | 'system'
export type RiasecCode = 'R' | 'I' | 'A' | 'S' | 'E' | 'C'

export type ProfileFact = {
  key: string
  value: unknown
  label: I18nText
  group: FactGroup
  source: FactSource
  at: string
  note: string | null
  sensitive: boolean
}

export type GraphNodeType = 'me' | 'fact' | 'interest' | 'career' | 'course' | 'scheme' | 'skill'
export type GraphNode = { id: string; type: GraphNodeType; label: string; group?: string }
export type GraphEdge = { from: string; to: string; label?: string }

export type ProfileData = {
  facts: ProfileFact[]
  interests: {
    riasec: Record<RiasecCode, number> | null
    top: RiasecCode[]
    labels: Partial<Record<RiasecCode, I18nText>>
    tags: string[]
    quiz_done: boolean
  }
  skills: string[]
  subjects: string[]
  saved_careers: { slug: string; name: string; name_i18n?: I18nText }[]
  plans: { id: string; career_slug: string; title: string; done: number; total: number }[]
  money: { eligible_inr: number; eligible: { slug: string; name: string }[]; needs_info: number }
  credentials: { public_id: string; skill: string; issued_at: string }[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
  completeness: { pct: number; next: { field: string; why: string }[] }
}
