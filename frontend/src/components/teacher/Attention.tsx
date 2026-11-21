import { ArrowRight, BellRing } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { riskText } from './shared'
import { useNudge, type Dashboard } from './teacherApi'

/** Students who need a nudge, each with the reason(s) and one-tap actions. */
export function AttentionList({ items, limit }: { items: Dashboard['attention']; limit?: number }) {
  const { t } = useTranslation()
  const nudge = useNudge()
  const shown = limit ? items.slice(0, limit) : items
  if (!items.length) return <p className="rounded-2xl border bg-card p-5 text-muted-foreground">{t('teacher.allGood')}</p>
  return (
    <ul className="flex flex-col gap-3">
      {shown.map((a) => (
        <li key={a.student_id} className="rounded-2xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold">{a.name}</p>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link to={`/app/students/${a.student_id}`}>
                  {t('teacher.open')}
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {a.risks.map((r) => (
              <li key={r.code} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{riskText(t, r)}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    disabled={nudge.isPending}
                    onClick={() =>
                      nudge.mutate(
                        { studentId: a.student_id, code: r.code },
                        { onSuccess: () => toast.success(t('teacher.nudgeSent', { name: a.name })), onError: () => toast.error(t('teacher.error')) },
                      )
                    }
                  >
                    <BellRing data-icon="inline-start" />
                    {t('teacher.nudge')}
                  </Button>
              </li>
            ))}
          </ul>
        </li>
      ))}
      {limit && items.length > limit && (
        <li>
          <Button asChild variant="ghost" className="rounded-full">
            <Link to="/app/students">{t('teacher.seeAll', { count: items.length })}</Link>
          </Button>
        </li>
      )}
    </ul>
  )
}
