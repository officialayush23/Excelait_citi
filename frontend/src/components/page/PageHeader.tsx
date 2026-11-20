import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { SpeakButton } from '@/components/shell/SpeakButton'

type Props = {
  title: string
  subtitle?: string
  back?: boolean
  actions?: ReactNode
}

/** Back arrow, large title, actions on the right (dark reference: "← Invoices"). */
export function PageHeader({ title, subtitle, back, actions }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {back && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('common.back')}
            className="mt-1 grid size-10 shrink-0 place-items-center rounded-full border bg-card text-foreground/80 hover:text-foreground"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <SpeakButton text={subtitle ? `${title}. ${subtitle}` : title} />
          </div>
          {subtitle && <p className="mt-1.5 max-w-2xl text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
