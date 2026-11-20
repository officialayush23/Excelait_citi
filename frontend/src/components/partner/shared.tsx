import { CircleAlert, CircleCheck, Hourglass, Search, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { Org, Verification } from './partnerApi'

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation()
  if (!error) return null
  const msg = error instanceof Error && error.message ? error.message : t('partner.errorGeneric')
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <CircleAlert className="mt-0.5 size-5 shrink-0" />
      <p className="flex-1">{msg}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} className="rounded-full">
          {t('partner.retry')}
        </Button>
      )}
    </div>
  )
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  )
}

const VERIFY_STYLE: Record<Verification, string> = {
  verified: 'bg-tile-mint text-tile-foreground',
  pending: 'bg-tile-peach text-tile-foreground',
  rejected: 'bg-tile-rose text-tile-foreground',
}

export function Chip({ tone, children, className }: { tone?: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium', tone ?? 'bg-muted text-foreground', className)}>
      {children}
    </span>
  )
}

export function VerifyChip({ status }: { status: Verification }) {
  const { t } = useTranslation()
  return <Chip tone={VERIFY_STYLE[status]}>{t(`partner.verify.${status}`)}</Chip>
}

const OFFER_STYLE = { open: 'bg-tile-mint text-tile-foreground', draft: 'bg-muted text-foreground', closed: 'bg-tile-lilac text-tile-foreground' } as const
export function OfferChip({ status }: { status: 'draft' | 'open' | 'closed' }) {
  const { t } = useTranslation()
  return <Chip tone={OFFER_STYLE[status]}>{t(`partner.status.${status}`)}</Chip>
}

/** Verified / pending / rejected banner with the reason when rejected. */
export function VerifyBanner({ org }: { org: Org }) {
  const { t } = useTranslation()
  const s = org.verification_status
  const Icon = s === 'verified' ? CircleCheck : s === 'pending' ? Hourglass : CircleAlert
  return (
    <div className={cn('flex items-start gap-3 rounded-2xl p-4 text-tile-foreground', VERIFY_STYLE[s])} role="status">
      <Icon className="mt-0.5 size-6 shrink-0" />
      <div>
        <p className="font-semibold">{t(`partner.banner.${s}Title`)}</p>
        <p className="text-sm">{t(`partner.banner.${s}Body`)}</p>
        {s === 'rejected' && org.rejection_reason && (
          <p className="mt-2 rounded-xl bg-background/60 px-3 py-2 text-sm">
            <span className="font-medium">{t('partner.banner.reason')}: </span>
            {org.rejection_reason}
          </p>
        )}
      </div>
    </div>
  )
}

/** Shown when a partner has several organisations. */
export function OrgSwitcher({ orgs, value, onChange }: { orgs: Org[]; value: string; onChange: (id: string) => void }) {
  if (orgs.length < 2) return null
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-full max-w-xs rounded-full bg-card">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {orgs.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export type PickOption = { value: string; label: string }

/** Searchable multi-select shown as removable chips. */
export function MultiPick({
  options, value, onChange, placeholder, emptyText,
}: { options: PickOption[]; value: string[]; onChange: (v: string[]) => void; placeholder: string; emptyText: string }) {
  const [q, setQ] = useState('')
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options])
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    return options.filter((o) => !value.includes(o.value) && (!s || o.label.toLowerCase().includes(s))).slice(0, 8)
  }, [options, value, q])
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(value.filter((x) => x !== v))}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-nav-active px-2.5 text-xs font-medium text-nav-active-foreground"
            >
              {byValue.get(v) ?? v}
              <X className="size-3" aria-hidden="true" />
              <span className="sr-only">remove</span>
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-10 rounded-full pl-9" />
      </div>
      {q.trim() && (
        <div className="flex flex-wrap gap-1.5">
          {matches.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
          {matches.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange([...value, o.value])
                setQ('')
              }}
              className="inline-flex h-8 items-center rounded-full border bg-card px-3 text-sm hover:bg-accent"
            >
              + {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Toggle chips for a small fixed set of options. */
export function ChipToggle({ options, value, onChange }: { options: PickOption[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            className={cn(
              'inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors',
              on ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card hover:bg-accent',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
