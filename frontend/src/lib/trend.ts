export type TrendPoint = { year: number; value: number }
export type Projected = { year: number; value: number; low: number; high: number }
export type Trend = {
  slope: number
  intercept: number
  /** Residual standard error, sqrt(SSE / (n - 2)); 0 when there are fewer than 3 points. */
  se: number
  projection: Projected[]
}

/**
 * Ordinary least-squares line through the points, projected `ahead` years past the last year.
 * The band is value ± 1.96 × residual standard error. It describes how far past points sit from
 * the line, not the uncertainty of the future. Returns null when fewer than 2 distinct years.
 */
export function linearTrend(points: TrendPoint[], ahead = 3, z = 1.96): Trend | null {
  const n = points.length
  if (n < 2) return null
  const mx = points.reduce((s, p) => s + p.year, 0) / n
  const my = points.reduce((s, p) => s + p.value, 0) / n
  const sxx = points.reduce((s, p) => s + (p.year - mx) ** 2, 0)
  if (sxx === 0) return null
  const slope = points.reduce((s, p) => s + (p.year - mx) * (p.value - my), 0) / sxx
  const intercept = my - slope * mx
  const sse = points.reduce((s, p) => s + (p.value - (intercept + slope * p.year)) ** 2, 0)
  const se = n > 2 ? Math.sqrt(sse / (n - 2)) : 0
  const last = Math.max(...points.map((p) => p.year))
  const projection = Array.from({ length: ahead }, (_, i) => {
    const year = last + i + 1
    const value = intercept + slope * year
    return { year, value, low: value - z * se, high: value + z * se }
  })
  return { slope, intercept, se, projection }
}

/** 2023 -> "2023-24" (survey years run July to June). */
export const period = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`
