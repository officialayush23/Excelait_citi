import { SlidersHorizontal, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export type FilterChip = { id: string; label: string }

type Props = {
  chips: FilterChip[]
  active: string[]
  onToggle: (id: string) => void
  onClear?: () => void
  className?: string
}

/** Row of toggle chips with an active-filter count (dark reference: "Active filters 2"). */
export function FilterBar({ chips, active, onToggle, onClear, className }: Props) {
  const { t } = useTranslation()
  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>
      <span className="mr-1 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <SlidersHorizontal className="size-4" />
        {t('common.filters')}
        {active.length > 0 && (
          <span className="grid size-5 place-items-center rounded-full bg-highlight text-xs font-semibold text-highlight-foreground">
            {active.length}
          </span>
        )}
      </span>
      {chips.map((chip) => {
        const on = active.includes(chip.id)
        return (
          <motion.button
            layout
            key={chip.id}
            type="button"
            onClick={() => onToggle(chip.id)}
            aria-pressed={on}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
              on ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card text-foreground/80 hover:text-foreground',
            )}
          >
            {chip.label}
            {on && <X className="size-3.5" aria-hidden="true" />}
          </motion.button>
        )
      })}
      {active.length > 0 && onClear && (
        <button type="button" onClick={onClear} className="ml-1 text-sm text-muted-foreground underline-offset-4 hover:underline">
          {t('common.clear')}
        </button>
      )}
    </div>
  )
}
