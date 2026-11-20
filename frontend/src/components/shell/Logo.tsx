import { cn } from '@/lib/utils'

/** ExcelAIt mark: a rising path inside a rounded square. */
export function Logo({ className, withWord = true }: { className?: string; withWord?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="grid size-9 place-items-center rounded-xl bg-highlight text-highlight-foreground">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 17l5-5 4 3 7-8" />
          <path d="M15 7h5v5" />
        </svg>
      </span>
      {withWord && <span className="text-lg font-semibold tracking-tight">ExcelAIt</span>}
    </span>
  )
}
