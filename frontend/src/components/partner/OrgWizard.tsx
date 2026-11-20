import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, BadgeCheck, Building2, Landmark, Search, ShieldCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

import { ORG_KINDS, type Org, type OrgKind } from './partnerApi'
import { ErrorNote, Field, ListSkeleton } from './shared'

type College = { aishe_code: string; name: string; state: string | null; district: string | null; org_id: string | null; college_type?: string | null; management?: string | null }

export type OrgForm = {
  name: string; kind: OrgKind; about: string; website: string; contact_email: string; phone: string; state: string; district: string; aishe_code: string
}
const EMPTY: OrgForm = { name: '', kind: 'college', about: '', website: '', contact_email: '', phone: '', state: '', district: '', aishe_code: '' }

const clean = (f: OrgForm) => ({
  name: f.name.trim(),
  kind: f.kind,
  about: f.about.trim() || null,
  website: f.website.trim() || null,
  contact_email: f.contact_email.trim() || null,
  phone: f.phone.trim() || null,
  state: f.state.trim() || null,
  district: f.district.trim() || null,
  aishe_code: f.aishe_code || null,
})

/** The form for organisation details; used for onboarding and for editing later. */
export function OrgDetailsForm({ form, set }: { form: OrgForm; set: (patch: Partial<OrgForm>) => void }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('partner.org.name')} className="sm:col-span-2">
        <Input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} className="h-10" />
      </Field>
      <Field label={t('partner.org.about')} hint={t('partner.org.aboutHint')} className="sm:col-span-2">
        <Textarea value={form.about} onChange={(e) => set({ about: e.target.value })} maxLength={2000} rows={3} />
      </Field>
      <Field label={t('partner.org.state')}>
        <Input value={form.state} onChange={(e) => set({ state: e.target.value })} className="h-10" />
      </Field>
      <Field label={t('partner.org.district')}>
        <Input value={form.district} onChange={(e) => set({ district: e.target.value })} className="h-10" />
      </Field>
      <Field label={t('partner.org.email')}>
        <Input type="email" value={form.contact_email} onChange={(e) => set({ contact_email: e.target.value })} className="h-10" />
      </Field>
      <Field label={t('partner.org.phone')}>
        <Input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} className="h-10" />
      </Field>
      <Field label={t('partner.org.website')} className="sm:col-span-2">
        <Input type="url" value={form.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" className="h-10" />
      </Field>
    </div>
  )
}

export function orgToForm(o: Org): OrgForm {
  return {
    name: o.name, kind: o.kind, about: o.about ?? '', website: o.website ?? '', contact_email: o.contact_email ?? '',
    phone: o.phone ?? '', state: o.state ?? '', district: o.district ?? '', aishe_code: o.aishe_code ?? '',
  }
}
export { clean as orgFormPayload }

const KIND_ICON: Partial<Record<OrgKind, typeof Building2>> = { college: Landmark, iti: Landmark, school: Landmark }

type Step = 'type' | 'listing' | 'details'

