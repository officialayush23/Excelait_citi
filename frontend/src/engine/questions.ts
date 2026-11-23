/**
 * The adaptive question planner, on the phone. Mirrors backend/app/services/profile_questions.py and
 * reads the same shared/rules/questions.json, so onboarding still asks the right next question with
 * no network. shared/rules/question_fixtures.json keeps the two in step (questions.test.ts).
 */
import doc from '@shared/rules/questions.json'

export type Lang = 'en' | 'hi' | 'mr'
export type I18n = { en: string; hi?: string; mr?: string }
type Cond = { fact: string; op: string; value?: unknown } | { any: Cond[] } | { all: Cond[] } | { not: Cond }
type RawOption = { value: string | number | boolean; label: I18n; applies_if?: Cond[]; sets?: Record<string, unknown> }
type RawVariant = { id: string; applies_if?: Cond[]; text?: I18n; hint?: I18n; why?: I18n; options?: RawOption[] }
export type RawQuestion = {
  field: string
  type: 'single' | 'multi' | 'number' | 'text' | 'district' | 'scale'
  tier: 'core' | 'more'
  priority: number
  label?: I18n
  group?: string
  text?: I18n
  hint?: I18n
  why?: I18n
  sensitive?: boolean
  applies_if?: Cond[]
  core_if?: Cond[]
  options?: RawOption[]
  variants?: RawVariant[]
  min?: number
  max?: number
  max_select?: number
  variant?: string
}

/** One question ready to show, in the API's shape (GET /api/v1/students/me/next-questions). */
export type PlannedQuestion = {
  id: string
  field: string
  type: RawQuestion['type']
  tier: 'core' | 'more'
  text: string | null
  hint: string | null
  why: string | null
  sensitive: boolean
  skippable: boolean
  options: { value: string | number | boolean; label: string; sets?: Record<string, unknown> }[]
  min?: number
  max?: number
  max_select?: number
}
export type NextQuestions = {
  context: string
  phase: 'core' | 'more' | 'done'
  questions: PlannedQuestion[]
  remaining: { core: number; more: number }
  quiz_done: boolean
  completeness: { pct: number; next: { field: string; why: string | null }[] }
}
export type QuizItem = { id: string; code: string; text: I18n }

const QUESTIONS = (doc as unknown as { questions: RawQuestion[] }).questions
const QUIZ = (doc as unknown as { interest_quiz: { items: QuizItem[]; scale: { value: number; label: I18n }[]; types: Record<string, { label: I18n; desc: I18n }> } })
  .interest_quiz
export const quiz = QUIZ
export const RIASEC = ['R', 'I', 'A', 'S', 'E', 'C']
const SCHOOL = ['c8', 'c9', 'c10', 'c11', 'c12']
const COLLEGE = ['iti', 'diploma', 'ug_degree', 'ug_technical', 'pg']
export const byField: Record<string, RawQuestion> = Object.fromEntries(QUESTIONS.map((q) => [q.field, q]))

type Facts = Record<string, unknown>
const isNum = (x: unknown): x is number => typeof x === 'number'
const has = (v: unknown) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)

function ageFromDob(dob: unknown): number | null {
  if (typeof dob !== 'string') return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const t = new Date()
  return t.getFullYear() - d.getFullYear() - (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate()) ? 1 : 0)
}

export function deriveStage(f: Facts): string | null {
  if (f.stage) return f.stage as string
  const course = f.course as string | undefined
  const level = f.class_level
  if (isNum(level) && level <= 12 && (course === undefined || course === null || course === 'school')) return level >= 8 ? `c${Math.trunc(level)}` : null
  if (course && COLLEGE.includes(course)) return course
  if (course === 'none') return 'not_studying'
  return null
}

