import type { ReactNode } from 'react'

import { SpeakButton } from '@/components/shell/SpeakButton'
import { cn } from '@/lib/utils'

type Props = {
  icon: ReactNode
  title: string
  body: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, body, action, className }: Props) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
      <span className="grid size-16 place-items-center rounded-full bg-highlight text-highlight-foreground [&_svg]:size-7">{icon}</span>
      <div className="flex items-center gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <SpeakButton text={`${title}. ${body}`} />
      </div>
      <p className="max-w-md text-muted-foreground">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
