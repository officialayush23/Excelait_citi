import { describe, expect, it } from 'vitest'

import catalogue from '@shared/catalogue/careers.json'
import fixtures from '@shared/catalogue/matching_fixtures.json'

import { rank, type Career, type MatchProfile } from './matching'

const careers = catalogue.careers as Career[]

describe('career matching matches the Python engine exactly', () => {
  for (const p of fixtures.personas) {
    it(p.name, () => {
      const got = rank(careers, p.profile as MatchProfile, 10).map((m) => ({ slug: m.slug, score: m.score }))
      expect(got).toEqual(p.expect)
    })
  }
})
