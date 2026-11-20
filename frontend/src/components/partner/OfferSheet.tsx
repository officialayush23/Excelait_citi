import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { careerName, careers } from '@/data/catalogue'
import { LANGUAGES } from '@/i18n'
import { api } from '@/lib/api'
import { formatInr } from '@/lib/format'

import { CriteriaBuilder } from './CriteriaBuilder'
import { OFFER_KINDS, usePrograms, type Criteria, type Offer, type OfferKind } from './partnerApi'
import { ErrorNote, Field, MultiPick } from './shared'

type Form = {
  kind: OfferKind
  title: string
  description: string
  starts_at: string
  deadline: string
  free: boolean
  fee_inr: string
  stipend_monthly: string
  seats: string
  apply_url: string
  language: string
  is_remote: boolean
  location: string
  state: string
  district: string
  criteria: Criteria
  career_slugs: string[]
  program_slugs: string[]
}

const blank: Form = {
  kind: 'internship', title: '', description: '', starts_at: '', deadline: '', free: true, fee_inr: '', stipend_monthly: '', seats: '',
  apply_url: '', language: '', is_remote: false, location: '', state: '', district: '', criteria: {}, career_slugs: [], program_slugs: [],
}

const fromOffer = (o: Offer): Form => ({
  kind: o.kind, title: o.title, description: o.description ?? '', starts_at: o.starts_at ?? '', deadline: o.deadline ?? '',
  free: !o.fee_inr, fee_inr: o.fee_inr ? String(o.fee_inr) : '', stipend_monthly: o.stipend_monthly != null ? String(o.stipend_monthly) : '',
  seats: o.seats != null ? String(o.seats) : '', apply_url: o.apply_url ?? '', language: o.language ?? '', is_remote: o.is_remote,
  location: o.location ?? '', state: o.state ?? '', district: o.district ?? '', criteria: o.criteria ?? {},
  career_slugs: o.career_slugs ?? [], program_slugs: o.program_slugs ?? [],
})

const int = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Math.round(Number(s)))

function toPayload(f: Form) {
  const c = f.criteria
  return {
    kind: f.kind,
    title: f.title.trim(),
    description: f.description.trim() || null,
    location: f.is_remote ? null : f.location.trim() || null,
    is_remote: f.is_remote,
    stipend_monthly: int(f.stipend_monthly),
    fee_inr: f.free ? 0 : (int(f.fee_inr) ?? 0),
    seats: int(f.seats),
    deadline: f.deadline || null,
    starts_at: f.starts_at || null,
    apply_url: f.apply_url.trim() || null,
    state: f.state.trim() || null,
    district: f.district.trim() || null,
    career_slugs: f.career_slugs,
    program_slugs: f.program_slugs,
    language: f.language || null,
    criteria: {
      class_min: c.class_min ?? null, class_max: c.class_max ?? null, courses: c.courses ?? [], states: c.states ?? [],
      gender: c.gender ?? null, income_max: c.income_max ?? null, categories: c.categories ?? [], marks_min: c.marks_min ?? null,
      age_min: c.age_min ?? null, age_max: c.age_max ?? null,
    },
  }
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <span className="grid size-6 place-items-center rounded-full bg-highlight text-xs text-highlight-foreground">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  )
}

