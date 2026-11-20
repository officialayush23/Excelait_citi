import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'

import { errMsg, type Org } from './partnerApi'
import { ErrorNote, Field, ListSkeleton } from './shared'

type Details = { courses?: string[]; fees?: string; seats?: string | number; hostel?: boolean; contact?: string; admission_info?: string }

/** Listing details shown to students on the college page; verified owners only. */
export function CollegeEditor({ org }: { org: Org }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const code = org.aishe_code as string
  const current = useQuery({
    queryKey: ['explore', 'college', code],
    queryFn: () => api<{ details?: Details | null }>(`/api/v1/explore/colleges/${code}`),
  })
  const [courses, setCourses] = useState('')
  const [fees, setFees] = useState('')
  const [seats, setSeats] = useState('')
  const [hostel, setHostel] = useState(false)
  const [contact, setContact] = useState('')
  const [admission, setAdmission] = useState('')

  useEffect(() => {
    const d = current.data?.details
    if (!d) return
    setCourses((d.courses ?? []).join('\n'))
    setFees(d.fees ?? '')
    setSeats(d.seats != null ? String(d.seats) : '')
    setHostel(!!d.hostel)
    setContact(d.contact ?? '')
    setAdmission(d.admission_info ?? '')
  }, [current.data])

  const save = useMutation({
    mutationFn: () =>
      api(`/api/v1/partner/orgs/${org.id}/college`, {
        method: 'PUT',
        body: JSON.stringify({
          courses: courses.split('\n').map((s) => s.trim()).filter(Boolean),
          fees: fees.trim(),
          seats: seats.trim(),
          hostel,
          contact: contact.trim(),
          admission_info: admission.trim(),
        }),
      }),
    onSuccess: () => {
      toast.success(t('partner.college.saved'))
      void qc.invalidateQueries({ queryKey: ['explore', 'college', code] })
    },
    onError: (e) => toast.error(errMsg(e, t('partner.errorGeneric'))),
  })

  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">{t('partner.college.title')}</h2>
      <p className="mt-1 text-muted-foreground">{t('partner.college.body')}</p>
      {current.isLoading ? (
        <div className="mt-5">
          <ListSkeleton rows={3} />
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {current.error && (
            <div className="sm:col-span-2">
              <ErrorNote error={current.error} />
            </div>
          )}
          <Field label={t('partner.college.courses')} hint={t('partner.college.coursesHint')} className="sm:col-span-2">
            <Textarea value={courses} onChange={(e) => setCourses(e.target.value)} rows={4} />
          </Field>
          <Field label={t('partner.college.fees')} hint={t('partner.college.feesHint')}>
            <Input value={fees} onChange={(e) => setFees(e.target.value)} className="h-10" />
          </Field>
          <Field label={t('partner.college.seats')}>
            <Input value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" className="h-10" />
          </Field>
          <Field label={t('partner.college.contact')}>
            <Input value={contact} onChange={(e) => setContact(e.target.value)} className="h-10" />
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-2xl border bg-surface px-4 py-3">
            <span className="text-sm font-medium">{t('partner.college.hostel')}</span>
            <Switch checked={hostel} onCheckedChange={setHostel} aria-label={t('partner.college.hostel')} />
          </div>
          <Field label={t('partner.college.admission')} className="sm:col-span-2">
            <Textarea value={admission} onChange={(e) => setAdmission(e.target.value)} rows={3} />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button size="lg" className="h-11 rounded-full px-6" disabled={save.isPending} onClick={() => save.mutate()}>
              <Check data-icon="inline-start" />
              {save.isPending ? t('partner.saving') : t('partner.save')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
