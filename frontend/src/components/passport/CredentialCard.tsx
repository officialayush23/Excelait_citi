import { BadgeCheck, Copy, Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { formatDate } from '@/components/community/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

import { QrCode } from './QrCode'
import { type Credential, loc, verifyUrl } from './shared'

export function CredentialCard({ credential: c }: { credential: Credential }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const s = c.payload.credentialSubject
  const url = verifyUrl(c.public_id)
  const revoked = !!c.revoked_at

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: s.skill, url })
      else {
        await navigator.clipboard.writeText(url)
        toast.success(t('passport.credential.copied'))
      }
    } catch {
      /* user closed the share sheet */
    }
  }

  return (
    <article className={cn('flex flex-col gap-4 rounded-3xl border bg-card p-4 sm:p-5', revoked && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{s.level}</p>
          <h3 className="text-xl font-semibold leading-snug">{loc(s.skill, c.skill_name_i18n, lang)}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{s.task}</p>
        </div>
        <span className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold', revoked ? 'bg-destructive/15 text-destructive' : 'bg-highlight text-highlight-foreground')}>
          <BadgeCheck className="size-4" />
          {revoked ? t('passport.credential.revoked') : t('passport.credential.verified')}
        </span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <dl className="min-w-0 space-y-1 text-sm">
          <dd>{t('passport.credential.issued', { date: formatDate(c.issued_at, lang) })}</dd>
          <dd className="text-muted-foreground">{t('passport.credential.reviewedBy', { name: s.reviewer })}</dd>
          {s.school && <dd className="text-muted-foreground">{t('passport.credential.school', { name: s.school })}</dd>}
        </dl>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <QrCode value={url} label={t('passport.credential.scan')} size={96} />
          <span className="text-xs text-muted-foreground">{t('passport.credential.scan')}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-11 rounded-full px-4" onClick={() => void share()}>
          <Share2 className="size-4" />
          {t('passport.credential.share')}
        </Button>
        <Button
          variant="outline"
          className="h-11 rounded-full px-4"
          onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success(t('passport.credential.copied')))}
        >
          <Copy className="size-4" />
          {t('passport.credential.copyLink')}
        </Button>
      </div>
    </article>
  )
}
