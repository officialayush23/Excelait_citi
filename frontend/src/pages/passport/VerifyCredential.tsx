import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, Loader2, ShieldAlert, ShieldX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { formatDate } from '@/components/community/shared'
import { QrCode } from '@/components/passport/QrCode'
import { verifyUrl } from '@/components/passport/shared'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type Result = {
  status: 'valid' | 'revoked' | 'invalid'
  issued_at: string
  revoked_at: string | null
  signature: string
  payload: { credentialSubject: { name: string; skill: string; level: string; task: string; evidenceCount: number; reviewer: string; school: string } }
}

/** Public page: no sign-in. Anyone (a partner, a parent) can scan the QR and check a credential. */
export function VerifyCredential() {
  const { t, i18n } = useTranslation()
  const { publicId = '' } = useParams()
  const q = useQuery({
    queryKey: ['verify', publicId],
    queryFn: () => api<Result>(`/api/v1/public/credentials/${encodeURIComponent(publicId)}`),
    retry: false,
  })
  const key = useQuery({ queryKey: ['verify-key'], queryFn: () => api<{ publicKey: string }>('/api/v1/public/credentials/key'), retry: false })

  const status = q.isPending ? 'loading' : q.isError ? 'invalid' : q.data.status
  const s = q.data?.payload.credentialSubject
  const banner =
    status === 'valid'
      ? { Icon: BadgeCheck, tone: 'bg-highlight text-highlight-foreground', title: t('passport.verify.valid'), body: t('passport.verify.validBody') }
      : status === 'revoked'
        ? { Icon: ShieldAlert, tone: 'bg-tile-peach text-tile-foreground', title: t('passport.verify.revoked'), body: t('passport.verify.revokedBody') }
        : { Icon: ShieldX, tone: 'bg-tile-rose text-tile-foreground', title: t('passport.verify.invalid'), body: t('passport.verify.invalidBody') }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 bg-background px-4 py-8 text-foreground">
      <p className="text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground">ExcelAIt · {t('passport.verify.title')}</p>

      {status === 'loading' ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          {t('passport.verify.checking')}
        </div>
      ) : (
        <>
          <div role="status" className={cn('flex items-start gap-3 rounded-3xl p-5', banner.tone)}>
            <banner.Icon className="mt-0.5 size-8 shrink-0" />
            <div>
              <h1 className="text-2xl font-semibold">{banner.title}</h1>
              <p className="text-sm opacity-90">{banner.body}</p>
            </div>
          </div>

          {s && (
            <article className={cn('rounded-3xl border-2 bg-card p-6 text-center sm:p-8', status === 'revoked' && 'opacity-60')}>
              <p className="text-sm text-muted-foreground">{t('passport.verify.certifies')}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight">{s.name}</p>
              <p className="mt-3 text-sm text-muted-foreground">{t('passport.verify.hasProved')}</p>
              <p className="mt-1 text-2xl font-semibold">{s.skill}</p>
              <p className="text-sm text-muted-foreground">{s.level}</p>

              <dl className="mt-6 grid gap-3 border-t pt-5 text-left text-sm sm:grid-cols-2">
                <Item label={t('passport.verify.task')} value={s.task} />
                <Item label={t('passport.verify.evidence')} value={String(s.evidenceCount)} />
                <Item label={t('passport.verify.reviewer')} value={s.reviewer} />
                {s.school && <Item label={t('passport.verify.school')} value={s.school} />}
                <Item label={t('passport.verify.issuedOn')} value={formatDate(q.data!.issued_at, i18n.language)} />
                <Item label={t('passport.verify.credentialId')} value={publicId} mono />
              </dl>
              <div className="mt-6 flex justify-center">
                <QrCode value={verifyUrl(publicId)} size={112} label={t('passport.credential.scan')} />
              </div>
            </article>
          )}
        </>
      )}

      <section className="rounded-3xl bg-surface p-5">
        <h2 className="mb-2 text-lg font-semibold">{t('passport.verify.howTitle')}</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>{t('passport.verify.how1')}</li>
          <li>{t('passport.verify.how2')}</li>
          <li>{t('passport.verify.how3')}</li>
        </ol>
        {key.data && (
          <p className="mt-3 break-all text-xs text-muted-foreground">
            {t('passport.verify.publicKey')}: <span className="font-mono">{key.data.publicKey}</span>
          </p>
        )}
      </section>
      <Link to="/" className="text-center text-sm font-medium underline underline-offset-4">{t('passport.verify.goHome')}</Link>
    </main>
  )
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('break-words font-medium', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  )
}
