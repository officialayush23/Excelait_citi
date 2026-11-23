import { useId } from 'react'

import { period, type Projected, type TrendPoint } from '@/lib/trend'

const W = 360
const H = 210
const M = { l: 38, r: 12, t: 14, b: 30 }

type Props = {
  history: TrendPoint[]
  projection: Projected[]
  unit: string
  ariaLabel: string
}

/** Hand-rolled SVG line chart: history solid, projection dashed with a shaded band. Colours come from --chart-1. */
export function TrendChart({ history, projection, unit, ariaLabel }: Props) {
  const id = useId().replace(/:/g, '')
  const all = [...history.map((p) => p.year), ...projection.map((p) => p.year)]
  const x0 = Math.min(...all)
  const x1 = Math.max(...all)
  const vals = [...history.map((p) => p.value), ...projection.flatMap((p) => [p.low, p.high])]
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 1) / 5) * 5)
  const hi = Math.min(100, Math.ceil((Math.max(...vals) + 1) / 5) * 5)
  const sx = (y: number) => M.l + ((y - x0) / Math.max(1, x1 - x0)) * (W - M.l - M.r)
  const sy = (v: number) => H - M.b - ((Math.min(hi, Math.max(lo, v)) - lo) / Math.max(1, hi - lo)) * (H - M.t - M.b)
  const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3)
  const line = (pts: { year: number; value: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.year).toFixed(1)} ${sy(p.value).toFixed(1)}`).join(' ')
  const last = history[history.length - 1]
  const joined = [{ year: last.year, value: last.value }, ...projection]
  const band = projection.length
    ? `M${sx(last.year).toFixed(1)} ${sy(last.value).toFixed(1)} ` +
      projection.map((p) => `L${sx(p.year).toFixed(1)} ${sy(p.high).toFixed(1)}`).join(' ') +
      ' ' +
      [...projection].reverse().map((p) => `L${sx(p.year).toFixed(1)} ${sy(p.low).toFixed(1)}`).join(' ') +
      ' Z'
    : ''
  const labelYears = [...history, ...projection].map((p) => p.year).filter((_, i, a) => a.length <= 6 || i % 2 === 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="block h-auto w-full max-w-full">
      <title>{ariaLabel}</title>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} className="stroke-border" strokeWidth="1" />
          <text x={M.l - 6} y={sy(v) + 3.5} textAnchor="end" className="fill-muted-foreground" fontSize="10">
            {Math.round(v)}
          </text>
        </g>
      ))}
      <text x={M.l} y={9} className="fill-muted-foreground" fontSize="9.5">
        {unit}
      </text>
      {band && <path d={band} className="fill-chart-1/20" data-testid={`band-${id}`} />}
      <path d={line(joined)} fill="none" className="stroke-chart-1" strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={line(history)} fill="none" className="stroke-chart-1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {history.map((p) => (
        <circle key={p.year} cx={sx(p.year)} cy={sy(p.value)} r="4.5" className="fill-card stroke-chart-1" strokeWidth="2.5" />
      ))}
      {projection.map((p) => (
        <circle key={p.year} cx={sx(p.year)} cy={sy(p.value)} r="3.5" className="fill-card stroke-chart-1" strokeWidth="2" strokeDasharray="2 2" />
      ))}
      {history.map((p) => (
        <text key={`v${p.year}`} x={sx(p.year)} y={sy(p.value) - 9} textAnchor="middle" className="fill-foreground" fontSize="10" fontWeight="600">
          {p.value}
        </text>
      ))}
      {labelYears.map((y) => (
        <text key={y} x={sx(y)} y={H - 10} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
          {period(y)}
        </text>
      ))}
    </svg>
  )
}
