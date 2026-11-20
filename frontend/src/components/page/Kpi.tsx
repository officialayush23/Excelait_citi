import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { AnimatedNumber } from '@/components/motion-primitives/animated-number'
import { cn } from '@/lib/utils'

export type Tone = 'plain' | 'rose' | 'peach' | 'lilac' | 'mint' | 'sky' | 'highlight'

const toneClass: Record<Tone, string> = {
  plain: 'bg-card text-card-foreground',
  rose: 'bg-tile-rose text-tile-foreground border-transparent',
  peach: 'bg-tile-peach text-tile-foreground border-transparent',
  lilac: 'bg-tile-lilac text-tile-foreground border-transparent',
  mint: 'bg-tile-mint text-tile-foreground border-transparent',
  sky: 'bg-tile-sky text-tile-foreground border-transparent',
  highlight: 'bg-highlight text-highlight-foreground border-transparent',
}

type KpiProps = {
  label: string
  value: number | null
  prefix?: string
  suffix?: string
  hint?: string
  icon?: ReactNode
  tone?: Tone
  footer?: ReactNode
  className?: string
}

/** A stat card: label, big animated number, optional footer (bars, avatars, progress). */
export function KpiCard({ label, value, prefix, suffix, hint, icon, tone = 'plain', footer, className }: KpiProps) {
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      className={cn('flex min-h-36 flex-col justify-between gap-4 rounded-2xl border p-5', toneClass[tone], className)}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={cn('text-sm font-medium', tone === 'plain' ? 'text-muted-foreground' : 'opacity-75')}>{label}</p>
        {icon && <span className="opacity-70 [&_svg]:size-5">{icon}</span>}
      </div>
      <div>
        <p className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {prefix && <span className="mr-0.5 text-[0.7em] font-medium opacity-70">{prefix}</span>}
          {value === null ? '—' : <AnimatedNumber value={value} springOptions={{ bounce: 0, duration: 1200 }} />}
          {suffix && <span className="ml-1 text-base font-medium opacity-70">{suffix}</span>}
        </p>
        {hint && <p className={cn('mt-1 text-sm', tone === 'plain' ? 'text-muted-foreground' : 'opacity-75')}>{hint}</p>}
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </motion.div>
  )
}

/** Staggers its KpiCards in. */
export function KpiRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      transition={{ staggerChildren: 0.06 }}
      className={cn('grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4', className)}
    >
      {children}
    </motion.div>
  )
}

/** Small bar strip for a KPI footer, e.g. the last few months. Values 0..1. */
export function MiniBars({ values, className }: { values: number[]; className?: string }) {
  return (
    <div className={cn('flex h-8 items-end gap-1', className)} aria-hidden="true">
      {values.map((v, i) => (
        <motion.span
          key={i}
          initial={{ height: 0 }}
          animate={{ height: `${Math.max(8, v * 100)}%` }}
          transition={{ delay: 0.1 + i * 0.04, type: 'spring', stiffness: 200, damping: 24 }}
          className="w-full rounded-full bg-current opacity-25 last:opacity-90"
        />
      ))}
    </div>
  )
}
