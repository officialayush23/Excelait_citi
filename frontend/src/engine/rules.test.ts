import { describe, expect, it } from 'vitest'

import fixtures from '@shared/rules/fixtures.json'
import data from '@shared/rules/schemes.json'

import { evaluate, type RuleNode } from './rules'

const schemes = Object.fromEntries(data.schemes.map((s) => [s.slug, s]))

describe('shared eligibility fixtures (same file as the Python tests)', () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      const out = evaluate(schemes[c.scheme].rule as RuleNode, c.facts)
      const exp = c.expect as { result: string; missing?: string[]; failed?: string[] }
      expect(out.result).toBe(exp.result)
      if (exp.missing) expect(out.missing).toEqual(exp.missing)
      if (exp.failed) expect(out.failed.map((f) => f.id)).toEqual(exp.failed)
    })
  }

  it('never says no when nothing is known', () => {
    for (const s of data.schemes) expect(evaluate(s.rule as RuleNode, {}).result).toBe('needs_info')
  })
})
