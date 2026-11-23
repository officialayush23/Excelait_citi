import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useFacts } from '@/data/facts'
import { ApiError, api } from '@/lib/api'

import { sampleProfile } from './fixture'
import type { ProfileData } from './types'

const KEY = ['student-profile']
const FACTS = '/api/v1/students/me/facts'

export type ProfileResult = { data: ProfileData; mock: boolean }

async function load(): Promise<ProfileResult> {
  try {
    return { data: await api<ProfileData>('/api/v1/students/me/profile'), mock: false }
  } catch (e) {
    // While the endpoint is not deployed, develop against the sample so the page can be seen.
    const missing = e instanceof ApiError ? e.status === 404 : true
    if (import.meta.env.DEV && missing) return { data: sampleProfile, mock: true }
    throw e
  }
}

/** The student's profile plus the edit and delete actions that keep the page and the local fact store in step. */
export function useProfile() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: load })
  const update = useFacts((s) => s.update)

  const patch = useCallback((fn: (d: ProfileData) => ProfileData) => qc.setQueryData<ProfileResult>(KEY, (r) => (r ? { ...r, data: fn(r.data) } : r)), [qc])

  const saveFact = useCallback(
    async (key: string, value: unknown) => {
      await update({ [key]: value }, { replaceLists: true })
      patch((d) => ({ ...d, facts: d.facts.map((f) => (f.key === key ? { ...f, value, at: new Date().toISOString() } : f)) }))
      void qc.invalidateQueries({ queryKey: KEY })
    },
    [update, patch, qc],
  )

  /** Removes one fact on the server; throws if that fails so the page can say so. */
  const removeFact = useCallback(
    async (key: string, opts: { refresh?: boolean } = {}) => {
      if (!query.data?.mock) await api(`${FACTS}/${encodeURIComponent(key)}`, { method: 'DELETE' })
      useFacts.setState((s) => {
        const facts = { ...s.facts }
        delete facts[key]
        return { facts }
      })
      patch((d) => ({ ...d, facts: d.facts.filter((f) => f.key !== key) }))
      if (opts.refresh !== false) void qc.invalidateQueries({ queryKey: KEY })
    },
    [query.data?.mock, patch, qc],
  )

  return { ...query, result: query.data, saveFact, removeFact }
}
