import { ArrowUpRight } from 'lucide-react'
import { motion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

/** A bento tile: big radius, no border in dark, a hairline in light. */
export function BentoCard({ className, children, delay = 0 }: { className?: string; children: ReactNode; delay?: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn('relative flex min-w-0 flex-col rounded-[1.75rem] bg-card p-5 text-card-foreground ring-1 ring-black/[0.04] sm:p-6 dark:ring-white/[0.05]', className)}
    >
      {children}
    </motion.section>
  )
}

/** Tile title with an optional icon chip on the left and the ↗ button on the right. */
export function BentoHead({ icon, title, to, label, id }: { icon?: ReactNode; title: ReactNode; to?: string; label?: string; id?: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      {icon && (
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground [&_svg]:size-[18px]">{icon}</span>
      )}
      <h2 id={id} className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
        {title}
      </h2>
      {to && (
        <Link
          to={to}
          aria-label={label}
          className="grid size-10 shrink-0 place-items-center rounded-full ring-1 ring-border transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowUpRight className="size-[18px]" aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}

export type DonutPart = { value: number; className: string; striped?: boolean }

/**
 * Ring chart from the reference: solid arcs with gaps, and an optional striped arc
 * for "still to do". Colours come from Tailwind stroke classes so both themes work.
 */
export function Donut({ parts, size = 176, thickness = 26, children }: { parts: DonutPart[]; size?: number; thickness?: number; children?: ReactNode }) {
  const id = useId().replace(/:/g, '')
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 6 : 0
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((s, p) => s + (p.value / total) * c, 0))
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <defs>
          <pattern id={`stripe-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="fill-card" />
            <line x1="0" y1="0" x2="0" y2="6" strokeWidth="3.2" className="stroke-foreground/70" />
          </pattern>
        </defs>
        {parts.map((p, i) => {
          if (p.value <= 0) return null
          const offset = starts[i]
          const len = Math.max(0, (p.value / total) * c - gap)
          const el = (
            <motion.circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={thickness}
              strokeLinecap="round"
              className={p.striped ? undefined : p.className}
              stroke={p.striped ? `url(#stripe-${id})` : undefined}
              strokeDasharray={`${len} ${c}`}
              initial={{ strokeDashoffset: -offset + len }}
              animate={{ strokeDashoffset: -offset }}
              transition={{ duration: 0.9, delay: 0.1 * i, ease: [0.22, 1, 0.36, 1] }}
            />
          )
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

export function Legend({ items }: { items: { label: string; className: string; striped?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span
            className={cn('size-2.5 rounded-full', it.className)}
            style={it.striped ? { backgroundImage: 'repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 4px)' } : undefined}
          />
          {it.label}
        </li>
      ))}
    </ul>
  )
}

/** Column bars in rounded tracks, the tallest one highlighted. */
export function Bars({ data }: { data: { key: string; label: string; value: number; to?: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const top = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0)
  return (
    <ol className="flex h-48 items-end gap-2 sm:gap-3">
      {data.map((d, i) => {
        const bar = (
          <>
            <span className="relative flex h-full w-full items-end overflow-hidden rounded-2xl bg-muted">
              <motion.span
                className={cn('w-full rounded-2xl', i === top ? 'bg-primary' : 'bg-primary/55')}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(8, (d.value / max) * 100)}%` }}
                transition={{ duration: 0.8, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
              />
              <span className={cn('absolute inset-x-0 top-2 text-center text-[11px] font-semibold tabular-nums', i === top ? 'text-primary-foreground' : 'text-foreground/80')}>{d.value}%</span>
            </span>
            <span className="w-full truncate text-center text-[11px] text-muted-foreground">{d.label}</span>
          </>
        )
        return (
          <li key={d.key} className="flex h-full min-w-0 flex-1">
            {d.to ? (
              <Link to={d.to} className="flex h-full w-full flex-col items-center gap-1.5 rounded-2xl focus-visible:outline-2 focus-visible:outline-ring" title={d.label}>
                {bar}
              </Link>
            ) : (
              <span className="flex h-full w-full flex-col items-center gap-1.5">{bar}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
