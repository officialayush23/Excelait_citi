/**
 * Career matching with reasons. Mirrors backend/app/engine/matching.py exactly,
 * so careers can be ranked on the phone with no network.
 */

export type Career = {
  slug: string
  name: string
  name_i18n: Record<string, string>
  category: string
  nco_code: string | null
  nsqf_level: number | null
  pay_min: number | null
  pay_max: number | null
  min_education: string
  earning_speed: 'fast' | 'medium' | 'slow'
  cost_band: 'low' | 'medium' | 'high'
  interest_tags: string[]
  subject_tags: string[]
  rural_demand: number
  needs_city: boolean
  path: string[]
  scheme_slugs: string[]
  exam_slugs: string[]
  /** Where the pay and path figures come from (backend/scripts/reference_careers.py). Absent on older catalogues. */
  sources?: CareerSource[]
  pay_evidence?: { min: number | null; max: number | null; n_sources: number } | null
  pay_status?: 'matches' | 'differs' | 'unverified' | null
  checked_on?: string | null
  /** Set when the catalogue says a job is closed to minors. */
  min_age?: number | null
  hazardous_for_minors?: boolean
}

export type CareerSource = { title: string; url: string; site: string; note: string }

export type MatchProfile = {
  interests?: string[]
  subjects?: string[]
  marks_percent?: number | null
  family_income_annual?: number | null
  needs_income_soon?: boolean | null
  can_relocate?: boolean | null
}

export type Reason = { code: string; points: number; detail: (string | number)[] }
export type Gap = { code: string; detail: (string | number)[] }
export type Match = { slug: string; score: number; reasons: Reason[]; gaps: Gap[] }

const W = { interest: 35, subjects: 20, demand: 15, marks: 10, affordability: 10, earning: 10 }
const MARKS_BAR: Record<string, number> = { ug_degree: 50, ug_technical: 50, diploma: 40, class_12: 40 }
const COST_POINTS = { low: 10, medium: 6, high: 2 }
export const MAX_PER_CATEGORY = 3

// Python's round() rounds halves to even; match it so both engines agree to the point.
function roundHalfEven(x: number, digits = 0): number {
  const m = 10 ** digits
  const v = x * m
  const f = Math.floor(v)
  const diff = v - f
  let r: number
  if (Math.abs(diff - 0.5) < 1e-9) r = f % 2 === 0 ? f : f + 1
  else r = Math.round(v)
  return r / m
}
const r2 = (x: number) => roundHalfEven(x, 2)

export function scoreCareer(c: Career, p: MatchProfile): Match {
  const reasons: Reason[] = []
  const gaps: Gap[] = []

  const interests = new Set(p.interests ?? [])
  const hits = c.interest_tags.filter((t) => interests.has(t)).sort()
  const pts = r2(W.interest * Math.min(1, hits.length / 2))
  if (hits.length) reasons.push({ code: 'interest', points: pts, detail: hits })

  const subjects = new Set(p.subjects ?? [])
  let ptsS: number
  if (c.subject_tags.length === 0) {
    ptsS = r2(W.subjects * 0.5)
    reasons.push({ code: 'no_subject_barrier', points: ptsS, detail: [] })
  } else {
    const sh = c.subject_tags.filter((t) => subjects.has(t)).sort()
    ptsS = r2(W.subjects * Math.min(1, sh.length / Math.min(2, c.subject_tags.length)))
    if (sh.length) reasons.push({ code: 'subjects', points: ptsS, detail: sh })
    else gaps.push({ code: 'subjects', detail: c.subject_tags })
  }

  const cityBlocked = c.needs_city && p.can_relocate === false
  const ptsD = r2(W.demand * c.rural_demand * (cityBlocked ? 0.3 : 1))
  if (cityBlocked) gaps.push({ code: 'needs_city', detail: [] })
  else if (c.rural_demand >= 0.7) reasons.push({ code: 'local_demand', points: ptsD, detail: [] })

  const marks = p.marks_percent
  const bar = MARKS_BAR[c.min_education] ?? 0
  let ptsM: number
  if (marks === null || marks === undefined) ptsM = r2(W.marks * 0.5)
  else if (marks >= bar) {
    ptsM = W.marks
    if (bar) reasons.push({ code: 'marks', points: ptsM, detail: [bar] })
  } else {
    ptsM = r2((W.marks * marks) / bar)
    gaps.push({ code: 'marks', detail: [bar] })
  }

  const lowIncome = (p.family_income_annual ?? 1e9) <= 250000
  const ptsA = c.cost_band === 'high' && lowIncome ? 0 : COST_POINTS[c.cost_band]
  if (c.cost_band === 'low') reasons.push({ code: 'affordable', points: ptsA, detail: [] })
  else if (c.cost_band === 'high') gaps.push({ code: 'cost', detail: c.scheme_slugs })

  let ptsE: number
  if (p.needs_income_soon) {
    ptsE = { fast: 10, medium: 5, slow: 0 }[c.earning_speed]
    if (c.earning_speed === 'fast') reasons.push({ code: 'earn_soon', points: ptsE, detail: [] })
    else if (c.earning_speed === 'slow') gaps.push({ code: 'slow_to_earn', detail: [] })
  } else ptsE = { fast: 8, medium: 8, slow: 7 }[c.earning_speed]

  const total = pts + ptsS + ptsD + ptsM + ptsA + ptsE
  reasons.sort((a, b) => b.points - a.points || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  return { slug: c.slug, score: roundHalfEven(total), reasons, gaps }
}

/** Best matches, at most MAX_PER_CATEGORY from one category, so options stay wide. */
export function rank(careers: Career[], profile: MatchProfile, limit = 10): Match[] {
  const scored = careers
    .map((c) => scoreCareer(c, profile))
    .sort((a, b) => b.score - a.score || (a.slug < b.slug ? -1 : 1))
  const cat = Object.fromEntries(careers.map((c) => [c.slug, c.category]))
  const per: Record<string, number> = {}
  const picked: Match[] = []
  for (const m of scored) {
    const k = cat[m.slug]
    if ((per[k] ?? 0) >= MAX_PER_CATEGORY) continue
    per[k] = (per[k] ?? 0) + 1
    picked.push(m)
    if (picked.length === limit) break
  }
  return picked
}
