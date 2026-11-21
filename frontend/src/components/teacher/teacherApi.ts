import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { api } from '@/lib/api'

export type RiskCode = 'inactive' | 'profile_incomplete' | 'claim_not_started' | 'plan_overdue' | 'no_career'
export type Risk = { code: RiskCode; reason: string; detail: Record<string, unknown> }

export type ClaimStatus = 'started' | 'documents_ready' | 'submitted' | 'approved' | 'money_received' | 'rejected'
/** The four steps a teacher moves a claim through. "received" in the UI is money_received. */
export const CLAIM_STEPS: ClaimStatus[] = ['started', 'documents_ready', 'submitted', 'money_received']

export type ClassRow = {
  id: string
  name: string
  school_name: string | null
  join_code: string
  student_count: number
  created_at?: string
}

export type StudentRow = {
  id: string
  name: string
  class_level: number | null
  joined_at: string | null
  profile_pct: number
  profile_complete: boolean
  top_career: { slug: string; name: string } | null
  careers_count: number
  eligible_inr: number
  eligible_count: number
  claimed_inr: number
  claim_status: ClaimStatus | null
  claims_count: number
  plan: { plans: number; steps_total: number; steps_done: number; pct: number; overdue: number }
  applications: number
  to_verify: number
  last_active: string | null
  days_inactive: number | null
  risks: Risk[]
}

export type Dashboard = {
  class: { id: string; name: string; school_name: string | null; join_code: string }
  totals: {
    students: number
    profiles_complete_pct: number
    careers_chosen_pct: number
    plans_made: number
    eligible_inr: number
    claimed_inr: number
    applications: number
    at_risk: number
    to_verify: number
  }
  students: StudentRow[]
  attention: { student_id: string; name: string; risks: Risk[] }[]
  rules: { inactive_days: number; profile_days: number; claim_days: number }
}

export type ClaimOut = { id: string; status: ClaimStatus; amount_expected: number | null; amount_received: number | null }
export type SchemeRow = { id: number; slug: string; name: string; benefit_amount: number; claim: ClaimOut | null }

export type StudentDetailData = {
  student: StudentRow
  classes: { id: string; name: string }[]
  facts: Record<string, unknown>
  missing_facts: string[]
  careers: { slug: string; name: string }[]
  plans: {
    id: string
    title: string
    status: string
    steps: { id: string; title: string; kind: string; due_date: string | null; done_at: string | null; overdue: boolean }[]
  }[]
  schemes: SchemeRow[]
  needs_info: { slug: string; name: string; missing: string[] }[]
  applications: { id: string; status: string; created_at: string; title: string; kind: string | null }[]
  recommendations: { id: string; title: string | null; note: string | null; link: string | null; created_at: string }[]
}

const KEY = 'excelait.teacher.class'

/** The class the teacher is looking at, remembered between pages. Falls back to the first class. */
export function useSelectedClass() {
  const q = useQuery({ queryKey: ['teacher', 'classes'], queryFn: () => api<{ classes: ClassRow[] }>('/api/v1/teacher/classes') })
  const [stored, setStored] = useState<string | null>(() => localStorage.getItem(KEY))
  const classes = q.data?.classes ?? []
  const selected = classes.find((c) => c.id === stored) ?? classes[0] ?? null
  const select = useCallback((id: string) => {
    localStorage.setItem(KEY, id)
    setStored(id)
  }, [])
  return { ...q, classes, selected, select }
}

export function useDashboard(classId: string | undefined) {
  return useQuery({
    queryKey: ['teacher', 'dashboard', classId],
    queryFn: () => api<Dashboard>(`/api/v1/teacher/classes/${classId}/dashboard`),
    enabled: !!classId,
  })
}

export function useStudentDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['teacher', 'student', id],
    queryFn: () => api<StudentDetailData>(`/api/v1/teacher/students/${id}`),
    enabled: !!id,
  })
}

export function useCreateClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; school_name?: string }) =>
      api<{ class: ClassRow }>('/api/v1/teacher/classes', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['teacher', 'classes'] }),
  })
}

export function useRenameClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; school_name?: string }) =>
      api<{ class: ClassRow }>(`/api/v1/teacher/classes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['teacher'] })
    },
  })
}

export function useSetClaim(studentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { scheme_slug: string; status: ClaimStatus; amount_received?: number }) =>
      api<{ claim: ClaimOut }>(`/api/v1/teacher/students/${studentId}/claims`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['teacher'] }),
  })
}

export function useRecommend(studentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { note: string; title?: string }) =>
      api(`/api/v1/teacher/students/${studentId}/recommendations`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['teacher', 'student', studentId] }),
  })
}

export function useNudge() {
  return useMutation({
    mutationFn: ({ studentId, code }: { studentId: string; code: string }) =>
      api(`/api/v1/teacher/students/${studentId}/nudge`, { method: 'POST', body: JSON.stringify({ code }) }),
  })
}

export function useJoinClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) =>
      api<{ class: { id: string; name: string; school_name: string | null; teacher_name: string | null } }>('/api/v1/classes/join', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['classes', 'mine'] }),
  })
}

export function useMyClasses() {
  return useQuery({
    queryKey: ['classes', 'mine'],
    queryFn: () => api<{ classes: { id: string; name: string; school_name: string | null; teacher_name: string | null }[] }>('/api/v1/classes/mine'),
  })
}

export const daysAgo = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null)
