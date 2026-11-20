import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CollegeEditor } from '@/components/partner/CollegeEditor'
import { OrgDetailsForm, OrgWizard, orgFormPayload, orgToForm, type OrgForm } from '@/components/partner/OrgWizard'
import { errMsg, useActiveOrg, type Org } from '@/components/partner/partnerApi'
import { ErrorNote, ListSkeleton, OrgSwitcher, VerifyBanner, VerifyChip } from '@/components/partner/shared'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

export function Organisation() {
  const { t } = useTranslation()
  const { org, orgs, isLoading, error, refetch, setOrgId } = useActiveOrg()

  if (isLoading)
    return (
      <>
        <PageHeader title={t('nav.organisation')} back />
        <ListSkeleton rows={3} />
      </>
    )
  if (error)
    return (
      <>
        <PageHeader title={t('nav.organisation')} back />
        <ErrorNote error={error} onRetry={() => void refetch()} />
      </>
    )
  if (!org)
    return (
      <>
        <PageHeader title={t('partner.org.setupTitle')} subtitle={t('partner.org.setupLead')} back />
        <OrgWizard />
      </>
    )

  return (
    <>
      <PageHeader
        title={org.name}
        subtitle={t(`partner.kind.${org.kind}`)}
        back
        actions={<VerifyChip status={org.verification_status} />}
      />
      <div className="flex flex-col gap-5">
        <OrgSwitcher orgs={orgs} value={org.id} onChange={setOrgId} />
        <VerifyBanner org={org} />
        {org.verification_status === 'pending' && (
          <div className="flex items-start gap-3 rounded-3xl border bg-card p-5">
            <ShieldCheck className="mt-0.5 size-6 shrink-0" />
            <div>
              <h2 className="font-semibold">{t('partner.pending.whyTitle')}</h2>
              <p className="mt-1 text-muted-foreground">{t('partner.pending.whyBody')}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{t('partner.pending.step1')}</li>
                <li>{t('partner.pending.step2')}</li>
                <li>{t('partner.pending.step3')}</li>
              </ul>
            </div>
          </div>
        )}
        <OrgProfile key={org.id} org={org} />
        {org.verification_status === 'verified' && org.aishe_code && <CollegeEditor org={org} />}
        {org.verification_status === 'verified' && org.kind === 'college' && !org.aishe_code && (
          <div className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground">
            <Building2 className="mb-2 size-5 text-foreground" />
            {t('partner.college.noListing')}
          </div>
        )}
      </div>
    </>
  )
}

function OrgProfile({ org }: { org: Org }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState<OrgForm>(() => orgToForm(org))
  useEffect(() => setForm(orgToForm(org)), [org])
  const save = useMutation({
    mutationFn: () => {
      const { name, about, website, contact_email, phone, state, district } = orgFormPayload(form)
      return api(`/api/v1/partner/orgs/${org.id}`, { method: 'PATCH', body: JSON.stringify({ name, about, website, contact_email, phone, state, district }) })
    },
    onSuccess: () => {
      toast.success(t('partner.org.saved'))
      void qc.invalidateQueries({ queryKey: ['partner', 'orgs'] })
    },
    onError: (e) => toast.error(errMsg(e, t('partner.errorGeneric'))),
  })
  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{t('partner.org.detailsTitle')}</h2>
        {org.aishe_code && <span className="text-sm text-muted-foreground">AISHE {org.aishe_code}</span>}
      </div>
      <div className="mt-4">
        <OrgDetailsForm form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} />
      </div>
      <div className="mt-5 flex justify-end">
        <Button size="lg" className="h-11 rounded-full px-6" disabled={save.isPending || form.name.trim().length < 2} onClick={() => save.mutate()}>
          {save.isPending ? t('partner.saving') : t('partner.save')}
        </Button>
      </div>
    </section>
  )
}
