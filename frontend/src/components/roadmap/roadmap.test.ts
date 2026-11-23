import { describe, expect, it } from 'vitest'

import en from '@/i18n/parts/roadmap.en.json'
import hi from '@/i18n/parts/roadmap.hi.json'
import mr from '@/i18n/parts/roadmap.mr.json'

import { sampleRoadmap } from './fixture'
import { refHref } from './parts'
import { daysLeft } from './useRoadmap'

function keys(o: Record<string, unknown>, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]))
}

describe('roadmap', () => {
  it('counts days left from today', () => {
    const today = new Date(2026, 10, 23)
    expect(daysLeft('2026-11-30', today)).toBe(7)
    expect(daysLeft('2026-11-23', today)).toBe(0)
    expect(daysLeft(null, today)).toBeNull()
  })
  it('links refs to the right pages', () => {
    expect(refHref({ kind: 'exam', slug: 'neet-ug' })).toBe('/app/exams/neet-ug')
    expect(refHref({ kind: 'scheme', slug: 'x' })).toBe('/app/money?scheme=x')
    expect(refHref({ kind: 'unknown', slug: 'x' })).toBeNull()
  })
  it('has every string in en, hi and mr', () => {
    const want = keys(en).sort()
    expect(keys(hi).sort()).toEqual(want)
    expect(keys(mr).sort()).toEqual(want)
  })
  it('sample roadmap has a next step and steps in every bucket', () => {
    expect(sampleRoadmap.next).not.toBeNull()
    const b = new Set(sampleRoadmap.goals.flatMap((g) => g.steps.map((s) => s.bucket)))
    for (const x of ['now', 'next', 'later', 'done']) expect(b.has(x as never)).toBe(true)
  })
})
