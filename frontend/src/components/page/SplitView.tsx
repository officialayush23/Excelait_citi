import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type Props = {
  list: ReactNode
  detail: ReactNode | null
  /** Changes when a different item is selected, so the detail panel animates in. */
  detailKey?: string | null
  listTitle?: ReactNode
  className?: string
}

/**
 * The work area from the dark reference: list on the left, the selected item's
 * detail on the right. On phones the detail stacks under the list.
 */
export function SplitView({ list, detail, detailKey, listTitle, className }: Props) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,0.9fr)_1.4fr]', className)}>
      <section className="flex min-h-80 min-w-0 flex-col rounded-[1.75rem] bg-card p-3 ring-1 ring-black/[0.04] sm:p-4 dark:ring-white/[0.05]">
        {listTitle && <div className="px-2 pt-1 pb-3">{listTitle}</div>}
        <div className="flex flex-col gap-1">{list}</div>
      </section>
      <section className="relative min-h-80 min-w-0 overflow-hidden rounded-[1.75rem] bg-surface p-4 ring-1 ring-black/[0.04] sm:p-6 dark:ring-white/[0.05]">
        <AnimatePresence mode="wait">
          {detail && (
            <motion.div
              key={detailKey ?? 'detail'}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {detail}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  )
}

type RowProps = {
  selected?: boolean
  onSelect?: () => void
  leading?: ReactNode
  title: string
  subtitle?: string
  trailing?: ReactNode
}

export function ListRow({ selected, onSelect, leading, title, subtitle, trailing }: RowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors',
        selected ? 'text-nav-active-foreground' : 'hover:bg-accent',
      )}
    >
      {selected && (
        <motion.span
          layoutId="list-selection"
          className="absolute inset-0 rounded-2xl bg-nav-active"
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        />
      )}
      {leading && <span className="relative shrink-0">{leading}</span>}
      <span className="relative min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && <span className={cn('block truncate text-sm', selected ? 'opacity-75' : 'text-muted-foreground')}>{subtitle}</span>}
      </span>
      {trailing && <span className="relative shrink-0 text-sm">{trailing}</span>}
    </button>
  )
}