export function OrgWizard() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('type')
  const [form, setForm] = useState<OrgForm>(EMPTY)
  const set = (patch: Partial<OrgForm>) => setForm((f) => ({ ...f, ...patch }))
  const hasDirectory = form.kind === 'college' || form.kind === 'iti'

  const create = useMutation({
    mutationFn: () => api<Org>('/api/v1/partner/orgs', { method: 'POST', body: JSON.stringify(clean(form)) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner', 'orgs'] }),
  })

  const steps: Step[] = hasDirectory ? ['type', 'listing', 'details'] : ['type', 'details']
  const idx = steps.indexOf(step)
  const canSubmit = form.name.trim().length >= 2

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2" aria-label={t('partner.wizard.progress', { n: idx + 1, total: steps.length })}>
        {steps.map((s, i) => (
          <span key={s} className={cn('h-1.5 flex-1 rounded-full transition-colors', i <= idx ? 'bg-highlight' : 'bg-muted')} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.section
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="rounded-3xl border bg-card p-5 sm:p-7"
        >
          {step === 'type' && (
            <>
              <h2 className="text-2xl font-semibold tracking-tight">{t('partner.wizard.typeTitle')}</h2>
              <p className="mt-1 text-muted-foreground">{t('partner.wizard.typeBody')}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ORG_KINDS.map((k) => {
                  const Icon = KIND_ICON[k] ?? Building2
                  const on = form.kind === k
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ kind: k, aishe_code: '' })}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors',
                        on ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-surface hover:bg-accent',
                      )}
                    >
                      <Icon className="size-5 shrink-0" />
                      <span className="font-medium">{t(`partner.kind.${k}`)}</span>
                    </button>
                  )
                })}
              </div>
              <div className="mt-6 flex justify-end">
                <Button size="lg" className="h-11 rounded-full px-6" onClick={() => setStep(hasDirectory ? 'listing' : 'details')}>
                  {t('common.continue')}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </div>
            </>
          )}

          {step === 'listing' && (
            <ListingStep
              kind={form.kind}
              claimed={form.aishe_code}
              onClaim={(c) => {
                set({ aishe_code: c.aishe_code, name: c.name, state: c.state ?? '', district: c.district ?? '' })
                setStep('details')
              }}
              onNew={() => {
                set({ aishe_code: '' })
                setStep('details')
              }}
              onBack={() => setStep('type')}
            />
          )}

          {step === 'details' && (
            <>
              <h2 className="text-2xl font-semibold tracking-tight">{t('partner.wizard.detailsTitle')}</h2>
              {form.aishe_code ? (
                <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-tile-mint px-3 py-1 text-sm text-tile-foreground">
                  <BadgeCheck className="size-4" />
                  {t('partner.wizard.claiming', { code: form.aishe_code })}
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">{t('partner.wizard.detailsBody')}</p>
              )}
              <div className="mt-5">
                <OrgDetailsForm form={form} set={set} />
              </div>
              <div className="mt-5 flex items-start gap-3 rounded-2xl bg-surface p-4 text-sm">
                <ShieldCheck className="mt-0.5 size-5 shrink-0" />
                <p>{t('partner.wizard.verifyNote')}</p>
              </div>
              {create.error && (
                <div className="mt-4">
                  <ErrorNote error={create.error} />
                </div>
              )}
              <div className="mt-6 flex items-center justify-between gap-3">
                <Button variant="ghost" className="rounded-full" onClick={() => setStep(hasDirectory ? 'listing' : 'type')}>
                  <ArrowLeft data-icon="inline-start" />
                  {t('common.back')}
                </Button>
                <Button size="lg" className="h-11 rounded-full px-6" disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
                  {create.isPending ? t('partner.wizard.submitting') : t('partner.wizard.submit')}
                </Button>
              </div>
            </>
          )}
        </motion.section>
      </AnimatePresence>
    </div>
  )
}

function ListingStep({
  kind, claimed, onClaim, onNew, onBack,
}: { kind: OrgKind; claimed: string; onClaim: (c: College) => void; onNew: () => void; onBack: () => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(id)
  }, [q])

  const res = useQuery({
    queryKey: ['explore', 'colleges', 'claim', kind, debounced],
    enabled: debounced.length >= 3,
    queryFn: () =>
      api<{ colleges: College[]; directory_size: number }>(`/api/v1/explore/colleges?q=${encodeURIComponent(debounced)}&kind=${kind}&limit=10`),
  })

  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight">{t('partner.wizard.listingTitle')}</h2>
      <p className="mt-1 text-muted-foreground">{t('partner.wizard.listingBody')}</p>
      <div className="relative mt-5">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('partner.wizard.searchPlaceholder')}
          className="h-11 rounded-full pl-10"
          aria-label={t('partner.wizard.searchPlaceholder')}
        />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {debounced.length > 0 && debounced.length < 3 && <p className="text-sm text-muted-foreground">{t('partner.wizard.typeMore')}</p>}
        {res.isFetching && <ListSkeleton rows={3} />}
        {res.error && <ErrorNote error={res.error} onRetry={() => void res.refetch()} />}
        {!res.isFetching && res.data && res.data.colleges.length === 0 && <p className="text-sm text-muted-foreground">{t('partner.wizard.noMatch')}</p>}
        {!res.isFetching &&
          res.data?.colleges.map((c) => (
            <div key={c.aishe_code} className={cn('flex flex-wrap items-center gap-3 rounded-2xl border bg-surface p-3.5', claimed === c.aishe_code && 'ring-2 ring-ring')}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted-foreground">
                  {[c.district, c.state].filter(Boolean).join(', ')} · {c.aishe_code}
                </p>
              </div>
              {c.org_id ? (
                <span className="text-sm text-muted-foreground">{t('partner.wizard.alreadyClaimed')}</span>
              ) : (
                <Button className="rounded-full" onClick={() => onClaim(c)}>
                  {t('partner.wizard.claim')}
                </Button>
              )}
            </div>
          ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" className="rounded-full" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          {t('common.back')}
        </Button>
        <Button variant="outline" className="rounded-full" onClick={onNew}>
          {t('partner.wizard.notListed')}
        </Button>
      </div>
    </>
  )
}
