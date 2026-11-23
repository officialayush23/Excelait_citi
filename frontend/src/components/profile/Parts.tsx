import type { ReactNode } from 'react'

import { SpeakButton } from '@/components/shell/SpeakButton'
import { cn } from '@/lib/utils'

/** A titled panel with a read-aloud button, matching the other student pages. */
export function Section({ id, icon, title, hint, speak, actions, children, className }: {
  id?: string
  icon: ReactNode
  title: string
  hint?: string
  speak?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('scroll-mt-20 rounded-3xl border bg-card p-4 sm:p-6', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-tile-sky text-tile-foreground [&_svg]:size-5">{icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              <SpeakButton text={speak ?? (hint ? `${title}. ${hint}` : title)} />
            </div>
            {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}
