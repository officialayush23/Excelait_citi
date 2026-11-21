import { Check } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatInr } from '@/lib/format'
import { cn } from '@/lib/utils'

import { ClaimBadge } from './shared'
import { CLAIM_STEPS, useSetClaim, type ClaimStatus, type SchemeRow } from './teacherApi'

/** One scheme the student is eligible for, with the claim steps the teacher can move it through. */
export function SchemeClaimRow({ studentId, scheme }: { studentId: string; scheme: SchemeRow }) {
  const { t } = useTranslation()
  const set = useSetClaim(studentId)
  const current = scheme.claim?.status ?? null
  const [asking, setAsking] = useState(false)
  const [amount, setAmount] = useState(String(scheme.claim?.amount_received ?? scheme.claim?.amount_expected ?? scheme.benefit_amount ?? ''))
  const idx = current ? CLAIM_STEPS.indexOf(current === 'approved' ? 'submitted' : current) : -1

  const go = (status: ClaimStatus, amount_received?: number) =>
    set.mutate(
      { scheme_slug: scheme.slug, status, amount_received },
      {
        onSuccess: () => {
          setAsking(false)
          toast.success(t('teacher.claim.saved'))
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('teacher.error')),
      },
    )

  return (
    <li className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{scheme.name}</p>
          <p className="text-sm text-muted-foreground">
            {scheme.benefit_amount ? t('teacher.worth', { amount: formatInr(scheme.benefit_amount) }) : t('teacher.noAmount')}
            {scheme.claim?.amount_received != null && ` · ${t('teacher.received', { amount: formatInr(scheme.claim.amount_received) })}`}
          </p>
        </div>
        <ClaimBadge status={current} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {CLAIM_STEPS.map((s, i) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={i === idx ? 'default' : 'outline'}
            className={cn('rounded-full', i < idx && 'opacity-70')}
            disabled={set.isPending || i === idx || current === 'rejected'}
            onClick={() => (s === 'money_received' ? setAsking(true) : go(s))}
          >
            {i < idx && <Check data-icon="inline-start" />}
            {t(`teacher.claim.${s}`)}
          </Button>
        ))}
        {current !== 'rejected' && current !== 'money_received' && current && (
          <Button type="button" size="sm" variant="ghost" className="rounded-full text-destructive" disabled={set.isPending} onClick={() => go('rejected')}>
            {t('teacher.claim.rejected')}
          </Button>
        )}
      </div>
      {asking && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            go('money_received', Number(amount))
          }}
        >
          <span className="text-sm">₹</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={t('teacher.amountReceived')}
            className="h-10 w-40 rounded-full"
            autoFocus
          />
          <Button type="submit" size="sm" className="rounded-full" disabled={amount === '' || Number(amount) < 0 || set.isPending}>
            {t('teacher.confirmReceived')}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => setAsking(false)}>
            {t('teacher.cancel')}
          </Button>
        </form>
      )}
    </li>
  )
}
