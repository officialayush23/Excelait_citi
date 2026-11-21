import { ChevronDown, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CareerSource } from '@/engine/matching'
import { cn } from '@/lib/utils'

type Referenced = {
  sources?: CareerSource[]
  pay_evidence?: { min: number | null; max: number | null; n_sources: number } | null
  pay_status?: 'matches' | 'differs' | 'unverified' | null
  checked_on?: string | null
}

/**
 * Says where a pay figure comes from. "Pay from N sources · checked <date>" with the list of pages behind it,
 * or "estimate — not yet confirmed" when fewer than two sites gave numbers (or the catalogue has no references yet).
 */
export function PaySources({ c, className }: { c: Referenced; className?: string }) {
  const { t, i18n } = useTranslation()
  const n = c.pay_evidence?.n_sources ?? 0
  const confirmed = c.pay_status === 'matches' || c.pay_status === 'differs'
  const sources = c.sources ?? []
  const date = c.checked_on
    ? new Date(c.checked_on).toLocaleDateString(i18n.language === 'en' ? 'en-IN' : i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  return (
    <details className={cn('group text-sm', className)}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span>{confirmed && date ? t('explore.paySources', { count: n, date }) : t('explore.payUnverified')}</span>
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-1 flex flex-col gap-2 rounded-2xl border bg-card p-3 text-card-foreground">
        {!confirmed && <p className="text-muted-foreground">{t('explore.payUnverifiedBody')}</p>}
        {sources.length > 0 && <p className="font-medium">{t('explore.sourcesTitle')}</p>}
        <ul className="flex flex-col gap-2">
          {sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1.5 underline underline-offset-4">
                <span className="break-words">{s.title || s.site}</span>
                <ExternalLink className="mt-1 size-3.5 shrink-0" aria-hidden />
              </a>
              <p className="text-muted-foreground">{s.site} · {s.note}</p>
            </li>
          ))}
        </ul>
        {!sources.length && <p className="text-muted-foreground">{t('explore.noSources')}</p>}
      </div>
    </details>
  )
}
