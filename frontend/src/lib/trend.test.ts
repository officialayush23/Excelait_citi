import { describe, expect, it } from 'vitest'

import { linearTrend } from './trend'

describe('linearTrend', () => {
  it('fits an exact line with a zero band', () => {
    const t = linearTrend([{ year: 2020, value: 10 }, { year: 2021, value: 12 }, { year: 2022, value: 14 }])!
    expect(t.slope).toBeCloseTo(2)
    expect(t.se).toBeCloseTo(0)
    expect(t.projection.map((p) => p.year)).toEqual([2023, 2024, 2025])
    expect(t.projection.map((p) => p.value)).toEqual([16, 18, 20].map((v) => expect.closeTo(v, 6)))
    expect(t.projection[0].high - t.projection[0].low).toBeCloseTo(0)
  })

  it('uses 1.96 x residual standard error for the band', () => {
    // y = 1,3,2,4 at x = 0..3 -> slope 0.8, intercept 1.3, SSE 1.8 -> se = sqrt(1.8/2)
    const t = linearTrend([{ year: 0, value: 1 }, { year: 1, value: 3 }, { year: 2, value: 2 }, { year: 3, value: 4 }])!
    expect(t.slope).toBeCloseTo(0.8)
    expect(t.intercept).toBeCloseTo(1.3)
    expect(t.se).toBeCloseTo(Math.sqrt(0.9))
    const p = t.projection[0]
    expect(p.year).toBe(4)
    expect(p.value).toBeCloseTo(4.5)
    expect(p.high - p.value).toBeCloseTo(1.96 * Math.sqrt(0.9))
    expect(p.value - p.low).toBeCloseTo(1.96 * Math.sqrt(0.9))
  })

  it('handles a flat series, two points and too little data', () => {
    expect(linearTrend([{ year: 1, value: 5 }, { year: 2, value: 5 }, { year: 3, value: 5 }])!.slope).toBeCloseTo(0)
    const two = linearTrend([{ year: 1, value: 1 }, { year: 2, value: 3 }])!
    expect(two.se).toBe(0)
    expect(two.projection[2].value).toBeCloseTo(9)
    expect(linearTrend([{ year: 1, value: 1 }])).toBeNull()
    expect(linearTrend([{ year: 1, value: 1 }, { year: 1, value: 2 }])).toBeNull()
  })
})