export function OfferSheet({ orgId, offer, open, onOpenChange }: { orgId: string; offer: Offer | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [f, setF] = useState<Form>(blank)
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))
  const programs = usePrograms()

  useEffect(() => {
    if (open) setF(offer ? fromOffer(offer) : blank)
  }, [open, offer])

  const careerOpts = useMemo(() => careers.map((c) => ({ value: c.slug, label: careerName(c, i18n.language) })), [i18n.language])
  const programOpts = useMemo(() => (programs.data ?? []).map((p) => ({ value: p.slug, label: p.name })), [programs.data])

  const feeNum = int(f.fee_inr)
  const problems: string[] = []
  if (f.title.trim().length < 3) problems.push(t('partner.form.needTitle'))
  if (!f.free && (feeNum == null || feeNum <= 0)) problems.push(t('partner.form.needFee'))

  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify(toPayload(f))
      return offer
        ? api<Offer>(`/api/v1/partner/orgs/${orgId}/offers/${offer.id}`, { method: 'PUT', body })
        : api<Offer>(`/api/v1/partner/orgs/${orgId}/offers`, { method: 'POST', body })
    },
    onSuccess: () => {
      toast.success(offer ? t('partner.form.updated') : t('partner.form.created'))
      void qc.invalidateQueries({ queryKey: ['partner', 'offers', orgId] })
      onOpenChange(false)
    },
  })

  const kindOpts = OFFER_KINDS.map((k) => ({ value: k, label: t(`partner.offerKind.${k}`) }))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-xl data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="text-xl">{offer ? t('partner.form.editTitle') : t('partner.form.newTitle')}</SheetTitle>
          <SheetDescription>{t('partner.form.lead')}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          <Section n={1} title={t('partner.form.basics')}>
            <Field label={t('partner.form.kind')}>
              <Select value={f.kind} onValueChange={(v) => set({ kind: v as OfferKind })}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kindOpts.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('partner.form.title')}>
              <Input value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} className="h-10" />
            </Field>
            <Field label={t('partner.form.description')}>
              <Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={5000} rows={4} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('partner.form.startsAt')}>
                <Input type="date" value={f.starts_at} onChange={(e) => set({ starts_at: e.target.value })} className="h-10" />
              </Field>
              <Field label={t('partner.form.deadline')}>
                <Input type="date" value={f.deadline} onChange={(e) => set({ deadline: e.target.value })} className="h-10" />
              </Field>
            </div>

            <div className="rounded-2xl border bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t('partner.form.free')}</p>
                  <p className="text-xs text-muted-foreground">{t('partner.form.freeHint')}</p>
                </div>
                <Switch checked={f.free} onCheckedChange={(v) => set({ free: v, fee_inr: v ? '' : f.fee_inr })} aria-label={t('partner.form.free')} />
              </div>
              {!f.free && (
                <div className="mt-3">
                  <Field label={t('partner.form.fee')} hint={t('partner.form.feeHint')}>
                    <Input type="number" inputMode="numeric" min={1} value={f.fee_inr} onChange={(e) => set({ fee_inr: e.target.value })} className="h-10" />
                  </Field>
                </div>
              )}
              <p className="mt-3 text-sm font-medium">
                {t('partner.form.studentsSee')}: {f.free ? t('partner.form.freeLabel') : feeNum && feeNum > 0 ? formatInr(feeNum) : '—'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('partner.form.stipend')}>
                <Input type="number" inputMode="numeric" min={0} value={f.stipend_monthly} onChange={(e) => set({ stipend_monthly: e.target.value })} className="h-10" />
              </Field>
              <Field label={t('partner.form.seats')}>
                <Input type="number" inputMode="numeric" min={1} value={f.seats} onChange={(e) => set({ seats: e.target.value })} className="h-10" />
              </Field>
            </div>
            <Field label={t('partner.form.applyUrl')} hint={t('partner.form.applyUrlHint')}>
              <Input type="url" value={f.apply_url} onChange={(e) => set({ apply_url: e.target.value })} placeholder="https://" className="h-10" />
            </Field>
            <Field label={t('partner.form.language')}>
              <Select value={f.language || '__any'} onValueChange={(v) => set({ language: v === '__any' ? '' : v })}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any">{t('partner.crit.any')}</SelectItem>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section n={2} title={t('partner.form.where')}>
            <div className="flex items-center justify-between gap-3 rounded-2xl border bg-surface px-4 py-3">
              <span className="text-sm font-medium">{t('partner.form.remote')}</span>
              <Switch checked={f.is_remote} onCheckedChange={(v) => set({ is_remote: v })} aria-label={t('partner.form.remote')} />
            </div>
            {!f.is_remote && (
              <Field label={t('partner.form.location')}>
                <Input value={f.location} onChange={(e) => set({ location: e.target.value })} className="h-10" />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('partner.org.state')}>
                <Input value={f.state} onChange={(e) => set({ state: e.target.value })} className="h-10" />
              </Field>
              <Field label={t('partner.org.district')}>
                <Input value={f.district} onChange={(e) => set({ district: e.target.value })} className="h-10" />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{t('partner.form.stateNote')}</p>
          </Section>

          <Section n={3} title={t('partner.form.who')}>
            <CriteriaBuilder value={f.criteria} onChange={(criteria) => set({ criteria })} />
          </Section>

          <Section n={4} title={t('partner.form.linked')}>
            <p className="-mt-2 text-sm text-muted-foreground">{t('partner.form.linkedBody')}</p>
            <Field label={t('partner.form.careers')}>
              <MultiPick options={careerOpts} value={f.career_slugs} onChange={(v) => set({ career_slugs: v })} placeholder={t('partner.form.searchCareers')} emptyText={t('partner.form.noMatch')} />
            </Field>
            <Field label={t('partner.form.programs')}>
              <MultiPick options={programOpts} value={f.program_slugs} onChange={(v) => set({ program_slugs: v })} placeholder={t('partner.form.searchPrograms')} emptyText={t('partner.form.noMatch')} />
            </Field>
          </Section>

          {save.error && <ErrorNote error={save.error} />}
        </div>

        <SheetFooter className="border-t">
          {problems.length > 0 && <p className="text-sm text-destructive">{problems.join(' · ')}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
              {t('partner.cancel')}
            </Button>
            <Button className="h-10 rounded-full px-6" disabled={problems.length > 0 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? t('partner.saving') : offer ? t('partner.form.saveChanges') : t('partner.form.saveDraft')}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