export function view(facts: Facts, intent: string | null = null): Facts {
  const v: Facts = { ...facts }
  if ((v.age === undefined || v.age === null) && v.date_of_birth) v.age = ageFromDob(v.date_of_birth)
  const stage = deriveStage(v)
  v.stage = stage
  const age = v.age
  v.school = stage !== null && SCHOOL.includes(stage)
  v.college = stage !== null && COLLEGE.includes(stage)
  v.job_seeker = stage === 'job_seeker' || (stage === 'not_studying' && isNum(age) && age >= 18)
  v.intent = intent
  v.earning = v.needs_income_soon === true || v.job_seeker === true || intent === 'earn' || intent === 'jobs'
  return v
}

export function cond(c: Cond | Cond[], v: Facts): boolean {
  if (Array.isArray(c)) return c.every((x) => cond(x, v))
  if ('all' in c) return c.all.every((x) => cond(x, v))
  if ('any' in c) return c.any.some((x) => cond(x, v))
  if ('not' in c) return !cond(c.not, v)
  const val = v[c.fact]
  const want = c.value
  switch (c.op) {
    case 'known':
      return has(val)
    case 'unknown':
      return !has(val)
    case 'is_true':
      return val === true
    case 'is_false':
      return val === false
    case 'ne':
      return val !== want
    case 'not_in':
      return !(want as unknown[]).includes(val)
  }
  if (val === null || val === undefined) return false
  if (c.op === 'eq') return val === want
  if (c.op === 'in') return (want as unknown[]).includes(val)
  if (!isNum(val)) return false
  const w = want as number
  return c.op === 'lt' ? val < w : c.op === 'lte' ? val <= w : c.op === 'gt' ? val > w : c.op === 'gte' ? val >= w : false
}

const isKnown = (field: string, v: Facts) => has(v[field])
const applies = (q: RawQuestion, v: Facts) => cond(q.applies_if ?? [], v)

export function variant(q: RawQuestion, v: Facts): RawQuestion {
  for (const vr of q.variants ?? []) {
    if (cond(vr.applies_if ?? [], v)) {
      const { applies_if: _a, ...rest } = vr
      void _a
      return { ...q, ...rest, variant: vr.id }
    }
  }
  return q
}

export const tierOf = (q: RawQuestion, v: Facts): 'core' | 'more' => (q.tier === 'core' || (q.core_if && cond(q.core_if, v)) ? 'core' : 'more')

export function pending(facts: Facts, opts: { intent?: string | null; skip?: string[]; includeSensitive?: boolean } = {}): RawQuestion[] {
  const v = view(facts, opts.intent ?? null)
  const skip = new Set(opts.skip ?? [])
  const out = QUESTIONS.filter((q) => !skip.has(q.field) && !isKnown(q.field, v) && applies(q, v) && (opts.includeSensitive !== false || !q.sensitive))
  return out.sort((a, b) => {
    const ta = tierOf(a, v) !== 'core' ? 1 : 0
    const tb = tierOf(b, v) !== 'core' ? 1 : 0
    return ta - tb || b.priority - a.priority || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0)
  })
}

const txt = (t: I18n | undefined, lang: Lang) => (t ? (t[lang] ?? t.en) : null)

export function payload(q0: RawQuestion, facts: Facts, lang: Lang = 'en', intent: string | null = null): PlannedQuestion {
  const v = view(facts, intent)
  const q = variant(q0, v)
  const out: PlannedQuestion = {
    id: q.field + (q.variant ? `:${q.variant}` : ''),
    field: q.field,
    type: q.type,
    tier: tierOf(q, v),
    text: txt(q.text, lang),
    hint: txt(q.hint, lang),
    why: txt(q.why, lang),
    sensitive: Boolean(q.sensitive),
    skippable: true,
    options: (q.options ?? []).filter((o) => cond(o.applies_if ?? [], v)).map((o) => ({ value: o.value, label: txt(o.label, lang) ?? String(o.value), ...(o.sets ? { sets: o.sets } : {}) })),
  }
  if (q.min !== undefined) out.min = q.min
  if (q.max !== undefined) out.max = q.max
  if (q.max_select !== undefined) out.max_select = q.max_select
  return out
}

