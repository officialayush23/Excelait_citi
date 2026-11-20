import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '@/lib/api'

export type OrgKind = 'college' | 'iti' | 'ngo' | 'company' | 'msme' | 'csr' | 'government' | 'training_centre' | 'school'
export const ORG_KINDS: OrgKind[] = ['college', 'iti', 'training_centre', 'school', 'ngo', 'company', 'msme', 'csr', 'government']

export type Verification = 'pending' | 'verified' | 'rejected'

export type Org = {
  id: string
  name: string
  kind: OrgKind
  about: string | null
  website: string | null
  contact_email: string | null
  phone: string | null
  state: string | null
  district: string | null
  aishe_code: string | null
  verification_status: Verification
  rejection_reason: string | null
  my_role?: string
  created_at?: string
}

export type OfferKind =
  | 'internship' | 'apprenticeship' | 'workshop' | 'bootcamp' | 'admission' | 'job'
  | 'mentorship' | 'course' | 'training' | 'scholarship' | 'resource' | 'event'
export const OFFER_KINDS: OfferKind[] = [
  'internship', 'apprenticeship', 'job', 'training', 'course', 'workshop', 'bootcamp',
  'admission', 'scholarship', 'mentorship', 'event', 'resource',
]

export type Criteria = {
  class_min?: number | null
  class_max?: number | null
  courses?: string[]
  states?: string[]
  gender?: 'female' | 'male' | null
  income_max?: number | null
  categories?: string[]
  marks_min?: number | null
  age_min?: number | null
  age_max?: number | null
}

export type Offer = {
  id: string
  org_id: string
  kind: OfferKind
  title: string
  description: string | null
  location: string | null
  is_remote: boolean
  stipend_monthly: number | null
  fee_inr: number
  seats: number | null
  deadline: string | null
  starts_at: string | null
  apply_url: string | null
  status: 'draft' | 'open' | 'closed'
  state: string | null
  district: string | null
  career_slugs: string[]
  program_slugs: string[]
  language: string | null
  criteria: Criteria
  applicants: number
  notified_count: number
  published_at: string | null
}

export type Applicant = {
  id: string
  status: ApplicationStatus
  note: string | null
  created_at: string
  profiles: { full_name: string | null } | null
}

export const APPLICATION_STATUSES = ['applied', 'shortlisted', 'interview', 'offered', 'joined', 'rejected'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

/** The backend puts a readable message in `detail`; api() already surfaces it as Error.message. */
export function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

export function useOrgs() {
  return useQuery({ queryKey: ['partner', 'orgs'], queryFn: () => api<{ orgs: Org[] }>('/api/v1/partner/orgs').then((r) => r.orgs) })
}

/** The organisation a partner is currently working in (most people have exactly one). */
export function useActiveOrg() {
  const q = useOrgs()
  const [id, setId] = useState<string | null>(null)
  const orgs = q.data ?? []
  const org = orgs.find((o) => o.id === id) ?? orgs[0] ?? null
  return { ...q, orgs, org, setOrgId: setId }
}

export function useOffers(orgId: string | undefined) {
  return useQuery({
    queryKey: ['partner', 'offers', orgId],
    enabled: !!orgId,
    queryFn: () => api<{ offers: Offer[] }>(`/api/v1/partner/orgs/${orgId}/offers`).then((r) => r.offers),
  })
}

export type ProgramLite = { slug: string; name: string }
export function usePrograms() {
  return useQuery({
    queryKey: ['explore', 'programs'],
    staleTime: 10 * 60_000,
    queryFn: () => api<{ programs: ProgramLite[] }>('/api/v1/explore/programs').then((r) => r.programs),
  })
}
