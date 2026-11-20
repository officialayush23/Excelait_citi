import { useMemo } from 'react'

import { careers, schemes, fields, type Scheme } from '@/data/catalogue'
import { useFacts } from '@/data/facts'
import { rank, type Match, type MatchProfile } from '@/engine/matching'
import { evaluate, type Outcome } from '@/engine/rules'

export type WhatIf = { can_relocate?: boolean; needs_income_soon?: boolean }

export function toProfile(facts: Record<string, unknown>, whatIf: WhatIf = {}): MatchProfile {
  return {
    interests: (facts.interests as string[]) ?? [],
    subjects: (facts.subjects as string[]) ?? [],
    marks_percent: (facts.marks_percent as number) ?? null,
    family_income_annual: (facts.family_income_annual as number) ?? null,
    needs_income_soon: (whatIf.needs_income_soon ?? facts.needs_income_soon ?? null) as boolean | null,
    can_relocate: (whatIf.can_relocate ?? facts.can_relocate ?? null) as boolean | null,
  }
}

/** Ranked careers, computed on the phone from the bundled catalogue. */
export function useMatches(whatIf: WhatIf = {}): Match[] {
  const facts = useFacts((s) => s.facts)
  return useMemo(() => rank(careers, toProfile(facts, whatIf), 10), [facts, whatIf])
}

export type SchemeCheck = Outcome & { scheme: Scheme }

const ORDER = { eligible: 0, needs_info: 1, not_eligible: 2 } as const

/** Every active scheme checked against the student's facts by the rules engine. */
export function useEligibility() {
  const facts = useFacts((s) => s.facts)
  return useMemo(() => {
    const checks: SchemeCheck[] = schemes.map((scheme) => ({ scheme, ...evaluate(scheme.rule, facts) }))
    checks.sort(
      (a, b) =>
        ORDER[a.result] - ORDER[b.result] ||
        a.missing.length - b.missing.length ||
        (b.scheme.benefit_amount ?? 0) - (a.scheme.benefit_amount ?? 0),
    )
    const eligible = checks.filter((c) => c.result === 'eligible')
    return {
      checks,
      eligible,
      rupees: eligible.reduce((sum, c) => sum + (c.scheme.benefit_amount ?? 0), 0),
      oneAway: checks.filter((c) => c.result === 'needs_info' && c.missing.length === 1),
    }
  }, [facts])
}

/** Missing facts in the order the app should ask them. */
export function sortByAsk(missing: string[]) {
  return [...missing].sort((a, b) => (fields[a]?.ask ?? 99) - (fields[b]?.ask ?? 99))
}

export function profileComplete(facts: Record<string, unknown>) {
  return Boolean((facts.interests as string[] | undefined)?.length) && facts.class_level != null
}