export function quizDone(facts: Facts) {
  const r = facts.riasec as Record<string, unknown> | undefined
  return Boolean(r && typeof r === 'object' && RIASEC.some((k) => k in r))
}

export function completeness(facts: Facts, lang: Lang = 'en', intent: string | null = null) {
  const v = view(facts, intent)
  const fit = QUESTIONS.filter((q) => !q.sensitive && applies(q, v))
  const done = fit.filter((q) => isKnown(q.field, v)).length + (quizDone(facts) ? 1 : 0)
  const total = fit.length + 1
  const next = pending(facts, { intent, includeSensitive: false })
    .slice(0, 3)
    .map((q) => ({ field: q.field, why: txt(variant(q, v).why, lang) }))
  return { pct: total ? Math.round((100 * done) / total) : 100, next }
}

/** Same answer as GET /students/me/next-questions, worked out on the phone. */
export function nextQuestions(facts: Facts, context: 'onboarding' | 'saathi' = 'onboarding', limit = 1, opts: { lang?: Lang; intent?: string | null; skip?: string[] } = {}): NextQuestions {
  const lang = opts.lang ?? 'en'
  const intent = opts.intent ?? null
  const todo = pending(facts, { intent, skip: opts.skip, includeSensitive: context !== 'saathi' })
  const v = view(facts, intent)
  return {
    context,
    phase: todo.length ? tierOf(todo[0], v) : 'done',
    questions: todo.slice(0, Math.max(0, limit)).map((q) => payload(q, facts, lang, intent)),
    remaining: { core: todo.filter((q) => tierOf(q, v) === 'core').length, more: todo.filter((q) => tierOf(q, v) === 'more').length },
    quiz_done: quizDone(facts),
    completeness: completeness(facts, lang, intent),
  }
}

/** The facts patch for one answer: the value plus whatever the chosen option sets (stage -> class and course). */
export function applyAnswer(field: string, value: unknown, facts: Facts = {}): Facts {
  const patch: Facts = { [field]: value }
  const q0 = byField[field]
  if (!q0) return patch
  const q = variant(q0, view(facts))
  const picked = Array.isArray(value) ? value : [value]
  for (const o of q.options ?? []) {
    if (!picked.includes(o.value) || !o.sets) continue
    for (const [k, sv] of Object.entries(o.sets)) {
      patch[k] = Array.isArray(sv) && Array.isArray(patch[k]) ? [...new Set([...(patch[k] as unknown[]), ...sv])] : sv
    }
  }
  return patch
}

/** like=2, not sure=1, dislike=0; each type's total as a percent of its maximum. Unanswered counts as 'not sure'. */
export function scoreQuiz(answers: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const code of RIASEC) {
    const mine = QUIZ.items.filter((i) => i.code === code)
    const got = mine.reduce((s, i) => s + Math.min(2, Math.max(0, Math.trunc(answers[i.id] ?? 1))), 0)
    out[code] = mine.length ? Math.round((100 * got) / (2 * mine.length)) : 0
  }
  return out
}

export const typeLabel = (code: string, lang: Lang) => txt(QUIZ.types[code]?.label, lang) ?? code
export const typeDesc = (code: string, lang: Lang) => txt(QUIZ.types[code]?.desc, lang) ?? ''
export const factLabel = (key: string, lang: Lang) => txt(byField[key]?.label, lang) ?? key

/** The label a student saw for an answer ('c10' -> 'Class 10'). */
export function optionLabel(field: string, value: unknown, lang: Lang): string {
  const q = byField[field]
  for (const opts of [q?.options ?? [], ...(q?.variants ?? []).map((x) => x.options ?? [])]) {
    const o = opts.find((x) => x.value === value)
    if (o) return txt(o.label, lang) ?? String(value)
  }
  return String(value)
}
