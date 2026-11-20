/**
 * Three-valued eligibility engine. Mirrors backend/app/engine/rules.py exactly,
 * so the phone gives the same answer offline as the server does online.
 */

export type Facts = Record<string, unknown>
export type Op = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'not_in' | 'between' | 'is_true' | 'is_false'
export type Condition = { id?: string; label?: string; field: string; op: Op; value?: unknown }
export type Group = { id?: string; label?: string; all?: RuleNode[]; any?: RuleNode[] }
export type RuleNode = Condition | Group
export type Ref = { id: string; label: string }
export type Outcome = {
  result: 'eligible' | 'not_eligible' | 'needs_info'
  failed: Ref[]
  missing: string[]
  passed: Ref[]
}

type State = 'T' | 'F' | 'U'

const isMissing = (v: unknown) => v === null || v === undefined || v === ''

function compare(op: Op, actual: unknown, expected: unknown): boolean {
  const a = actual as number
  const e = expected as number
  switch (op) {
    case 'eq':
      return actual === expected
    case 'ne':
      return actual !== expected
    case 'lt':
      return a < e
    case 'lte':
      return a <= e
    case 'gt':
      return a > e
    case 'gte':
      return a >= e
    case 'in':
      return (expected as unknown[]).includes(actual)
    case 'not_in':
      return !(expected as unknown[]).includes(actual)
    case 'between': {
      const [lo, hi] = expected as [number, number]
      return lo <= a && a <= hi
    }
    case 'is_true':
      return actual === true
    case 'is_false':
      return actual === false
    default:
      throw new Error(`Unknown operator: ${op as string}`)
  }
}

const ref = (n: { id?: string; label?: string }): Ref => ({ id: n.id ?? '', label: n.label ?? '' })

function evalNode(node: RuleNode, facts: Facts, out: Outcome): State {
  if ('all' in node || 'any' in node) {
    const g = node as Group
    const isAll = g.all !== undefined
    const children = (isAll ? g.all : g.any) ?? []
    const child: Outcome = { result: 'eligible', failed: [], missing: [], passed: [] }
    const states = children.map((c) => evalNode(c, facts, child))
    let state: State
    if (isAll) {
      if (states.includes('F')) {
        out.failed.push(...child.failed)
        return 'F'
      }
      state = states.includes('U') ? 'U' : 'T'
    } else {
      if (states.includes('T')) {
        out.passed.push(...child.passed)
        return 'T'
      }
      if (!states.includes('U')) {
        out.failed.push(g.label ? ref(g) : (child.failed[0] ?? ref(g)))
        return 'F'
      }
      state = 'U'
    }
    out.passed.push(...child.passed)
    for (const m of child.missing) if (!out.missing.includes(m)) out.missing.push(m)
    return state
  }

  const c = node as Condition
  const actual = facts[c.field]
  if (isMissing(actual)) {
    if (!out.missing.includes(c.field)) out.missing.push(c.field)
    return 'U'
  }
  const ok = compare(c.op, actual, c.value)
  ;(ok ? out.passed : out.failed).push(ref(c))
  return ok ? 'T' : 'F'
}

export function evaluate(rule: RuleNode, facts: Facts): Outcome {
  const out: Outcome = { result: 'eligible', failed: [], missing: [], passed: [] }
  const state = evalNode(rule, facts, out)
  if (state === 'T') return { result: 'eligible', failed: [], missing: [], passed: out.passed }
  if (state === 'F') return { result: 'not_eligible', failed: out.failed, missing: [], passed: out.passed }
  return { result: 'needs_info', failed: [], missing: out.missing, passed: out.passed }
}
