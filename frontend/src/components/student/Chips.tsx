import { Check } from 'lucide-react'
import { motion } from 'motion/react'

import { cn } from '@/lib/utils'

export type ChipOption = { value: string; label: string }

type Props = {
  options: ChipOption[]
  value: string[]
  onChange: (next: string[]) => void
  multiple?: boolean
  max?: number
  className?: string
}

/** Big tap targets: answering without typing is the default for students. */
export function ChipGroup({ options, value, onChange, multiple, max, className }: Props) {
  const picked = new Set(value)
  function toggle(v: string) {
    if (!multiple) return onChange([v])
    if (picked.has(v)) return onChange(value.filter((x) => x !== v))
    if (max && value.length >= max) return
    onChange([...value, v])
  }
  return (
    <div role={multiple ? 'group' : 'radiogroup'} className={cn('flex flex-wrap gap-2.5', className)}>
      {options.map((o) => {
        const on = picked.has(o.value)
        return (
          <motion.button
            key={o.value}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={on}
            whileTap={{ scale: 0.96 }}
            onClick={() => toggle(o.value)}
            className={cn(
              'inline-flex min-h-12 items-center gap-2 rounded-full border px-5 text-base font-medium transition-colors',
              on ? 'border-transparent bg-highlight text-highlight-foreground' : 'bg-card hover:bg-accent',
            )}
          >
            {on && <Check className="size-4" />}
            {o.label}
          </motion.button>
        )
      })}
    </div>
  )
}
