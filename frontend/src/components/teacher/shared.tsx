import { CircleAlert } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { ClaimStatus, Risk } from './teacherApi'

/** Plain-language reason for a risk flag, with the numbers that triggered it. */
export function riskText(t: TFunction, r: Risk): string {
  const d = r.detail as Record<string, unknown>
  const schemes = Array.isArray(d.schemes) ? (d.schemes as string[]).join(', ') : ''
  return t(`teacher.risk.${r.code}`, { days: d.days, count: d.count, schemes, step: d.step, level: d.class_level })
}

export function RiskChips({ risks, className }: { risks: Risk[]; className?: string }) {
  const { t } = useTranslation()
  if (!risks.length) return null
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {risks.map((r) => (
        <Badge key={r.code} variant="destructive" className="h-auto whitespace-normal py-0.5">
          <CircleAlert />
          {t(`teacher.riskShort.${r.code}`)}
        </Badge>
      ))}
    </div>
  )
}

export function ClaimBadge({ status }: { status: ClaimStatus | null }) {
  const { t } = useTranslation()
  if (!status) return <span className="text-muted-foreground">{t('teacher.claim.none')}</span>
  const tone =
    status === 'money_received' ? 'bg-highlight text-highlight-foreground' : status === 'rejected' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground'
  return <Badge className={cn('border-transparent', tone)}>{t(`teacher.claim.${status}`)}</Badge>
}

export function formatActive(t: TFunction, days: number | null) {
  if (days === null) return t('teacher.neverActive')
  if (days === 0) return t('teacher.today')
  return t('teacher.daysAgo', { count: days })
}

export function Bar({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-current/15', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-current transition-all" style={{ width: `${v}%` }} />
    </div>
  )
}

export function ClassPicker({
  classes,
  value,
  onChange,
}: {
  classes: { id: string; name: string; student_count: number }[]
  value: string | undefined
  onChange: (id: string) => void
}) {
  if (classes.length < 2) return null
  return (
    <div className="mb-4 flex flex-wrap gap-2" role="tablist">
      {classes.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={c.id === value}
          onClick={() => onChange(c.id)}
          className={cn(
            'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
            c.id === value ? 'border-transparent bg-highlight text-highlight-foreground' : 'bg-card text-foreground/80 hover:text-foreground',
          )}
        >
          {c.name} <span className="opacity-60">· {c.student_count}</span>
        </button>
      ))}
    </div>
  )
}
